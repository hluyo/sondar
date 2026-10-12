/**
 * Minimal NMEA 0183 support: building and reading GGA sentences.
 *
 *   $GPGGA,102401.00,4025.0065,N,00342.2274,W,1,08,0.9,667.0,M,51.2,M,,*hh
 *          time      latitude    longitude   q sat hdop alt   geoid  age/station
 *
 * Latitude and longitude travel as degrees and minutes (ddmm.mmmm / dddmm.mmmm),
 * and the checksum is the XOR of every character between "$" and "*".
 */

export const GGA_FIELDS = [
  "UTC time",
  "Latitude",
  "N/S",
  "Longitude",
  "E/W",
  "Fix quality",
  "Satellites",
  "HDOP",
  "Altitude",
  "Unit",
  "Geoid sep.",
  "Unit",
  "DGPS age",
  "DGPS station",
] as const;

export interface GgaFix {
  /** Seconds since midnight UTC. */
  utcSeconds: number;
  lat: number;
  lon: number;
  /** 0 = no fix, 1 = GPS, 2 = DGPS. */
  quality: number;
  satellites: number;
  hdop: number;
  altitude: number;
  geoidSeparation: number;
}

export function checksum(body: string) {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, "0");
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** 40.416775 → "4025.0065" (degWidth 2), -3.70379 → "00342.2274" (degWidth 3). */
export function toDegreesMinutes(value: number, degWidth: number) {
  const a = Math.abs(value);
  let degrees = Math.floor(a);
  let minutes = Number(((a - degrees) * 60).toFixed(4));
  if (minutes >= 60) {
    degrees += 1;
    minutes = 0;
  }
  return pad(degrees, degWidth) + minutes.toFixed(4).padStart(7, "0");
}

/** "4025.0065" → 40.416775. Returns NaN for an empty or malformed field. */
export function fromDegreesMinutes(field: string) {
  if (!/^\d+(\.\d+)?$/.test(field)) return NaN;
  const raw = Number(field);
  const degrees = Math.floor(raw / 100);
  return degrees + (raw - degrees * 100) / 60;
}

function utcField(seconds: number) {
  const s = ((seconds % 86400) + 86400) % 86400;
  return pad(Math.floor(s / 3600), 2) + pad(Math.floor(s / 60) % 60, 2) + (s % 60).toFixed(2).padStart(5, "0");
}

/** The 14 comma-separated fields after "GGA". With quality 0 the position fields are empty, as receivers send them. */
export function ggaFields(fix: GgaFix): string[] {
  const time = utcField(fix.utcSeconds);
  if (fix.quality === 0) return [time, "", "", "", "", "0", "00", "99.9", "", "M", "", "M", "", ""];
  return [
    time,
    toDegreesMinutes(fix.lat, 2),
    fix.lat >= 0 ? "N" : "S",
    toDegreesMinutes(fix.lon, 3),
    fix.lon >= 0 ? "E" : "W",
    String(fix.quality),
    pad(fix.satellites, 2),
    fix.hdop.toFixed(1),
    fix.altitude.toFixed(1),
    "M",
    fix.geoidSeparation.toFixed(1),
    "M",
    "",
    "",
  ];
}

/** Body of the sentence, without "$", "*" or checksum: "GPGGA,…". */
export function ggaBody(talker: string, fields: string[]) {
  return `${talker}GGA,${fields.join(",")}`;
}

export function sentence(body: string, cs = checksum(body)) {
  return `$${body}*${cs}`;
}

/**
 * Reads a GGA sentence (any talker). Returns null when the line is not a GGA
 * sentence or its checksum is wrong; `lat`/`lon` are NaN when there is no fix.
 */
export function parseGga(line: string): Pick<GgaFix, "lat" | "lon" | "quality" | "satellites"> | null {
  const m = /\$([A-Z]{2}GGA,[^*$]*)\*([0-9A-Fa-f]{2})/.exec(line);
  if (!m || checksum(m[1]).toUpperCase() !== m[2].toUpperCase()) return null;
  const f = m[1].split(",").slice(1);
  const quality = Number(f[5]) || 0;
  let lat = fromDegreesMinutes(f[1]);
  let lon = fromDegreesMinutes(f[3]);
  if (f[2] === "S") lat = -lat;
  if (f[4] === "W") lon = -lon;
  return { lat, lon, quality, satellites: Number(f[6]) || 0 };
}
