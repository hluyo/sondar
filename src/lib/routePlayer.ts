import { burstLines, corruptGgaChecksum, dropGgaBytes, noFixBurst, type RouteData, type RouteStep } from "./routeData";
import { t } from "./i18n";
import { Emitter } from "./stream";

/** How long a burst waits for its answer. */
export const RESPONSE_WINDOW_MS = 800;
/** Two positions closer than this (in degrees) only differ by rounding of the 6th decimal. */
const ROUNDING_DEGREES = 1.5e-6;

export const SPEEDS = [0.5, 1, 2, 5, 10] as const;
export type Speed = (typeof SPEEDS)[number];

export type InjectedFault = "checksum" | "bytesLost" | "signalLoss";

export interface RouteFaults {
  /** Corrupt the GGA checksum of one burst every `every`. */
  checksum: { on: boolean; every: number };
  /** Remove characters from the GGA sentence of one burst every `every`. */
  bytesLost: { on: boolean; every: number };
  /** Bursts sent without position when "lose signal" is pressed. */
  signalLossBursts: number;
}

export const DEFAULT_ROUTE_FAULTS: RouteFaults = {
  checksum: { on: false, every: 10 },
  bytesLost: { on: false, every: 15 },
  signalLossBursts: 10,
};

export type Verdict =
  | "pending"
  | "ok" // exact match (or the expected silence)
  | "rounding" // a position within rounding of the expected one
  | "wrong"
  | "format" // a POS line that cannot be read
  | "noResponse"
  | "duplicate";

export interface ParsedResponse {
  text: string;
  kind: "pos" | "nofix" | "format";
  lat?: number;
  lon?: number;
}

export interface BurstResult {
  step: RouteStep;
  injected: InjectedFault | null;
  /** What the device should answer for this burst; null when it should stay silent. */
  expected: string | null;
  responses: ParsedResponse[];
  verdict: Verdict;
  /** For wrong positions: distance to the expected one, in metres. */
  errorMeters: number | null;
  /** An answer that arrived after the response window closed. */
  late: boolean;
}

export interface Summary {
  sent: number;
  correct: number;
  wrong: number;
  noResponse: number;
  duplicate: number;
  /** 0–10, from the share of correct bursts. */
  grade: number;
}

export interface SentLine {
  text: string;
  bytes: Uint8Array;
  isGga: boolean;
  note?: string;
}

export interface PlayerHooks {
  /** Puts the burst on the wire. Rejects if the port is gone. */
  send: (bytes: Uint8Array, lines: SentLine[]) => Promise<void>;
  /** Messages for the terminal and the log. */
  report: (level: "info" | "error", text: string) => void;
  /** Called when playback goes back to the first burst (reset or loop): clear the map. */
  onRestart: () => void;
}

const ascii = new TextEncoder();
const POS = /^POS,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

