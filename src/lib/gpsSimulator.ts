import { checksum, ggaBody, ggaFields, sentence } from "./nmea";
import { Emitter } from "./stream";

export type TrackMode = "fixed" | "circle" | "line";
export type FaultKind = "checksum" | "truncate" | "garbage";

export interface Fault {
  on: boolean;
  /** Probability per sentence, 1–50 %. */
  percent: number;
}

export interface GpsConfig {
  mode: TrackMode;
  lat: number;
  lon: number;
  altitude: number;
  /** m/s, for circle and line. */
  speed: number;
  /** m, for circle. */
  radius: number;
  /** Degrees from north, for line. */
  heading: number;
  /** 1 = GPS, 2 = DGPS, 0 = no fix. */
  quality: 0 | 1 | 2;
  satellites: number;
  hdop: number;
  /** Sentences per second. */
  rate: 1 | 2 | 5 | 10;
  talker: "GP" | "GN";
  faults: Record<FaultKind, Fault>;
}

export const DEFAULT_GPS_CONFIG: GpsConfig = {
  mode: "circle",
  lat: 40.416775,
  lon: -3.70379,
  altitude: 667,
  speed: 4,
  radius: 40,
  heading: 60,
  quality: 1,
  satellites: 8,
  hdop: 0.9,
  rate: 1,
  talker: "GP",
  faults: {
    checksum: { on: false, percent: 10 },
    truncate: { on: false, percent: 10 },
    garbage: { on: false, percent: 10 },
  },
};

export interface LatLon {
  lat: number;
  lon: number;
}

export interface SimFrame {
  time: number;
  /** What goes on the wire, CR+LF included. */
  bytes: Uint8Array;
  /** Printable version for the terminal (garbage bytes as \xHH, no CR+LF). */
  text: string;
  talker: string;
  fields: string[];
  checksum: string;
  fault: FaultKind | null;
  garbage: boolean;
  /** Position sent, or null when the sentence carries no fix. */
  position: LatLon | null;
}

const METERS_PER_DEGREE = 111_320;
const GARBAGE = [0xa7, 0x3f, 0x00];
const TRAIL_SIZE = 600;
const ascii = new TextEncoder();

export const FAULT_LABELS: Record<FaultKind, string> = {
  checksum: "bad checksum",
  truncate: "truncated",
  garbage: "garbage bytes",
};

/** Moves `meters` north and east from a point. */
export function offset(origin: LatLon, north: number, east: number): LatLon {
  return {
    lat: origin.lat + north / METERS_PER_DEGREE,
    lon: origin.lon + east / (METERS_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

/** Distance in metres between two nearby points (equirectangular, good enough for a few km). */
export function distance(a: LatLon, b: LatLon) {
  const north = (b.lat - a.lat) * METERS_PER_DEGREE;
  const east = (b.lon - a.lon) * METERS_PER_DEGREE * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(north, east);
}

/**
 * Pretends to be a GPS receiver: emits NMEA GGA sentences at a fixed rate,
 * following a track, with optional fault injection for robustness exercises.
 * It only builds the frames; `send` puts them on the serial port.
 */
export class GpsSimulator {
  /** Fires whenever something visible changes (a frame was sent, started, stopped…). */
  readonly changes = new Emitter<void>();
  /** Positions sent with a valid fix, oldest first. */
  trail: LatLon[] = [];
  frames = 0;
  last: SimFrame | null = null;
  lostUntil = 0;
  silentUntil = 0;

  private timer: number | null = null;
  private startedAt = 0;

  constructor(
    public config: GpsConfig,
    private send: (frame: SimFrame) => void,
  ) {}

  get running() {
    return this.timer !== null;
  }

  start() {
    if (this.running) return;
    this.startedAt = Date.now();
    this.frames = 0;
    this.schedule();
    this.tick();
  }

  stop() {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.changes.emit();
  }

  setConfig(config: GpsConfig) {
    const rateChanged = config.rate !== this.config.rate;
    this.config = config;
    if (this.running && rateChanged) {
      window.clearInterval(this.timer!);
      this.schedule();
    }
    this.changes.emit();
  }

  /** Sends sentences without a fix for a while (or restores the fix if already lost). */
  toggleLostFix(seconds = 10) {
    this.lostUntil = this.lostUntil > Date.now() ? 0 : Date.now() + seconds * 1000;
    this.changes.emit();
  }

  /** Stops sending for a while, as if the receiver were unplugged (or resumes). */
  toggleSilence(seconds = 5) {
    this.silentUntil = this.silentUntil > Date.now() ? 0 : Date.now() + seconds * 1000;
    this.changes.emit();
  }

  clearTrail() {
    this.trail = [];
    this.changes.emit();
  }

  /** Where the track is `elapsed` seconds after start. */
  positionAt(elapsed: number): LatLon {
    const c = this.config;
    if (c.mode === "circle") {
      const radius = Math.max(1, c.radius);
      const angle = (c.speed * elapsed) / radius;
      return offset(c, radius * Math.sin(angle), radius * Math.cos(angle));
    }
    if (c.mode === "line") {
      const h = (c.heading * Math.PI) / 180;
      return offset(c, c.speed * elapsed * Math.cos(h), c.speed * elapsed * Math.sin(h));
    }
    return { lat: c.lat, lon: c.lon };
  }

  private schedule() {
    this.timer = window.setInterval(() => this.tick(), 1000 / this.config.rate);
  }

  private tick() {
    const now = Date.now();
    if (now < this.silentUntil) {
      this.changes.emit();
      return;
    }
    const frame = this.buildFrame(now);
    this.frames++;
    this.last = frame;
    if (frame.position && !frame.fault) {
      this.trail.push(frame.position);
      if (this.trail.length > TRAIL_SIZE) this.trail.splice(0, this.trail.length - TRAIL_SIZE);
    }
    this.send(frame);
    this.changes.emit();
  }

  private buildFrame(now: number): SimFrame {
    const c = this.config;
    const position = this.positionAt((now - this.startedAt) / 1000);
    const quality = now < this.lostUntil ? 0 : c.quality;
    const fields = ggaFields({
      utcSeconds: (now % 86_400_000) / 1000,
      lat: position.lat,
      lon: position.lon,
      quality,
      satellites: quality === 0 ? 0 : c.satellites,
      hdop: c.hdop,
      altitude: c.altitude,
      geoidSeparation: 51.2,
    });
    const body = ggaBody(c.talker, fields);
    const good = checksum(body);

    const roll = (kind: FaultKind) => c.faults[kind].on && Math.random() * 100 < c.faults[kind].percent;
    let fault: FaultKind | null = null;
    let cs = good;
    let text = sentence(body, good);
    if (roll("checksum")) {
      fault = "checksum";
      cs = (parseInt(good, 16) ^ 0x5a).toString(16).toUpperCase().padStart(2, "0");
      text = sentence(body, cs);
    } else if (roll("truncate")) {
      fault = "truncate";
      text = text.slice(0, 20 + Math.floor(Math.random() * (text.length - 24)));
    }
    const garbage = roll("garbage");

    const bytes = Uint8Array.from([...(garbage ? GARBAGE : []), ...ascii.encode(text), 0x0d, 0x0a]);
    const printable = (garbage ? GARBAGE.map((b) => `\\x${b.toString(16).toUpperCase().padStart(2, "0")}`).join("") + " " : "") + text;

    return {
      time: now,
      bytes,
      text: printable,
      talker: c.talker,
      fields,
      checksum: cs,
      fault,
      garbage,
      position: quality === 0 ? null : position,
    };
  }
}
