import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionBar, type ConnectionStatus } from "./components/ConnectionBar";
import { PlotPanel } from "./components/PlotPanel";
import { QuickCommands } from "./components/QuickCommands";
import { TerminalPanel } from "./components/TerminalPanel";
import { encodeCommand } from "./lib/encoding";
import { fileStamp, openFolder, saveExport } from "./lib/files";
import { PlotStore } from "./lib/plotStore";
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
import { toPortConfig, useSettings } from "./lib/settings";
import { useTheme } from "./lib/theme";
import { Emitter, formatBytes, type StreamEvent } from "./lib/stream";

const RECONNECT_MS = 1000;
const HISTORY_SIZE = 50;
const OUTPUTS_ON_OPEN: OutputLines = { dtr: true, rts: true };

export default function App() {
  const [settings, update] = useSettings();
  const theme = useTheme(settings.theme);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [counters, setCounters] = useState({ rx: 0, tx: 0 });
  const [outputs, setOutputs] = useState<OutputLines>(OUTPUTS_ON_OPEN);
  const [inputs, setInputs] = useState<InputLines | null>(null);
  const [log, setLog] = useState<{ path: string; bytes: number } | null>(null);

  const bus = useMemo(() => new Emitter<StreamEvent>(), []);
  const plotStore = useMemo(() => new PlotStore(), []);
  const countersRef = useRef({ rx: 0, tx: 0 });
  const settingsRef = useRef(settings);
  const statusRef = useRef(status);
  /** Each open gets a new id so late events from a previous connection are ignored. */
  const generation = useRef(0);
  const logRef = useRef<SessionLog | null>(null);

  settingsRef.current = settings;
  statusRef.current = status;

  const info = useCallback((text: string) => bus.emit({ kind: "info", text, time: Date.now() }), [bus]);
  const error = useCallback((text: string) => bus.emit({ kind: "error", text, time: Date.now() }), [bus]);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await listPorts());
    } catch (e) {
      error(`Could not list ports: ${e}`);
    }
  }, [error]);

  useEffect(
    () =>
      bus.on((e) => {
        if (e.kind === "rx") plotStore.pushBytes(e.bytes, e.time);
        logRef.current?.handle(e);
      }),
    [bus, plotStore],
  );

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
      error("Choose a port before connecting");
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
          error(`Connection lost: ${event.reason}`);
          if (settingsRef.current.autoReconnect) {
            info(`Waiting for ${config.port} to come back…`);
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
      info(`${config.port} opened · ${config.baudRate} ${frameLabel(config)}`);
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
      info(wasConnected ? `${settingsRef.current.port} closed` : "Reconnect cancelled");
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
        error(`Not sent (port closed): ${text}`);
        return;
      }
      const bytes = encodeCommand(text, s.lineEnding);
      try {
        await writePort(bytes);
        countersRef.current.tx += bytes.length;
        bus.emit({ kind: "tx", text, bytes, ending: s.lineEnding, time: Date.now() });
      } catch (e) {
        error(`Send failed: ${e}`);
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
        info(`${line.toUpperCase()} ${value ? "on" : "off"}`);
      } catch (e) {
        error(`Could not set ${line.toUpperCase()}: ${e}`);
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
        info(`Log saved: ${current.path}`);
      } catch (e) {
        error(`Could not close the log: ${e}`);
      }
      return;
    }
    const s = settingsRef.current;
    try {
      const header = `Sonda Serial log · ${s.port || "no port"} · ${s.baudRate} ${frameLabel(s)} · ${new Date().toLocaleString()}`;
      const started = await SessionLog.start(s.port, header, (e) => {
        logRef.current = null;
        setLog(null);
        error(`Logging stopped: ${e}`);
      });
      logRef.current = started;
      setLog({ path: started.path, bytes: 0 });
      info(`Logging to ${started.path}`);
    } catch (e) {
      error(`Could not start the log: ${e}`);
    }
  }, [info, error]);

  const showFolder = useCallback(
    (kind: "logs" | "exports") => openFolder(kind).catch((e) => error(`Could not open the folder: ${e}`)),
    [error],
  );

  const exportPlot = useCallback(async () => {
    try {
      const path = await saveExport(`${fileStamp()}_plot.csv`, plotStore.toCSV());
      info(`Plot exported: ${path}`);
      return path;
    } catch (e) {
      error(`Could not export the plot: ${e}`);
      return null;
    }
  }, [plotStore, info, error]);

  const clearAll = useCallback(() => {
    plotStore.clear();
    countersRef.current = { rx: 0, tx: 0 };
  }, [plotStore]);

  return (
    <div className="flex h-full flex-col">
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
        outputs={outputs}
        inputs={inputs}
        onSetOutput={setOutput}
      />

      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <QuickCommands
          commands={settings.quickCommands}
          onChange={(quickCommands) => update({ quickCommands })}
          onRun={send}
        />
        <TerminalPanel
          bus={bus}
          theme={theme}
          settings={settings}
          update={update}
          onSend={send}
          onClear={clearAll}
          log={log}
          onToggleLog={toggleLog}
          onOpenLogFolder={() => showFolder("logs")}
        />
        {settings.showPlot && (
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
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 border-t border-line bg-panel px-4 py-1.5 font-mono text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${status === "connected" ? "bg-ok" : "bg-dim"}`} />
          {settings.port || "—"} · {settings.baudRate} {frameLabel(settings)}
        </span>
        <span>RX {formatBytes(counters.rx)}</span>
        <span>TX {formatBytes(counters.tx)}</span>
        {log && (
          <span className="inline-flex items-center gap-1.5 text-err">
            <span className="size-1.5 animate-pulse rounded-full bg-err" />
            LOG {formatBytes(log.bytes)}
          </span>
        )}
        <span className="flex-1" />
        <span>UTF-8</span>
      </footer>
    </div>
  );
}
