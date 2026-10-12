import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ConnectionBar, type ConnectionStatus, isStBoard } from "./components/ConnectionBar";
import { GpsPanel } from "./components/GpsPanel";
import { HelpDialog } from "./components/HelpDialog";
import { TitleBar } from "./components/TitleBar";
import { PlotPanel } from "./components/PlotPanel";
import { SidePanel } from "./components/SidePanel";
import { ReceivePanel, SendPanel } from "./components/TerminalPanel";
import { encodeCommand } from "./lib/encoding";
import { fileStamp, openFolder, saveExport } from "./lib/files";
import { FAULT_LABELS, type GpsConfig, GpsSimulator } from "./lib/gpsSimulator";
import { resolveLanguage, setLanguage, t } from "./lib/i18n";
import { PlotStore } from "./lib/plotStore";
import { PositionTracker } from "./lib/positionTracker";
import { loadSavedRoute, type RouteData, saveRoute } from "./lib/routeData";
import { RoutePlayer } from "./lib/routePlayer";
import {
  closePort,
  frameLabel,
  type InputLines,
  listPorts,
  openPort,
  type OutputLines,
  type PortInfo,
  setSignals,
  writePort,
} from "./lib/serial";
import { SessionLog } from "./lib/sessionLog";
import { forgetSettings, toPortConfig, useSettings } from "./lib/settings";
import { useTheme } from "./lib/theme";
import { Emitter, formatBytes, type StreamEvent } from "./lib/stream";

const RECONNECT_MS = 1000;
const HISTORY_SIZE = 50;
const OUTPUTS_ON_OPEN: OutputLines = { dtr: true, rts: true };

