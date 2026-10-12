import { parseLine } from "./lineParser";
import { clockTime } from "./stream";

const MAX_POINTS = 60_000;

export const CHANNEL_COLORS = ["#ffb020", "#3d9bff", "#4fd1a5", "#8b95a5", "#ff7b7b", "#b49bff", "#f472b6", "#a3e635"];

export interface ChannelStats {
  name: string;
  color: string;
  last: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
}

/**
 * Column store for plotted values: one shared time axis (seconds) and one
 * array per channel. Channels are created the first time their name appears;
 * earlier rows get null so every column stays aligned with the time axis.
 */
export class PlotStore {
  names: string[] = [];
  x: number[] = [];
  ys: (number | null)[][] = [];
  /** Bumps on every new row. */
  version = 0;
  /** Bumps when channels are added or cleared (the chart must be rebuilt). */
  layoutVersion = 0;

  private index = new Map<string, number>();
  private decoder = new TextDecoder();
  private partial = "";

  pushBytes(bytes: Uint8Array, timeMs: number) {
    const text = this.partial + this.decoder.decode(bytes, { stream: true });
    const lines = text.split("\n");
    this.partial = lines.pop() ?? "";
    if (this.partial.length > 4096) this.partial = "";
    for (const line of lines) this.pushLine(line, timeMs / 1000);
  }

  pushLine(line: string, t: number) {
    const values = parseLine(line);
    if (!values) return;

    const row = new Array<number | null>(this.names.length).fill(null);
    for (const [name, value] of values) {
      let i = this.index.get(name);
      if (i === undefined) {
        i = this.names.length;
        this.index.set(name, i);
        this.names.push(name);
        this.ys.push(new Array(this.x.length).fill(null));
        row.push(null);
        this.layoutVersion++;
      }
      row[i] = value;
    }

    this.x.push(t);
    row.forEach((v, i) => this.ys[i].push(v));
    this.version++;

    if (this.x.length > MAX_POINTS * 1.2) {
      const drop = this.x.length - MAX_POINTS;
      this.x.splice(0, drop);
      for (const y of this.ys) y.splice(0, drop);
    }
  }

  /** Every stored sample as CSV: seconds since the first sample, clock time, one column per channel. */
  toCSV() {
    const t0 = this.x[0] ?? 0;
    const rows = [["time_s", "clock", ...this.names].join(",")];
    for (let i = 0; i < this.x.length; i++) {
      const cells = [(this.x[i] - t0).toFixed(3), clockTime(this.x[i] * 1000)];
      for (const y of this.ys) cells.push(y[i] === null ? "" : String(y[i]));
      rows.push(cells.join(","));
    }
    return rows.join("\r\n") + "\r\n";
  }

  clear() {
    this.names = [];
    this.x = [];
    this.ys = [];
    this.index.clear();
    this.partial = "";
    this.version++;
    this.layoutVersion++;
  }

  /** Index of the first sample at or after time t (binary search). */
  firstIndexFrom(t: number) {
    let lo = 0;
    let hi = this.x.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.x[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  stats(fromTime: number): ChannelStats[] {
    const start = this.firstIndexFrom(fromTime);
    return this.names.map((name, i) => {
      const col = this.ys[i];
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;
      let last: number | null = null;
      for (let k = start; k < col.length; k++) {
        const v = col[k];
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        count++;
        last = v;
      }
      return {
        name,
        color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
        last,
        min: count ? min : null,
        max: count ? max : null,
        mean: count ? sum / count : null,
      };
    });
  }
}
