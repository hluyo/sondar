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

const THEMES: Record<Theme, ITheme> = {
  dark: {
    ...BASE,
    foreground: "#e7eaee",
    selectionBackground: "#2b4a6e",
    black: "#1d222a",
    red: "#ff7b7b",
    green: "#3dd68c",
    yellow: "#f5c451",
    blue: "#6cb6ff",
    magenta: "#c79bff",
    cyan: "#4fd1c5",
    white: "#c9cfd8",
    brightBlack: "#7a8392",
    brightRed: "#ff9d9d",
    brightGreen: "#6ee7a8",
    brightYellow: "#ffd97a",
    brightBlue: "#9acbff",
    brightMagenta: "#dcbcff",
    brightCyan: "#7fe3d8",
    brightWhite: "#ffffff",
  },
  light: {
    ...BASE,
    foreground: "#161a20",
    selectionBackground: "#b6d4fb",
    black: "#1d222a",
    red: "#d93636",
    green: "#1a7f4b",
    yellow: "#9a6700",
    blue: "#1f6fd1",
    magenta: "#8250df",
    cyan: "#0f7b8a",
    white: "#5d6675",
    brightBlack: "#7f8896",
    brightRed: "#e5534b",
    brightGreen: "#22a05e",
    brightYellow: "#b7791f",
    brightBlue: "#3b82f6",
    brightMagenta: "#a371f7",
    brightCyan: "#1b9aaa",
    brightWhite: "#161a20",
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
      fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
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

  private prefix(time: number) {
    return this.timestamps ? `${DIM}${clockTime(time)}${RESET}  ` : "";
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
        return `${this.breakLine()}${this.prefix(event.time)}${TX}${body}${note}${RESET}\n`;
      }
      case "info":
        return `${this.breakLine()}${this.prefix(event.time)}${INFO}── ${event.text} ──${RESET}\n`;
      case "error":
        return `${this.breakLine()}${this.prefix(event.time)}${ERROR}${event.text}${RESET}\n`;
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
        out += this.prefix(time);
        this.atLineStart = false;
      }
      out += part;
    });
    return out;
  }

  private renderHex(bytes: Uint8Array, time: number) {
    let out = "";
    for (const b of bytes) {
      if (this.hexColumn === 0) out += this.prefix(time);
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