export function parseResponse(text: string): ParsedResponse | null {
  if (text === "NOFIX") return { text, kind: "nofix" };
  if (!text.startsWith("POS")) return null; // free text from the student: shown, ignored
  const m = POS.exec(text);
  const lat = m ? Number(m[1]) : NaN;
  const lon = m ? Number(m[2]) : NaN;
  if (!m || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { text, kind: "format" };
  return { text, kind: "pos", lat, lon };
}

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/**
 * Plays a recorded route to the device, one burst per second (scaled by the
 * speed), and checks every answer against the reference CSV.
 *
 * Each answer belongs to the last burst sent. A burst closes when its 800 ms
 * window ends or the next burst goes out, whichever comes first.
 */
export class RoutePlayer {
  readonly changes = new Emitter<void>();
  route: RouteData | null = null;
  /** Index (0-based) of the next burst to send. */
  position = 0;
  results: BurstResult[] = [];
  playing = false;
  finished = false;
  speed: Speed = 1;
  loop = false;
  faults: RouteFaults = DEFAULT_ROUTE_FAULTS;
  /** Bursts still to be sent without position. */
  signalLossLeft = 0;

  private timer: number | null = null;
  private windowTimer: number | null = null;
  private open: BurstResult | null = null;
  private decoder = new TextDecoder();
  private partial = "";

  constructor(private hooks: PlayerHooks) {}

  get current(): RouteStep | null {
    return this.route?.steps[Math.max(0, this.position - 1)] ?? null;
  }

  get lastResult(): BurstResult | null {
    return this.results[this.results.length - 1] ?? null;
  }

  setRoute(route: RouteData | null) {
    this.pause();
    this.route = route;
    this.reset();
  }

  play() {
    if (!this.route || this.playing) return;
    if (this.finished) this.reset();
    this.playing = true;
    this.hooks.report("info", t("Route {name}: playing from frame {n} at {speed}×", { name: this.route.name, n: this.position + 1, speed: this.speed }));
    this.changes.emit();
    this.tick();
  }

  pause() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.playing) {
      this.playing = false;
      this.changes.emit();
    }
  }

  /** Sends only the next burst. */
  step() {
    if (!this.route) return;
    this.pause();
    if (this.finished) this.reset();
    void this.sendNext();
  }

  /** Back to the first burst; results and the map are cleared. */
  reset() {
    this.pause();
    this.closeWindow();
    this.position = 0;
    this.results = [];
    this.finished = false;
    this.signalLossLeft = 0;
    this.hooks.onRestart();
    this.changes.emit();
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    if (this.playing) {
      window.clearTimeout(this.timer!);
      this.schedule();
    }
    this.changes.emit();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    this.changes.emit();
  }

  setFaults(faults: RouteFaults) {
    this.faults = faults;
    this.changes.emit();
  }

  /** Starts (or cancels) a signal loss of `faults.signalLossBursts` bursts. */
  toggleSignalLoss() {
    this.signalLossLeft = this.signalLossLeft > 0 ? 0 : this.faults.signalLossBursts;
    this.changes.emit();
  }

  summary(): Summary {
    const done = this.results.filter((r) => r.verdict !== "pending");
    const count = (...v: Verdict[]) => done.filter((r) => v.includes(r.verdict)).length;
    const correct = count("ok", "rounding");
    return {
      sent: done.length,
      correct,
      wrong: count("wrong", "format"),
      noResponse: count("noResponse"),
      duplicate: count("duplicate"),
      grade: done.length ? Math.round((correct / done.length) * 100) / 10 : 0,
    };
  }

  /** Received bytes from the device, split into lines. */
  pushBytes(bytes: Uint8Array) {
    const text = this.partial + this.decoder.decode(bytes, { stream: true });
    const parts = text.split("\n");
    this.partial = parts.pop() ?? "";
    if (this.partial.length > 4096) this.partial = "";
    for (const line of parts) this.onLine(line.trim());
  }

  private onLine(text: string) {
    const response = parseResponse(text);
    if (!response) return;
    if (response.kind === "format") this.hooks.report("error", t("Format error: \"{text}\" is not POS,<lat>,<lon>", { text }));
    const result = this.lastResult;
    if (!result) return;
    result.responses.push(response);
    if (result.verdict === "pending") return; // evaluated when the window closes
    if (result.verdict === "noResponse") {
      result.late = true; // it stays "no response": the answer missed its window
    } else {
      this.evaluate(result);
      this.reportResult(result);
    }
    this.changes.emit();
  }

  private schedule() {
    this.timer = window.setTimeout(() => this.tick(), 1000 / this.speed);
  }

  private async tick() {
    if (!this.playing) return;
    const ok = await this.sendNext();
    if (ok && this.playing && !this.finished) this.schedule();
  }

  /** Sends the burst at `position`. Returns false when playback cannot go on. */
  private async sendNext(): Promise<boolean> {
    const route = this.route;
    if (!route) return false;
    if (this.position >= route.steps.length) {
      if (!this.loop) return false;
      this.closeWindow();
      this.hooks.report("info", t("Route finished: {summary}. Starting again", { summary: this.summaryText() }));
      this.position = 0;
      this.results = [];
      this.hooks.onRestart();
    }

    const step = route.steps[this.position];
    const { burst, injected } = this.prepare(route, step);
    const sentences = burstLines(burst);
    const lineObjects: SentLine[] = sentences.map((text) => {
      const gga = /^\$..GGA,/.test(text);
      return {
        text,
        bytes: ascii.encode(`${text}\r\n`),
        isGga: gga,
        note: gga && injected ? `${t("simulated error")}: ${t(INJECTED_LABELS[injected])}` : undefined,
      };
    });

    this.closeWindow();
    const result: BurstResult = {
      step,
      injected,
      expected: injected === "checksum" || injected === "bytesLost" ? null : injected === "signalLoss" ? "NOFIX" : step.expected,
      responses: [],
      verdict: "pending",
      errorMeters: null,
      late: false,
    };
    this.results.push(result);
    this.position++;
    this.open = result;
    this.windowTimer = window.setTimeout(() => this.closeWindow(), RESPONSE_WINDOW_MS);
    this.changes.emit();

    try {
      // Byte for byte as stored (latin1 keeps every byte as is), CR+LF included.
      await this.hooks.send(Uint8Array.from(burst, (c) => c.charCodeAt(0) & 0xff), lineObjects);
    } catch (e) {
      this.pause();
      this.hooks.report("error", t("Route paused: could not send frame {n} ({e})", { n: step.index, e: String(e) }));
      return false;
    }

    if (this.position >= route.steps.length && !this.loop) {
      this.playing = false;
      this.timer = null;
      // The summary waits for the last answer.
      window.setTimeout(() => {
        this.closeWindow();
        this.finished = true;
        this.hooks.report("info", t("Route finished: {summary}", { summary: this.summaryText() }));
        this.changes.emit();
      }, RESPONSE_WINDOW_MS);
    }
    return true;
  }

  private prepare(route: RouteData, step: RouteStep): { burst: string; injected: InjectedFault | null } {
    if (this.signalLossLeft > 0) {
      this.signalLossLeft--;
      return { burst: noFixBurst(route, step), injected: "signalLoss" };
    }
    const f = this.faults;
    if (f.checksum.on && f.checksum.every > 0 && step.index % f.checksum.every === 0) {
      return { burst: corruptGgaChecksum(step.burst), injected: "checksum" };
    }
    if (f.bytesLost.on && f.bytesLost.every > 0 && step.index % f.bytesLost.every === 0) {
      return { burst: dropGgaBytes(step.burst), injected: "bytesLost" };
    }
    return { burst: step.burst, injected: null };
  }

  private closeWindow() {
    if (this.windowTimer !== null) window.clearTimeout(this.windowTimer);
    this.windowTimer = null;
    const result = this.open;
    this.open = null;
    if (!result || result.verdict !== "pending") return;
    this.evaluate(result);
    this.reportResult(result);
    this.changes.emit();
  }

  private evaluate(r: BurstResult) {
    const answers = r.responses;
    r.errorMeters = null;
    if (answers.length === 0) {
      r.verdict = r.expected === null ? "ok" : "noResponse";
      return;
    }
    if (answers.length > 1) {
      r.verdict = "duplicate";
      return;
    }
    const a = answers[0];
    if (a.kind === "format") {
      r.verdict = "format";
      return;
    }
    if (r.expected === null) {
      r.verdict = "wrong"; // it should have discarded the burst
      return;
    }
    if (a.text === r.expected) {
      r.verdict = "ok";
      return;
    }
    const expected = parseResponse(r.expected);
    if (a.kind === "pos" && expected?.kind === "pos") {
      const dLat = Math.abs(a.lat! - expected.lat!);
      const dLon = Math.abs(a.lon! - expected.lon!);
      if (dLat < ROUNDING_DEGREES && dLon < ROUNDING_DEGREES) {
        r.verdict = "rounding";
        return;
      }
      r.errorMeters = haversine(a.lat!, a.lon!, expected.lat!, expected.lon!);
    }
    r.verdict = "wrong";
  }

  /** Only failures go to the terminal; the panel shows every burst. */
  private reportResult(r: BurstResult) {
    const id = t("Frame {n} ({utc})", { n: r.step.index, utc: r.step.utc });
    const got = r.responses.map((x) => x.text).join(" | ");
    if (r.verdict === "noResponse") this.hooks.report("error", `${id}: ${t("no response in {ms} ms, expected {exp}", { ms: RESPONSE_WINDOW_MS, exp: r.expected ?? "" })}`);
    else if (r.verdict === "duplicate") this.hooks.report("error", `${id}: ${t("duplicate response ({got})", { got })}`);
    else if (r.verdict === "wrong")
      this.hooks.report(
        "error",
        `${id}: ${t("expected {exp}, got {got}", { exp: r.expected ?? t("no response"), got })}${r.errorMeters !== null ? ` (${t("{d} away", { d: formatDistance(r.errorMeters) })})` : ""}`,
      );
  }

  private summaryText() {
    const s = this.summary();
    return t("{correct}/{sent} correct, {wrong} wrong, {none} without response, {dup} duplicate · grade {grade}", { correct: s.correct, sent: s.sent, wrong: s.wrong, none: s.noResponse, dup: s.duplicate, grade: s.grade.toFixed(1) });
  }
}

