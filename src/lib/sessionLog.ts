import { logStart, logStop, logWrite, fileStamp } from "./files";
import { clockTime, type StreamEvent } from "./stream";

const FLUSH_MS = 500;
const MAX_PARTIAL = 4096;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Writes the stream to a text file, one readable line per event:
 *
 *   15:30:02.140  TX  READ
 *   15:30:02.161  RX  T=23.6 H=41.2
 *   15:30:05.002  --  COM8 closed
 *
 * Received bytes are split into lines here (each line keeps the time its first
 * byte arrived) and writes are batched to the backend every FLUSH_MS.
 */
export class SessionLog {
  private decoder = new TextDecoder();
  private partial = "";
  private partialTime = 0;
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

  /** Creates the file in Documents/Sonda Serial/logs. */
  static async start(port: string, header: string, onError: (error: unknown) => void) {
    const log = new SessionLog(await logStart(`${fileStamp()}_${port || "no-port"}.txt`), onError);
    log.buffer = `# ${header}\n`;
    return log;
  }

  handle(event: StreamEvent) {
    switch (event.kind) {
      case "rx": {
        const parts = this.decoder.decode(event.bytes, { stream: true }).split("\n");
        parts.forEach((part, i) => {
          if (!this.partial) this.partialTime = event.time;
          this.partial += part;
          if (i < parts.length - 1 || this.partial.length > MAX_PARTIAL) {
            this.line(this.partialTime, "RX", this.partial);
            this.partial = "";
          }
        });
        break;
      }
      case "tx":
        this.line(event.time, "TX", event.text);
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
    if (this.partial) this.line(this.partialTime, "RX", this.partial);
    this.partial = "";
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
