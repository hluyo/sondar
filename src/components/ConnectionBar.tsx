import { useEffect, useState } from "react";
import type { PortInfo } from "../lib/serial";
import type { Settings } from "../lib/settings";
import { formatDuration } from "../lib/stream";
import { ChartIcon, LogoIcon, PlugIcon, RefreshIcon } from "./icons";
import { Field, IconButton, selectClass } from "./ui";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  ports: PortInfo[];
  onRefreshPorts: () => void;
  status: ConnectionStatus;
  connectedAt: number | null;
  onToggleConnection: () => void;
}

export function ConnectionBar({ settings, update, ports, onRefreshPorts, status, connectedAt, onToggleConnection }: Props) {
  const locked = status === "connected" || status === "connecting";
  const known = ports.some((p) => p.name === settings.port);
  const [baudText, setBaudText] = useState(String(settings.baudRate));

  useEffect(() => setBaudText(String(settings.baudRate)), [settings.baudRate]);

  const commitBaud = () => {
    const n = Number(baudText);
    if (Number.isInteger(n) && n > 0) update({ baudRate: n });
    else setBaudText(String(settings.baudRate));
  };

  return (
    <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-panel px-4 py-2.5">
      <div className="mr-2 flex items-center gap-2.5 text-accent">
        <LogoIcon />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">FreeSerial</span>
      </div>

      <Field label="Puerto">
        <select
          className={`${selectClass} max-w-64`}
          value={settings.port}
          disabled={locked}
          onFocus={onRefreshPorts}
          onChange={(e) => update({ port: e.target.value })}
        >
          {!settings.port && <option value="">Elige un puerto…</option>}
          {settings.port && !known && <option value={settings.port}>{settings.port} · no conectado</option>}
          {ports.map((p) => (
            <option key={p.name} value={p.name}>
              {p.description ? `${p.name} · ${p.description}` : p.name}
            </option>
          ))}
        </select>
      </Field>
      <IconButton label="Buscar puertos" onClick={onRefreshPorts} disabled={locked}>
        <RefreshIcon />
      </IconButton>

      <Field label="Baudios">
        <input
          className={`${selectClass} w-[88px] font-mono`}
          list="baud-rates"
          inputMode="numeric"
          value={baudText}
          disabled={locked}
          onChange={(e) => setBaudText(e.target.value.replace(/\D/g, ""))}
          onBlur={commitBaud}
          onKeyDown={(e) => e.key === "Enter" && commitBaud()}
        />
        <datalist id="baud-rates">
          {BAUD_RATES.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>

      <Field label="Datos">
        <select
          className={`${selectClass} font-mono`}
          value={settings.dataBits}
          disabled={locked}
          onChange={(e) => update({ dataBits: Number(e.target.value) as Settings["dataBits"] })}
        >
          {[8, 7, 6, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Paridad">
        <select
          className={selectClass}
          value={settings.parity}
          disabled={locked}
          onChange={(e) => update({ parity: e.target.value as Settings["parity"] })}
        >
          <option value="none">Ninguna</option>
          <option value="even">Par</option>
          <option value="odd">Impar</option>
        </select>
      </Field>
      <Field label="Stop">
        <select
          className={`${selectClass} font-mono`}
          value={settings.stopBits}
          disabled={locked}
          onChange={(e) => update({ stopBits: Number(e.target.value) as Settings["stopBits"] })}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
        </select>
      </Field>
      <Field label="Flujo">
        <select
          className={selectClass}
          value={settings.flowControl}
          disabled={locked}
          onChange={(e) => update({ flowControl: e.target.value as Settings["flowControl"] })}
        >
          <option value="none">Ninguno</option>
          <option value="hardware">RTS/CTS</option>
          <option value="software">XON/XOFF</option>
        </select>
      </Field>

      <button
        type="button"
        onClick={onToggleConnection}
        disabled={status === "connecting"}
        className={`flex h-10 items-center gap-2 rounded-lg px-[18px] font-semibold ${
          status === "disconnected"
            ? "bg-accent text-on-accent hover:brightness-110"
            : "text-fg shadow-[inset_0_0_0_1px_#363e4b] hover:bg-raised"
        }`}
      >
        <PlugIcon />
        {status === "disconnected" ? "Conectar" : status === "connecting" ? "Conectando…" : status === "reconnecting" ? "Cancelar" : "Desconectar"}
      </button>

      <StatusPill status={status} connectedAt={connectedAt} />

      <div className="min-w-0 flex-1" />

      <button
        type="button"
        aria-pressed={settings.autoReconnect}
        onClick={() => update({ autoReconnect: !settings.autoReconnect })}
        className="flex h-10 items-center gap-2.5 px-2 text-fg-2"
      >
        <span className={`relative inline-block h-[18px] w-[30px] rounded-full ${settings.autoReconnect ? "bg-accent" : "bg-[#2a303b]"}`}>
          <span
            className={`absolute top-[2px] size-[14px] rounded-full transition-[left] ${
              settings.autoReconnect ? "left-[14px] bg-panel" : "left-[2px] bg-dim"
            }`}
          />
        </span>
        Reconexión automática
      </button>
      <IconButton
        label={settings.showPlot ? "Ocultar gráfica" : "Mostrar gráfica"}
        onClick={() => update({ showPlot: !settings.showPlot })}
        className={settings.showPlot ? "text-accent" : ""}
      >
        <ChartIcon />
      </IconButton>
    </header>
  );
}

function StatusPill({ status, connectedAt }: { status: ConnectionStatus; connectedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const meta = {
    connected: { dot: "bg-ok shadow-[0_0_0_3px_rgba(61,214,140,0.18)]", text: `Conectado · ${formatDuration(now - (connectedAt ?? now))}` },
    connecting: { dot: "bg-warn", text: "Conectando…" },
    reconnecting: { dot: "bg-warn animate-pulse", text: "Esperando al dispositivo…" },
    disconnected: { dot: "bg-dim", text: "Desconectado" },
  }[status];

  return (
    <div className="flex h-8 items-center gap-2 rounded-full border border-line-strong bg-field px-3" aria-live="polite">
      <span className={`size-2 rounded-full ${meta.dot}`} />
      <span className="font-mono text-xs text-fg-2">{meta.text}</span>
    </div>
  );
}
