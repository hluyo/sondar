const CR = 0x0d;
const LF = 0x0a;
/** Longest entry; a device that never sends a line ending still gets its bytes shown. */
export const MAX_ENTRY = 4096;
/** Default idle timeout. */
export const DEFAULT_RX_IDLE_MS = 30;
export const MAX_RX_IDLE_MS = 5000;

/** Why an entry was closed. */
export type RxEnd = "eol" | "idle" | "max" | "flush";

export interface RxEntry {
  /** Every byte of the entry, line ending included. */
  bytes: Uint8Array;
  /** The bytes as text, without the line ending. */
  text: string;
  /** When its first byte was read (ms since the epoch). */
  time: number;
  end: RxEnd;
}

/**
 * Turns received bytes into entries (lines) for the terminal, the log, the plot
 * and the map.
 *
 * The port hands bytes over in chunks of any size, so one answer such as
 * `OK\r\n` can arrive as `O` and `K\r\n`. The framer joins them and closes an
 * entry:
 *
 * - at a line ending: CR, LF, CR LF or LF CR (a pair counts once, even when its
 *   two bytes arrive in different chunks);
 * - on `idle()`, which the backend signals after a silence on the line, for
 *   devices that send fixed-length messages with no line ending (ignored when
 *   `idleMs` is 0, except to close a line ending received last);
 * - at `MAX_ENTRY` bytes.
 *
 * The silence is measured by the backend, where bytes are read, not here: the
 * UI gets bytes in batches and later when it is busy, so a timer here would see
 * pauses that never happened on the wire.
 *
 * Bytes are never dropped or reordered: joining the entries gives the stream back.
 */
export class RxFramer {
  /** Silence (ms) that closes an entry with no line ending; 0 = only line endings close it. */
  idleMs: number;

  private buf: number[] = [];
  private time = 0;
  /** The line ending that ended `buf`, while the next byte may still be its partner. */
  private ending: number | null = null;
  private decoder = new TextDecoder();
  private onEntry: (entry: RxEntry) => void;

  constructor(onEntry: (entry: RxEntry) => void, idleMs = DEFAULT_RX_IDLE_MS) {
    this.onEntry = onEntry;
    this.idleMs = idleMs;
  }

  push(bytes: Uint8Array, time: number) {
    for (const b of bytes) {
      if (this.ending !== null) {
        if ((b === CR || b === LF) && b !== this.ending) {
          this.buf.push(b);
          this.close("eol");
          continue;
        }
        this.close("eol");
      }
      if (this.buf.length === 0) this.time = time;
      this.buf.push(b);
      if (b === CR || b === LF) this.ending = b;
      else if (this.buf.length >= MAX_ENTRY) this.close("max");
    }
  }

  /** The line has been silent for the idle time. */
  idle() {
    if (this.buf.length === 0) return;
    if (this.ending !== null) this.close("eol");
    else if (this.idleMs > 0) this.close("idle");
  }

  /** Closes the open entry now, if any (the port closed). */
  flush() {
    if (this.buf.length > 0) this.close(this.ending !== null ? "eol" : "flush");
  }

  /** Bytes waiting for the entry to close. */
  get pending() {
    return this.buf.length;
  }

  private close(end: RxEnd) {
    const bytes = Uint8Array.from(this.buf);
    let length = bytes.length;
    while (length > 0 && (bytes[length - 1] === CR || bytes[length - 1] === LF)) length--;
    const text = this.decoder.decode(bytes.subarray(0, length));
    this.buf = [];
    this.ending = null;
    this.onEntry({ bytes, text, time: this.time, end });
  }
}

/**
 * The idle timeout to use: the setting, but never shorter than three characters
 * on the wire, so a slow baud rate does not cut a message between two bytes.
 */
export function effectiveIdleMs(idleMs: number, baudRate: number, bitsPerChar = 10) {
  if (idleMs <= 0) return 0;
  const charMs = (bitsPerChar * 1000) / Math.max(baudRate, 1);
  return Math.max(idleMs, Math.ceil(3 * charMs));
}

/** Start bit, data bits, parity and stop bits of one character. */
export function bitsPerChar(frame: { dataBits: number; parity: string; stopBits: number }) {
  return 1 + frame.dataBits + (frame.parity === "none" ? 0 : 1) + frame.stopBits;
}
