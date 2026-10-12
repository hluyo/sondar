export type LineEnding = "none" | "cr" | "lf" | "crlf";

export const LINE_ENDINGS: { id: LineEnding; label: string; bytes: number[]; escaped: string }[] = [
  { id: "none", label: "Nada", bytes: [], escaped: "" },
  { id: "cr", label: "CR", bytes: [0x0d], escaped: "\\r" },
  { id: "lf", label: "LF", bytes: [0x0a], escaped: "\\n" },
  { id: "crlf", label: "CR+LF", bytes: [0x0d, 0x0a], escaped: "\\r\\n" },
];

const utf8 = new TextEncoder();

/**
 * Turns what the user typed into bytes. Supports the escapes \r \n \t \0 \\ and
 * \xHH so raw bytes can be sent from the text box (e.g. "\x02DATA\x03").
 */
export function encodeCommand(text: string, ending: LineEnding): Uint8Array {
  const out: number[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(...utf8.encode(plain));
    plain = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "\\" || i === text.length - 1) {
      plain += ch;
      continue;
    }
    const next = text[i + 1];
    const simple: Record<string, number> = { r: 0x0d, n: 0x0a, t: 0x09, "0": 0x00, "\\": 0x5c };
    if (next in simple) {
      flush();
      out.push(simple[next]);
      i++;
    } else if ((next === "x" || next === "X") && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
      flush();
      out.push(parseInt(text.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      plain += ch;
    }
  }
  flush();

  const suffix = LINE_ENDINGS.find((e) => e.id === ending)?.bytes ?? [];
  return Uint8Array.from([...out, ...suffix]);
}

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}
