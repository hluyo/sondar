import type { LatLon } from "./gpsSimulator";
import { parseLine } from "./lineParser";
import { parseGga } from "./nmea";

const LAT_KEYS = /^(lat|latitude)$/i;
const LON_KEYS = /^(lon|lng|long|longitude)$/i;
const NO_FIX = /\bno\s*fix\b/i;
const POS = /^\s*POS\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const TRAIL_SIZE = 2000;

export interface TrackedPosition extends LatLon {
  /** Time of the last line that said something about the position (ms). */
  time: number;
  /** False after the device reported it lost the fix; lat/lon keep the last known value. */
  fix: boolean;
}

/**
 * Follows the position a device reports in its received lines, for the map.
 * Understands `POS,<lat>,<lon>`, `lat=… lon=…` style lines (also `latitude:`,
 * `lng`…) and raw NMEA GGA sentences, so it works with the simulator, the route
 * player and a real GPS.
 */
export class PositionTracker {
  last: TrackedPosition | null = null;
  trail: LatLon[] = [];
  /** What the last line about the position said: a fix, "no fix", or nothing yet. */
  signal: "fix" | "nofix" | null = null;
  /** Bumps on every change. */
  version = 0;

  private decoder = new TextDecoder();
  private partial = "";

  pushBytes(bytes: Uint8Array, time: number) {
    const text = this.partial + this.decoder.decode(bytes, { stream: true });
    const lines = text.split("\n");
    this.partial = lines.pop() ?? "";
    if (this.partial.length > 4096) this.partial = "";
    for (const line of lines) this.pushLine(line, time);
  }

  pushLine(line: string, time: number) {
    const pos = POS.exec(line);
    if (pos) {
      this.set(Number(pos[1]), Number(pos[2]), time);
      return;
    }
    const gga = parseGga(line);
    if (gga) {
      if (gga.quality > 0 && Number.isFinite(gga.lat) && Number.isFinite(gga.lon)) this.set(gga.lat, gga.lon, time);
      else this.lost(time);
      return;
    }

    const pairs = parseLine(line);
    const lat = pairs?.find(([k]) => LAT_KEYS.test(k))?.[1];
    const lon = pairs?.find(([k]) => LON_KEYS.test(k))?.[1];
    if (lat !== undefined && lon !== undefined) this.set(lat, lon, time);
    else if (NO_FIX.test(line)) this.lost(time);
  }

  clear() {
    this.last = null;
    this.trail = [];
    this.signal = null;
    this.partial = "";
    this.version++;
  }

  private set(lat: number, lon: number, time: number) {
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    this.last = { lat, lon, time, fix: true };
    this.signal = "fix";
    this.trail.push({ lat, lon });
    if (this.trail.length > TRAIL_SIZE) this.trail.splice(0, this.trail.length - TRAIL_SIZE);
    this.version++;
  }

  private lost(time: number) {
    this.signal = "nofix";
    if (this.last) this.last = { ...this.last, time, fix: false };
    this.version++;
  }
}
