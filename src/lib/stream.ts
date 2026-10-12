import type { LineEnding } from "./encoding";

/**
 * Everything that happens on the serial link, in order. The terminal and the
 * plot both subscribe to the same stream, which is what keeps them in sync.
 */
export type StreamEvent =
  | { kind: "rx"; bytes: Uint8Array; time: number }
  | { kind: "tx"; text: string; bytes: Uint8Array; ending: LineEnding; time: number }
  | { kind: "info"; text: string; time: number }
  | { kind: "error"; text: string; time: number };

type Listener<T> = (value: T) => void;

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T) {
    for (const listener of this.listeners) listener(value);
  }
}

export function clockTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
