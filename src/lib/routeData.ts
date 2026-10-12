import { strFromU8, unzipSync } from "fflate";
import { t } from "./i18n";
import { checksum } from "./nmea";

/**
 * A recorded GPS route: one NMEA burst per second (the files nmea_0001.txt…)
 * plus a reference CSV with the position on the street and the exact line the
 * device is expected to answer for each burst.
 */
export interface RouteStep {
  /** 1-based, as in the CSV. */
  index: number;
  file: string;
  /** The burst exactly as stored in the file, CR+LF included. Sent byte for byte. */
  burst: string;
  /** "22:40:04". */
  utc: string;
  fix: boolean;
  streetLat: number;
  streetLon: number;
  speedKmh: number | null;
  heading: number | null;
  /** Line the device must answer: "POS,43.307078,-2.011059" or "NOFIX". */
  expected: string;
}

export interface RouteData {
  name: string;
  startLabel: string;
  endLabel: string;
  /** Date of the recording from the RMC sentences, "2026-10-16", if found. */
  date: string | null;
  steps: RouteStep[];
}

const STEP_FILE = /(?:^|[\\/])(nmea_\d+\.txt)$/i;
const CSV_FILE = /(?:^|[\\/])ruta_referencia\.csv$/i;
const README_FILE = /(?:^|[\\/])(leeme|readme)\.txt$/i;
const STORAGE_KEY = "sonda-serial.route.v1";

/** name (as in the CSV) → text. Paths are reduced to the file name. */
type FileMap = Map<string, string>;

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

/** Loads a route from the files of a picked folder (any nesting). */
export async function routeFromFiles(files: File[]): Promise<RouteData> {
  const map: FileMap = new Map();
  let folder = "";
  for (const f of files) {
    const path = f.webkitRelativePath || f.name;
    if (!folder && /[\\/]/.test(path)) folder = path.split(/[\\/]/)[0];
    const step = STEP_FILE.exec(path);
    if (step) map.set(step[1].toLowerCase(), latin1.decode(await f.arrayBuffer()));
    else if (CSV_FILE.test(path)) map.set("ruta_referencia.csv", utf8.decode(await f.arrayBuffer()));
    else if (README_FILE.test(path)) map.set("readme", utf8.decode(await f.arrayBuffer()));
  }
  return buildRoute(map, folder || "Route");
}

/** Loads a route from a ZIP with the same layout as the folder. */
export async function routeFromZip(file: File): Promise<RouteData> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const map: FileMap = new Map();
  for (const [path, data] of Object.entries(entries)) {
    const step = STEP_FILE.exec(path);
    if (step) map.set(step[1].toLowerCase(), latin1.decode(data));
    else if (CSV_FILE.test(path)) map.set("ruta_referencia.csv", strFromU8(data));
    else if (README_FILE.test(path)) map.set("readme", strFromU8(data));
  }
  return buildRoute(map, file.name.replace(/\.zip$/i, ""));
}

function buildRoute(files: FileMap, name: string): RouteData {
  const csv = files.get("ruta_referencia.csv");
  if (!csv) throw new Error(t("ruta_referencia.csv not found"));
  const rows = parseCsv(csv);
  const header = rows.shift() ?? [];
  const col = (n: string) => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(t("ruta_referencia.csv: column \"{n}\" missing", { n }));
    return i;
  };
  const c = {
    index: col("indice"),
    file: col("fichero"),
    utc: col("utc"),
    fix: col("fix"),
    lat: col("lat_calle"),
    lon: col("lon_calle"),
    speed: col("velocidad_kmh"),
    heading: col("rumbo"),
    expected: col("respuesta_mcu"),
  };

  const missing: string[] = [];
  const steps: RouteStep[] = [];
  for (const r of rows) {
    if (r.length < header.length) continue;
    const file = r[c.file];
    const burst = files.get(file.toLowerCase());
    if (burst === undefined) {
      missing.push(file);
      continue;
    }
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    steps.push({
      index: Number(r[c.index]),
      file,
      burst,
      utc: r[c.utc],
      fix: r[c.fix] === "1",
      streetLat: Number(r[c.lat]),
      streetLon: Number(r[c.lon]),
      speedKmh: num(r[c.speed]),
      heading: num(r[c.heading]),
      expected: r[c.expected].trim(),
    });
  }
  if (missing.length) {
    const list = missing.slice(0, 5).join(", ") + (missing.length > 5 ? `… (${t("{n} in total", { n: missing.length })})` : "");
    throw new Error(t("Missing frame files: {list}", { list }));
  }
  if (steps.length === 0) throw new Error(t("ruta_referencia.csv has no rows"));
  const stepFiles = [...files.keys()].filter((k) => k.startsWith("nmea_")).length;
  if (stepFiles !== steps.length) throw new Error(t("{files} frame files but {rows} rows in ruta_referencia.csv", { files: stepFiles, rows: steps.length }));

  const [startLabel, endLabel] = routeLabels(files.get("readme"));
  return { name, startLabel, endLabel, date: rmcDate(steps), steps };
}

