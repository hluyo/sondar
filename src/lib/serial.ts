import { Channel, invoke } from "@tauri-apps/api/core";

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
  | { kind: "data"; bytes: number[] }
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

/** "8N1", "7E1"… */
export function frameLabel(c: Pick<PortConfig, "dataBits" | "parity" | "stopBits">) {
  const parity = { none: "N", odd: "O", even: "E" }[c.parity];
  return `${c.dataBits}${parity}${c.stopBits}`;
}
