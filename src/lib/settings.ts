import { useCallback, useEffect, useState } from "react";
import type { LineEnding } from "./encoding";
import type { FlowControl, Parity, PortConfig } from "./serial";
import type { ThemePreference } from "./theme";

export interface QuickCommand {
  id: string;
  name: string;
  command: string;
}

export type YAxisMode = "auto" | "expand" | "manual";

export interface Settings {
  port: string;
  baudRate: number;
  dataBits: PortConfig["dataBits"];
  parity: Parity;
  stopBits: PortConfig["stopBits"];
  flowControl: FlowControl;
  autoReconnect: boolean;
  lineEnding: LineEnding;
  viewMode: "ascii" | "hex";
  timestamps: boolean;
  echo: boolean;
  showPlot: boolean;
  plotWindow: number;
  plotYMode: YAxisMode;
  plotYMin: number | null;
  plotYMax: number | null;
  history: string[];
  quickCommands: QuickCommand[];
  theme: ThemePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  port: "",
  baudRate: 115200,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  flowControl: "none",
  autoReconnect: true,
  lineEnding: "crlf",
  viewMode: "ascii",
  timestamps: true,
  echo: true,
  showPlot: true,
  plotWindow: 10,
  plotYMode: "auto",
  plotYMin: null,
  plotYMax: null,
  history: [],
  quickCommands: [{ id: "q1", name: "Read", command: "READ" }],
  theme: "system",
};

const KEY = "sonda-serial.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Corrupt or unavailable storage: start from the defaults.
  }
  return DEFAULT_SETTINGS;
}

/** App settings, remembered between sessions. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Not fatal: settings just won't be remembered.
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  return [settings, update] as const;
}

export function toPortConfig(s: Settings): PortConfig {
  return {
    port: s.port,
    baudRate: s.baudRate,
    dataBits: s.dataBits,
    parity: s.parity,
    stopBits: s.stopBits,
    flowControl: s.flowControl,
  };
}
