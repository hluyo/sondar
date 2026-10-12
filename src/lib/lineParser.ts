const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const PAIR = new RegExp(String.raw`([A-Za-z_][\w.\-]*)\s*[:=]\s*(${NUMBER})(?![\w:])`, "g");
const MAX_UNNAMED = 32;

/**
 * Extracts plottable values from one text line. Two formats are understood,
 * the same ones the Arduino Serial Plotter accepts:
 *
 *   named:    "temp=24.5 hum=40"  or  "temp:24.5, hum:40"
 *   unnamed:  "24.5 40"  or  "24.5,40"  or  "24.5;40"  → ch1, ch2…
 *
 * Returns null when the line holds nothing to plot (log messages, prompts…).
 */
export function parseLine(line: string): [string, number][] | null {
  const text = line.trim();
  if (!text) return null;

  const pairs: [string, number][] = [];
  for (const m of text.matchAll(PAIR)) {
    const value = Number(m[2]);
    if (Number.isFinite(value)) pairs.push([m[1], value]);
  }
  if (pairs.length) return pairs;

  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_UNNAMED) return null;
  const values = tokens.map(Number);
  if (values.some((v) => !Number.isFinite(v))) return null;
  return values.map((v, i) => [`ch${i + 1}`, v]);
}