export const INJECTED_LABELS: Record<InjectedFault, string> = {
  checksum: "altered GGA checksum",
  bytesLost: "bytes lost in GGA",
  signalLoss: "signal loss",
};

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 100_000 ? 0 : 1)} km` : `${m.toFixed(1)} m`;
}

const STATE_NAMES: Record<Verdict, string> = {
  pending: "pending",
  ok: "ok",
  rounding: "ok_rounding",
  wrong: "wrong",
  format: "format_error",
  noResponse: "no_response",
  duplicate: "duplicate",
};

/** First readable position the device answered for a burst. */
function firstPosition(r: BurstResult) {
  return r.responses.find((x) => x.kind === "pos") ?? null;
}

/** Received route as CSV: indice,utc,lat,lon,estado (one row per burst sent). */
export function resultsCsv(results: BurstResult[]) {
  const rows = ["indice,utc,lat,lon,estado"];
  for (const r of results) {
    const p = firstPosition(r);
    const state = r.verdict === "ok" && r.expected === null ? "ok_no_response_expected" : STATE_NAMES[r.verdict];
    rows.push([r.step.index, r.step.utc, p?.lat?.toFixed(6) ?? "", p?.lon?.toFixed(6) ?? "", state].join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Received route as GPX 1.1: one track point per position the device answered. */
export function resultsGpx(route: RouteData, results: BurstResult[]) {
  const points = results
    .map((r) => ({ r, p: firstPosition(r) }))
    .filter((x) => x.p)
    .map(({ r, p }) => {
      const time = route.date ? `\n        <time>${route.date}T${r.step.utc}Z</time>` : "";
      return `      <trkpt lat="${p!.lat!.toFixed(6)}" lon="${p!.lon!.toFixed(6)}">${time}\n      </trkpt>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Sonda Serial" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${xml(`${route.startLabel} → ${route.endLabel} (device)`)}</name>
    <trkseg>
${points.join("\n")}
    </trkseg>
  </trk>
</gpx>
`;
}
