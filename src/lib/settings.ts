import { useCallback, useEffect, useState } from "react";
import type { LineEnding } from "./encoding";
import type { FlowControl, Parity, PortConfig } from "./serial";
import { DEFAULT_GPS_CONFIG, type GpsConfig } from "./gpsSimulator";
import { DEFAULT_ROUTE_FAULTS, type RouteFaults, type Speed } from "./routePlayer";
import type { LanguagePreference } from "./i18n";
import type { ThemePreference } from "./theme";

export interface QuickCommand {
  id: string;
  name: string;
  command: string;
}

export type YAxisMode = "auto" | "expand" | "manual";
export type SideTab = "plot" | "gps";

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
  sideTab: SideTab;
  /** Width of the side panel in px; the user drags its edge to change it. */
  sidePanelWidth: number;
  language: LanguagePreference;
  gps: GpsConfig;
  /** What the GPS tab plays: a recorded route (frame files) or the synthetic GPS. */
  simSource: "route" | "synthetic";
  routeSpeed: Speed;
  routeLoop: boolean;
  routeTxOnlyGga: boolean;
  routeFaults: RouteFaults;
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
  quickCommands: [],
  theme: "system",
  sideTab: "plot",
  sidePanelWidth: 540,
  language: "auto",
  gps: DEFAULT_GPS_CONFIG,
  simSource: "route",
  routeSpeed: 1,
  routeLoop: false,
  routeTxOnlyGga: false,
  routeFaults: DEFAULT_ROUTE_FAULTS,
};

const KEY = "sondar.settings.v1";

/** Forgets the saved settings, as on a fresh install. The caller reloads the app. */
export function forgetSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, or storage unavailable: already clean.
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const gps = { ...DEFAULT_GPS_CONFIG, ...saved.gps, faults: { ...DEFAULT_GPS_CONFIG.faults, ...saved.gps?.faults } };
      const routeFaults = { ...DEFAULT_ROUTE_FAULTS, ...saved.routeFaults };
      // The Map and Simulator tabs became a single GPS tab.
      const sideTab: SideTab = saved.sideTab === "plot" ? "plot" : saved.sideTab ? "gps" : DEFAULT_SETTINGS.sideTab;
      return { ...DEFAULT_SETTINGS, ...saved, gps, routeFaults, sideTab };
    }
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