/** "Plaça de Catalunya -> Jardinets de Gràcia" on the README's first line. */
function routeLabels(readme: string | undefined): [string, string] {
  const first = readme?.split(/\r?\n/).find((l) => l.includes("->")) ?? "";
  const m = /^(?:[^:]*:\s*)?(.+?)\s*->\s*(.+)$/.exec(first.trim());
  return m ? [m[1], m[2]] : ["Start", "End"];
}

function rmcDate(steps: RouteStep[]): string | null {
  for (const s of steps) {
    const rmc = s.burst.split(/\r?\n/).find((l) => /^\$..RMC,/.test(l));
    const d = rmc?.split(",")[9];
    if (d && /^\d{6}$/.test(d)) return `20${d.slice(4, 6)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  }
  return null;
}

/** RFC 4180 CSV: quoted fields may contain commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        cells.push(cell);
        cell = "";
      } else cell += ch;
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

// ---- Persistence: the last route is remembered between sessions -------------

export function saveRoute(route: RouteData | null) {
  try {
    if (route) localStorage.setItem(STORAGE_KEY, JSON.stringify(route));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or unavailable: the route just has to be loaded again next time.
  }
}

export function loadSavedRoute(): RouteData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RouteData) : null;
  } catch {
    return null;
  }
}

// ---- Fault injection on a burst ---------------------------------------------

const lines = (burst: string) => burst.split("\r\n");
const isGga = (line: string) => /^\$..GGA,/.test(line);

/** Rewrites one sentence's body and recomputes its checksum. */
function withBody(line: string, transform: (body: string) => string) {
  const star = line.lastIndexOf("*");
  const body = transform(line.slice(1, star));
  return `$${body}*${checksum(body)}`;
}

/** Changes the checksum of the GGA sentence so it no longer matches. */
export function corruptGgaChecksum(burst: string) {
  return lines(burst)
    .map((l) => {
      if (!isGga(l)) return l;
      const star = l.lastIndexOf("*");
      const bad = (parseInt(l.slice(star + 1, star + 3), 16) ^ 0x5a).toString(16).toUpperCase().padStart(2, "0");
      return l.slice(0, star + 1) + bad;
    })
    .join("\r\n");
}

/** Removes a few characters from the middle of the GGA sentence, keeping its old checksum. */
export function dropGgaBytes(burst: string) {
  return lines(burst)
    .map((l) => {
      if (!isGga(l)) return l;
      const star = l.lastIndexOf("*");
      const body = l.slice(1, star);
      // Removing characters whose XOR is 0 would keep the checksum valid: pick a span that changes it.
      for (let at = Math.floor(body.length / 3); at < body.length - 3; at++) {
        const cut = body.slice(0, at) + body.slice(at + 3);
        if (checksum(cut) !== checksum(body)) return `$${cut}${l.slice(star)}`;
      }
      return l;
    })
    .join("\r\n");
}

/**
 * A burst without a position (like the cold-start ones) carrying the time of
 * `step`. Built from the route's first no-fix burst, with every checksum redone.
 */
export function noFixBurst(route: RouteData, step: RouteStep) {
  const template = route.steps.find((s) => !s.fix) ?? null;
  if (!template) return step.burst;
  const templateTime = templateTimeOf(template.burst);
  const time = `${step.utc.replace(/:/g, "")}.00`;
  if (!templateTime) return template.burst;
  return lines(template.burst)
    .map((l) => (l.startsWith("$") && l.includes(templateTime) ? withBody(l, (b) => b.split(templateTime).join(time)) : l))
    .join("\r\n");
}

function templateTimeOf(burst: string) {
  const gga = lines(burst).find(isGga);
  return gga?.split(",")[1] || null;
}

/** The sentences of a burst, without CR+LF, for the terminal. */
export function burstLines(burst: string) {
  return lines(burst).filter((l) => l.length > 0);
}
