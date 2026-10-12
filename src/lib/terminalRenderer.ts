import { type ITheme, Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { LINE_ENDINGS, toHex } from "./encoding";
import { clockTime, type StreamEvent } from "./stream";
import type { Theme } from "./theme";

// Palette colors (not true colors), so text already written follows a theme change.
const RESET = "\x1b[0m";
const DIM = "\x1b[90m";
const TX = "\x1b[34m";
const INFO = "\x1b[37m";
const ERROR = "\x1b[31m";
const WARN = "\x1b[33m";

const BASE = { background: "#00000000", cursor: "#00000000", cursorAccent: "#00000000" };

// Windows Terminal's "Campbell" palette in dark mode; a matching light version.
const THEMES: Record<Theme, ITheme> = {
  dark: {
    ...BASE,
    foreground: "#f2f2f2",
    selectionBackground: "#264f78",
    black: "#0c0c0c",
    red: "#e74856",
    green: "#16c60c",
    yellow: "#f9f1a5",
    blue: "#60cdff",
    magenta: "#b4009e",
    cyan: "#61d6d6",
    white: "#a6a6a6",
    brightBlack: "#8f8f8f",
    brightRed: "#ff99a4",
    brightGreen: "#6ccb5f",
    brightYellow: "#fce100",
    brightBlue: "#99ebff",
    brightMagenta: "#d670d6",
    brightCyan: "#9cf0f0",
    brightWhite: "#ffffff",
  },
  light: {
    ...BASE,
    foreground: "#1a1a1a",
    selectionBackground: "#cce4f7",
    black: "#0c0c0c",
    red: "#c42b1c",
    green: "#0f7b0f",
    yellow: "#9d5d00",
    blue: "#005fb8",
    magenta: "#881798",
    cyan: "#0e7490",
    white: "#5f5f5f",
    brightBlack: "#767676",
    brightRed: "#c50f1f",
    brightGreen: "#13a10e",
    brightYellow: "#c19c00",
    brightBlue: "#0037da",
    brightMagenta: "#b4009e",
    brightCyan: "#3a96dd",
    brightWhite: "#1a1a1a",
  },
};
const HEX_PER_LINE = 16;

export type ViewMode = "ascii" | "hex";

/**
 * Writes the serial stream into an xterm.js terminal. ANSI escape sequences
 * coming from the device are passed through, so colored logs just work.
 *
 * While paused, events are queued instead of written; resuming flushes them.
 * xterm.js already keeps the viewport still when the user scrolls up.
 */
export class TerminalRenderer {
  readonly term: Terminal;
  private fit = new FitAddon();
  private decoder = new TextDecoder();
  private atLineStart = true;
  private hexColumn = 0;
  private pending: StreamEvent[] = [];
  private pendingLines = 0;
  private paused = false;

  mode: ViewMode = "ascii";
  timestamps = true;
  echo = true;
  onPendingChange?: (lines: number) => void;
  onScrollChange?: (atBottom: boolean) => void;

  constructor(container: HTMLElement, theme: Theme) {
    this.term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      convertEol: true,
      scrollback: 20000,
      disableStdin: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "none",
      cursorBlink: false,
      allowTransparency: true,
      theme: THEMES[theme],
    });
    this.term.loadAddon(this.fit);
    this.term.open(container);
    this.term.onScroll(() => this.reportScroll());
    this.term.onWriteParsed(() => this.reportScroll());
    this.resize();
  }

  setTheme(theme: Theme) {
    this.term.options.theme = THEMES[theme];
  }

  resize() {
    if (this.term.element?.offsetParent) this.fit.fit();
  }

  dispose() {
    this.term.dispose();
  }

  get isAtBottom() {
    const b = this.term.buffer.active;
    return b.viewportY >= b.baseY;
  }

  private reportScroll() {
    this.onScrollChange?.(this.isAtBottom);
  }

  handle(event: StreamEvent) {
    if (this.paused) {
      this.pending.push(event);
      this.pendingLines += event.kind === "rx" ? countNewlines(event.bytes) : 1;
      this.onPendingChange?.(this.pendingLines);
      return;
    }
    const out = this.render(event);
    if (out) this.term.write(out);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) return;
    const out = this.pending.map((e) => this.render(e)).join("");
    this.pending = [];
    this.pendingLines = 0;
    this.onPendingChange?.(0);
    this.term.write(out, () => this.term.scrollToBottom());
  }

  scrollToBottom() {
    this.term.scrollToBottom();
  }

  setMode(mode: ViewMode) {
    if (mode === this.mode) return;
    this.term.write(this.breakLine());
    this.mode = mode;
  }

  clear() {
    this.term.reset();
    this.atLineStart = true;
    this.hexColumn = 0;
    this.pending = [];
    this.pendingLines = 0;
    this.onPendingChange?.(0);
  }

  /** Time (optional) and a direction tag, so received and sent lines are easy to tell apart. */
  private prefix(time: number, tag: "rx" | "tx" | "none") {
    const clock = this.timestamps ? `${DIM}${clockTime(time)}${RESET}  ` : "";
    const badge = tag === "rx" ? `${INFO}RX${RESET}  ` : tag === "tx" ? `${TX}TX${RESET}  ` : "    ";
    return clock + badge;
  }

  /** Newline only if the cursor is not already at the start of a line. */
  private breakLine() {
    const needed = !this.atLineStart || this.hexColumn > 0;
    this.atLineStart = true;
    this.hexColumn = 0;
    return needed ? "\n" : "";
  }

  private render(event: StreamEvent): string {
    switch (event.kind) {
      case "rx":
        return this.mode === "hex" ? this.renderHex(event.bytes, event.time) : this.renderText(event.bytes, event.time);
      case "tx": {
        if (!this.echo) return "";
        const ending = LINE_ENDINGS.find((e) => e.id === event.ending)?.escaped ?? "";
        const body = this.mode === "hex" ? toHex(event.bytes) : `${event.text}${DIM}  ${ending}`;
        const note = event.note ? `${WARN}  « ${event.note}` : "";
        return `${this.breakLine()}${this.prefix(event.time, "tx")}${TX}${body}${note}${RESET}\n`;
      }
      case "info":
        return `${this.breakLine()}${this.prefix(event.time, "none")}${INFO}── ${event.text} ──${RESET}\n`;
      case "error":
        return `${this.breakLine()}${this.prefix(event.time, "none")}${ERROR}${event.text}${RESET}\n`;
    }
  }

  private renderText(bytes: Uint8Array, time: number) {
    const text = this.decoder.decode(bytes, { stream: true });
    let out = "";
    const lines = text.split("\n");
    lines.forEach((part, i) => {
      if (i > 0) {
        out += "\n";
        this.atLineStart = true;
      }
      if (!part) return;
      if (this.atLineStart) {
        out += this.prefix(time, "rx");
        this.atLineStart = false;
      }
      out += part;
    });
    return out;
  }

  private renderHex(bytes: Uint8Array, time: number) {
    let out = "";
    for (const b of bytes) {
      if (this.hexColumn === 0) out += this.prefix(time, "rx");
      const hex = b.toString(16).toUpperCase().padStart(2, "0");
      out += b === 0x0a || b === 0x0d ? `${DIM}${hex}${RESET} ` : `${hex} `;
      this.hexColumn++;
      if (b === 0x0a || this.hexColumn === HEX_PER_LINE) {
        out += "\n";
        this.hexColumn = 0;
      }
    }
    this.atLineStart = this.hexColumn === 0;
    return out;
  }
}

function countNewlines(bytes: Uint8Array) {
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return n;
}