export default function App() {
  const [settings, update] = useSettings();
  // Set before any child renders, so every t() call below uses it.
  const language = resolveLanguage(settings.language);
  setLanguage(language);
  const theme = useTheme(settings.theme);
  const [helpOpen, setHelpOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(settings.sidePanelWidth);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [counters, setCounters] = useState({ rx: 0, tx: 0 });
  const [outputs, setOutputs] = useState<OutputLines>(OUTPUTS_ON_OPEN);
  const [inputs, setInputs] = useState<InputLines | null>(null);
  const [log, setLog] = useState<{ path: string; bytes: number } | null>(null);

  const bus = useMemo(() => new Emitter<StreamEvent>(), []);
  const plotStore = useMemo(() => new PlotStore(), []);
  const tracker = useMemo(() => new PositionTracker(), []);
  const countersRef = useRef({ rx: 0, tx: 0 });
  const settingsRef = useRef(settings);
  const statusRef = useRef(status);
  /** Each open gets a new id so late events from a previous connection are ignored. */
  const generation = useRef(0);
  const logRef = useRef<SessionLog | null>(null);

  settingsRef.current = settings;
  statusRef.current = status;

  // Plays a recorded route (one NMEA burst per file) and grades the device's answers.
  const player = useMemo(() => {
    const p = new RoutePlayer({
      send: async (bytes, lines) => {
        if (statusRef.current !== "connected") throw new Error(t("the port is closed"));
        await writePort(bytes);
        countersRef.current.tx += bytes.length;
        const onlyGga = settingsRef.current.routeTxOnlyGga;
        const time = Date.now();
        for (const l of lines) {
          if (!onlyGga || l.isGga) bus.emit({ kind: "tx", text: l.text, bytes: l.bytes, ending: "crlf", time, note: l.note });
        }
      },
      report: (level, text) => bus.emit({ kind: level, text, time: Date.now() }),
      onRestart: () => tracker.clear(),
    });
    const s = settingsRef.current;
    p.speed = s.routeSpeed;
    p.loop = s.routeLoop;
    p.faults = s.routeFaults;
    p.route = loadSavedRoute();
    return p;
  }, [bus, tracker]);

  const info = useCallback((text: string) => bus.emit({ kind: "info", text, time: Date.now() }), [bus]);
  const error = useCallback((text: string) => bus.emit({ kind: "error", text, time: Date.now() }), [bus]);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await listPorts());
    } catch (e) {
      error(t("Could not list ports: {e}", { e: String(e) }));
    }
  }, [error]);

  useEffect(
    () =>
      bus.on((e) => {
        if (e.kind === "rx") {
          plotStore.pushBytes(e.bytes, e.time);
          tracker.pushBytes(e.bytes, e.time);
          player.pushBytes(e.bytes);
        }
        logRef.current?.handle(e);
      }),
    [bus, plotStore, tracker, player],
  );

  // The GPS simulator writes its sentences straight to the port and into the stream,
  // so they show up in the terminal (and the log) like any other transmitted line.
  const simulator = useMemo(() => {
    const sim: GpsSimulator = new GpsSimulator(settingsRef.current.gps, (frame) => {
      if (statusRef.current !== "connected") {
        sim.stop();
        return;
      }
      writePort(frame.bytes)
        .then(() => {
          countersRef.current.tx += frame.bytes.length;
          const fault = frame.fault ?? (frame.garbage ? "garbage" : null);
          bus.emit({
            kind: "tx",
            text: frame.text,
            bytes: frame.bytes,
            ending: "crlf",
            time: frame.time,
            note: fault ? `${t("simulated error")}: ${t(FAULT_LABELS[fault])}` : undefined,
          });
        })
        .catch((e) => {
          sim.stop();
          error(t("Simulator stopped, send failed: {e}", { e: String(e) }));
        });
    });
    return sim;
  }, [bus, error]);
  const simulatorRunning = useSimulatorRunning(simulator);
  const playerState = usePlayerState(player);

  useEffect(
    () => () => {
      simulator.stop();
      player.pause();
    },
    [simulator, player],
  );
  useEffect(() => {
    if (status !== "connected") {
      simulator.stop();
      player.pause();
    }
  }, [status, simulator, player]);

  // Only one GPS source talks to the device at a time.
  useEffect(() => {
    const offSim = simulator.changes.on(() => {
      if (simulator.running && player.playing) player.pause();
    });
    const offPlayer = player.changes.on(() => {
      if (player.playing && simulator.running) simulator.stop();
    });
    return () => {
      offSim();
      offPlayer();
    };
  }, [simulator, player]);

  const loadRoute = useCallback(
    (route: RouteData) => {
      player.setRoute(route);
      saveRoute(route);
      info(t("Route loaded: {name} · {n} frames · {start} → {end}", { name: route.name, n: route.steps.length, start: route.startLabel, end: route.endLabel }));
    },
    [player, info],
  );

  const removeRoute = useCallback(() => {
    player.setRoute(null);
    saveRoute(null);
    info(t("Route removed"));
  }, [player, info]);

  /** Back to a fresh install: close the port, forget everything and reload. */
  const resetAll = useCallback(async () => {
    simulator.stop();
    player.pause();
    if (statusRef.current !== "disconnected") await closePort().catch(() => {});
    saveRoute(null);
    forgetSettings();
    window.location.reload();
  }, [simulator, player]);

  const exportFile = useCallback(
    async (name: string, contents: string) => {
      try {
        const path = await saveExport(name, contents);
        info(t("Exported: {path}", { path }));
        return path;
      } catch (e) {
        error(t("Could not export: {e}", { e: String(e) }));
        return null;
      }
    },
    [info, error],
  );

  const setGps = useCallback(
    (gps: GpsConfig) => {
      update({ gps });
      simulator.setConfig(gps);
    },
    [update, simulator],
  );

  // The app name lives only in the window title, with the connection state.
  useEffect(() => {
    const state =
      status === "connected"
        ? t("Connected")
        : status === "connecting"
          ? t("Connecting…")
          : status === "reconnecting"
            ? t("Waiting for the device…")
            : t("Disconnected");
    const title = settings.port ? `Sonda Serial — ${settings.port} · ${state}` : `Sonda Serial — ${state}`;
    document.title = title;
    try {
      getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
    } catch {
      // Outside the desktop app (plain browser preview) there is no native window.
    }
  }, [status, settings.port, language]);

  // First run: pick the port by itself when the choice is obvious (an ST board, or the only port).
  useEffect(() => {
    if (settingsRef.current.port || ports.length === 0) return;
    const st = ports.filter(isStBoard);
    const pick = st.length === 1 ? st[0] : ports.length === 1 ? ports[0] : null;
    if (pick) update({ port: pick.name });
  }, [ports, update]);

  // Keep the port list fresh while disconnected so plugging a board in shows up.
  useEffect(() => {
    refreshPorts();
    if (status === "connected") return;
    const id = setInterval(refreshPorts, 2000);
    return () => clearInterval(id);
  }, [status, refreshPorts]);

  useEffect(() => {
    const id = setInterval(() => {
      const c = countersRef.current;
      setCounters((prev) => (prev.rx === c.rx && prev.tx === c.tx ? prev : { ...c }));
      const bytes = logRef.current?.bytes;
      setLog((prev) => (prev && bytes !== undefined && prev.bytes !== bytes ? { ...prev, bytes } : prev));
    }, 300);
    return () => clearInterval(id);
  }, []);

  const connect = useCallback(async () => {
    const s = settingsRef.current;
    if (!s.port) {
      error(t("Choose a port before connecting"));
      return;
    }
    const config = toPortConfig(s);
    const id = ++generation.current;
    const retrying = statusRef.current === "reconnecting";
    if (!retrying) setStatus("connecting");

    try {
      await openPort(config, (event) => {
        if (id !== generation.current) return;
        if (event.kind === "data") {
          const bytes = Uint8Array.from(event.bytes);
          countersRef.current.rx += bytes.length;
          bus.emit({ kind: "rx", bytes, time: Date.now() });
        } else if (event.kind === "signals") {
          const { cts, dsr, cd, ri } = event;
          setInputs({ cts, dsr, cd, ri });
        } else if (event.reason) {
          // The port failed underneath us (cable pulled, board reset…).
          generation.current++;
          setInputs(null);
          error(t("Connection lost: {reason}", { reason: event.reason }));
          if (settingsRef.current.autoReconnect) {
            info(t("Waiting for {port} to come back…", { port: config.port }));
            setStatus("reconnecting");
          } else {
            setStatus("disconnected");
          }
        }
      });
      if (id !== generation.current) return;
      setStatus("connected");
      setConnectedAt(Date.now());
      setOutputs({ dtr: true, rts: config.flowControl !== "hardware" });
      info(t("{port} opened · {baud} {frame}", { port: config.port, baud: config.baudRate, frame: frameLabel(config) }));
    } catch (e) {
      if (id !== generation.current) return;
      if (retrying) return; // keep waiting quietly
      setStatus("disconnected");
      error(String(e));
    }
  }, [bus, error, info]);

  const disconnect = useCallback(async () => {
    const wasConnected = statusRef.current === "connected";
    generation.current++;
    setStatus("disconnected");
    setInputs(null);
    try {
      await closePort();
    } finally {
      info(wasConnected ? t("{port} closed", { port: settingsRef.current.port }) : t("Reconnect cancelled"));
    }
  }, [info]);

  // Auto-reconnect: retry once a second while the device is missing.
  useEffect(() => {
    if (status !== "reconnecting") return;
    const id = setInterval(async () => {
      const available = await listPorts().catch(() => []);
      setPorts(available);
      if (available.some((p) => p.name === settingsRef.current.port)) connect();
    }, RECONNECT_MS);
    return () => clearInterval(id);
  }, [status, connect]);

  const send = useCallback(
    async (text: string) => {
      const s = settingsRef.current;
      update({ history: [...s.history.filter((h) => h !== text), text].slice(-HISTORY_SIZE) });
      if (statusRef.current !== "connected") {
        error(t("Not sent (port closed): {text}", { text }));
        return;
      }
      const bytes = encodeCommand(text, s.lineEnding);
      try {
        await writePort(bytes);
        countersRef.current.tx += bytes.length;
        bus.emit({ kind: "tx", text, bytes, ending: s.lineEnding, time: Date.now() });
      } catch (e) {
        error(t("Send failed: {e}", { e: String(e) }));
      }
    },
    [bus, error, update],
  );

  // F1…F12 run the quick commands. Also stops F5 from reloading the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = /^F(\d{1,2})$/.exec(e.key);
      if (!m) return;
      e.preventDefault();
      const cmd = settingsRef.current.quickCommands[Number(m[1]) - 1];
      if (cmd?.command) send(cmd.command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  const setOutput = useCallback(
    async (line: keyof OutputLines, value: boolean) => {
      try {
        await setSignals({ [line]: value });
        setOutputs((o) => ({ ...o, [line]: value }));
        info(`${line.toUpperCase()} ${value ? t("on") : t("off")}`);
      } catch (e) {
        error(t("Could not set {line}: {e}", { line: line.toUpperCase(), e: String(e) }));
      }
    },
    [info, error],
  );

  const toggleLog = useCallback(async () => {
    const current = logRef.current;
    if (current) {
      logRef.current = null;
      setLog(null);
      try {
        await current.stop();
        info(t("Log saved: {path}", { path: current.path }));
      } catch (e) {
        error(t("Could not close the log: {e}", { e: String(e) }));
      }
      return;
    }
    const s = settingsRef.current;
    try {
      const header = `Sonda Serial log · ${s.port || "no port"} · ${s.baudRate} ${frameLabel(s)} · ${new Date().toLocaleString()}`;
      const started = await SessionLog.start(s.port, header, (e) => {
        logRef.current = null;
        setLog(null);
        error(t("Logging stopped: {e}", { e: String(e) }));
      });
      logRef.current = started;
      setLog({ path: started.path, bytes: 0 });
      info(t("Saving the log to {path}", { path: started.path }));
    } catch (e) {
      error(t("Could not start the log: {e}", { e: String(e) }));
    }
  }, [info, error]);

  const showFolder = useCallback(
    (kind: "logs" | "exports") => openFolder(kind).catch((e) => error(t("Could not open the folder: {e}", { e: String(e) }))),
    [error],
  );

  const exportPlot = useCallback(async () => {
    try {
      const path = await saveExport(`${fileStamp()}_plot.csv`, plotStore.toCSV());
      info(t("Plot exported: {path}", { path }));
      return path;
    } catch (e) {
      error(t("Could not export the plot: {e}", { e: String(e) }));
      return null;
    }
  }, [plotStore, info, error]);

  const clearAll = useCallback(() => {
    plotStore.clear();
    tracker.clear();
    simulator.clearTrail();
    countersRef.current = { rx: 0, tx: 0 };
  }, [plotStore, tracker, simulator]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        subtitle={[
          settings.port,
          status === "connected" ? t("Connected") : status === "connecting" ? t("Connecting…") : status === "reconnecting" ? t("Waiting for the device…") : t("Disconnected"),
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <ConnectionBar
        settings={settings}
        update={update}
        ports={ports}
        onRefreshPorts={refreshPorts}
        status={status}
        connectedAt={connectedAt}
        onToggleConnection={status === "disconnected" ? connect : disconnect}
        theme={theme}
        onToggleTheme={() => update({ theme: theme === "dark" ? "light" : "dark" })}
        language={language}
        onOpenHelp={() => setHelpOpen(true)}
        outputs={outputs}
        inputs={inputs}
        onSetOutput={setOutput}
        onResetAll={resetAll}
      />

      <main className="flex min-h-0 flex-1 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ReceivePanel
            bus={bus}
            theme={theme}
            settings={settings}
            update={update}
            onClear={clearAll}
            log={log}
            onToggleLog={toggleLog}
            onOpenLogFolder={() => showFolder("logs")}
            counters={counters}
            status={status}
            onConnect={connect}
          />
          <SendPanel settings={settings} update={update} onSend={send} />
        </div>
        {settings.showPlot && (
          <SidePanel
            tab={settings.sideTab}
            onTabChange={(sideTab) => update({ sideTab })}
            width={panelWidth}
            onWidthChange={(w, done) => {
              setPanelWidth(w);
              if (done) update({ sidePanelWidth: w });
            }}
            badges={{
              gps: playerState.playing ? `${playerState.position}/${playerState.total}` : simulatorRunning ? `GGA ${settings.gps.rate} Hz` : undefined,
            }}
            panels={{
              plot: (
                <PlotPanel
                  store={plotStore}
                  theme={theme}
                  windowSeconds={settings.plotWindow}
                  onWindowChange={(plotWindow) => update({ plotWindow })}
                  onExport={exportPlot}
                  onOpenExportFolder={() => showFolder("exports")}
                  yAxis={{ mode: settings.plotYMode, min: settings.plotYMin, max: settings.plotYMax }}
                  onYAxisChange={(a) =>
                    update({
                      ...(a.mode !== undefined && { plotYMode: a.mode }),
                      ...(a.min !== undefined && { plotYMin: a.min }),
                      ...(a.max !== undefined && { plotYMax: a.max }),
                    })
                  }
                />
              ),
              gps: (
                <GpsPanel
                  tracker={tracker}
                  simulator={simulator}
                  player={player}
                  theme={theme}
                  visible={settings.sideTab === "gps"}
                  connected={status === "connected"}
                  settings={settings}
                  update={update}
                  onGpsConfig={setGps}
                  onRouteLoaded={loadRoute}
                  onRouteRemoved={removeRoute}
                  onExport={exportFile}
                  onOpenExportFolder={() => showFolder("exports")}
                />
              ),
            }}
          />
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 bg-bg px-4 pt-0.5 pb-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${status === "connected" ? "bg-ok" : "bg-dim"}`} />
          {settings.port || "—"} · {settings.baudRate} {frameLabel(settings)} · {status === "connected" ? t("Connected") : t("Disconnected")}
        </span>
        <span>RX {formatBytes(counters.rx)}</span>
        <span>TX {formatBytes(counters.tx)}</span>
        {log && (
          <span className="inline-flex items-center gap-1.5 text-err">
            <span className="size-1.5 animate-pulse rounded-full bg-err" />
            LOG {formatBytes(log.bytes)}
          </span>
        )}
        {playerState.playing && (
          <span className="inline-flex items-center gap-1.5 text-accent">
            <span className="size-1.5 rounded-full bg-accent" />
            {t("ROUTE")} {playerState.position}/{playerState.total} · {settings.routeSpeed}×
          </span>
        )}
        {simulatorRunning && (
          <span className="inline-flex items-center gap-1.5 text-accent">
            <span className="size-1.5 rounded-full bg-accent" />
            {t("SYNTHETIC GPS")} {settings.gps.talker}GGA {settings.gps.rate} Hz
          </span>
        )}
        <span className="flex-1" />
        <span>UTF-8</span>
      </footer>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/** Re-renders only when the simulator starts or stops, not on every sentence. */
function useSimulatorRunning(simulator: GpsSimulator) {
  const [running, setRunning] = useState(simulator.running);
  useEffect(() => simulator.changes.on(() => setRunning(simulator.running)), [simulator]);
  return running;
}

/** Playback state for the footer and the tab badge, without re-rendering on every answer. */
function usePlayerState(player: RoutePlayer) {
  const [state, setState] = useState(() => readPlayer(player));
  useEffect(
    () =>
      player.changes.on(() => {
        const next = readPlayer(player);
        setState((prev) => (prev.playing === next.playing && prev.position === next.position && prev.total === next.total ? prev : next));
      }),
    [player],
  );
  return state;
}

function readPlayer(player: RoutePlayer) {
  return { playing: player.playing, position: player.position, total: player.route?.steps.length ?? 0 };
}
