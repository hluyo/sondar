import { Channel, invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";

const IS_LINUX = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

/** What to do about the usual errors when opening a port, or null. */
export function openErrorHint(message: string): string | null {
  if (IS_LINUX && /permission denied/i.test(message)) {
    return t(
      "Linux does not let your user open this port. Install Sondar from the .deb or .rpm package, which gives access to the usual USB-serial boards, or run “sudo usermod -aG dialout $USER” (uucp on Arch), then log out and back in.",
    );
  }
  if (/busy|access is denied|acceso denegado/i.test(message)) {
    return t("Another program has the port open (STM32CubeIDE, the Arduino serial monitor, PuTTY, another Sondar…). Close it and connect again.");
  }
  return null;
}

export interface PortInfo {
  name: string;
  description: string;
}

export type Parity = "none" | "odd" | "even";
export type FlowControl = "none" | "hardware" | "software";

export interface PortConfig {
  port: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: Parity;
  stopBits: 1 | 2;
  flowControl: FlowControl;
  /** Silence in ms after received bytes that sends an `idle` event; 0 = off. */
  rxIdleMs: number;
}

/** Input control lines driven by the device. */
export interface InputLines {
  cts: boolean;
  dsr: boolean;
  cd: boolean;
  ri: boolean;
}

/** Output control lines driven by the computer. */
export interface OutputLines {
  dtr: boolean;
  rts: boolean;
}

export type SerialEvent =
  /** `time`: when the first of these bytes was read (ms since the epoch). */
  | { kind: "data"; bytes: number[]; time: number }
  /** The line was silent for `rxIdleMs` after the last bytes, measured where they are read. */
  | { kind: "idle" }
  | ({ kind: "signals" } & InputLines)
  | { kind: "closed"; reason: string | null };

export const listPorts = () => invoke<PortInfo[]>("list_ports");

export function openPort(config: PortConfig, onEvent: (event: SerialEvent) => void) {
  const channel = new Channel<SerialEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("open_port", { config, onEvent: channel });
}

export const closePort = () => invoke<void>("close_port");

export const writePort = (data: Uint8Array) => invoke<void>("write_port", { data: Array.from(data) });

export const setSignals = (lines: Partial<OutputLines>) => invoke<void>("set_signals", lines);

/** Changes the idle timeout of the open port. */
export const setRxIdle = (ms: number) => invoke<void>("set_rx_idle", { ms });

/** "8N1", "7E1"… */
export function frameLabel(c: Pick<PortConfig, "dataBits" | "parity" | "stopBits">) {
  const parity = { none: "N", odd: "O", even: "E" }[c.parity];
  return `${c.dataBits}${parity}${c.stopBits}`;
}
