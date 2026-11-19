import { logStart, logStop, logWrite, fileStamp } from "./files";
import { clockTime, type StreamEvent } from "./stream";

const FLUSH_MS = 500;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Writes the stream to a text file, one readable line per event:
 *
 *   15:30:02.140  TX  READ
 *   15:30:02.161  RX  T=23.6 H=41.2
 *   15:30:05.002  --  COM8 closed
 *
 * Each received entry is one line, with the time its first byte arrived.
 * Writes are batched to the backend every FLUSH_MS.
 */
export class SessionLog {
  private buffer = "";
  private timer: number;
  private failed = false;
  /** Bytes written so far. */
  bytes = 0;

  private constructor(
    readonly path: string,
    private onError: (error: unknown) => void,
  ) {
    this.timer = window.setInterval(() => this.flush(), FLUSH_MS);
  }

  /** Creates the file in Documents/Sondar/logs. */
  static async start(port: string, header: string, onError: (error: unknown) => void) {
    const log = new SessionLog(await logStart(`${fileStamp()}_${port || "no-port"}.txt`), onError);
    log.buffer = `# ${header}\n`;
    return log;
  }

  handle(event: StreamEvent) {
    switch (event.kind) {
      case "rx":
        this.line(event.time, "RX", event.text);
        break;
      case "tx":
        this.line(event.time, "TX", event.note ? `${event.text}  « ${event.note}` : event.text);
        break;
      case "info":
        this.line(event.time, "--", event.text);
        break;
      case "error":
        this.line(event.time, "!!", event.text);
        break;
    }
  }

  async stop() {
    window.clearInterval(this.timer);
    await this.flush();
    await logStop();
  }

  private line(time: number, tag: string, text: string) {
    this.buffer += `${clockTime(time)}  ${tag}  ${text.replace(ANSI, "").replace(/\r/g, "")}\n`;
  }

  private async flush() {
    if (!this.buffer || this.failed) return;
    const text = this.buffer;
    this.buffer = "";
    this.bytes += new TextEncoder().encode(text).length;
    try {
      await logWrite(text);
    } catch (e) {
      this.failed = true;
      this.onError(e);
    }
  }
}
