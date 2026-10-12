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

export type SerialEvent =
  | { kind: "data"; bytes: number[] }
  | { kind: "closed"; reason: string | null };

export const listPorts = () => invoke<PortInfo[]>("list_ports");

export function openPort(config: PortConfig, onEvent: (event: SerialEvent) => void) {
  const channel = new Channel<SerialEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("open_port", { config, onEvent: channel });
}

export const closePort = () => invoke<void>("close_port");

export const writePort = (data: Uint8Array) => invoke<void>("write_port", { data: Array.from(data) });

/** "8N1", "7E1"… */
export function frameLabel(c: Pick<PortConfig, "dataBits" | "parity" | "stopBits">) {
  const parity = { none: "N", odd: "O", even: "E" }[c.parity];
  return `${c.dataBits}${parity}${c.stopBits}`;
}
