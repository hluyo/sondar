import { useEffect, useRef, useState, type ReactNode } from "react";
import { frameLabel, type PortInfo } from "../lib/serial";
import type { Settings } from "../lib/settings";
import { formatDuration } from "../lib/stream";
import type { Theme } from "../lib/theme";
import { FrameDiagram } from "./FrameDiagram";
import { ChartIcon, ChevronDownIcon, ChevronUpIcon, LogoIcon, MoonIcon, PlugIcon, RefreshIcon, SunIcon } from "./icons";
import { IconButton, Radio } from "./ui";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];
const DATA_BITS = [5, 6, 7, 8] as const;
const NOT_SUPPORTED = "Not supported yet";

const PARITY: { value: Settings["parity"] | "mark" | "space"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "odd", label: "Odd" },
  { value: "even", label: "Even" },
  { value: "mark", label: "Mark" },
  { value: "space", label: "Space" },
];
const STOP_BITS: { value: Settings["stopBits"] | 1.5; label: string }[] = [
  { value: 1, label: "1" },
  { value: 1.5, label: "1.5" },
  { value: 2, label: "2" },
];
const FLOW: { value: Settings["flowControl"]; label: string; short: string }[] = [
  { value: "none", label: "None", short: "no flow control" },
  { value: "hardware", label: "RTS/CTS", short: "RTS/CTS" },
  { value: "software", label: "XON/XOFF", short: "XON/XOFF" },
];

const baudLabel = (b: number) => (b >= 1_000_000 ? `${b / 1_000_000}M` : String(b));

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  ports: PortInfo[];
  onRefreshPorts: () => void;
  status: ConnectionStatus;
  connectedAt: number | null;
  onToggleConnection: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

/**
 * Top of the window: title bar plus the port settings. All options stay in view as
 * grouped radio buttons; once connected the groups fold into a one-line summary.
 */
export function ConnectionBar(props: Props) {
  const { status } = props;
  const [expanded, setExpanded] = useState(true);

  // Fold the settings when a connection opens, unfold them when it closes.
  useEffect(() => {
    if (status === "connected") setExpanded(false);
    if (status === "disconnected") setExpanded(true);
  }, [status]);

  return (
    <>
      <TitleBar {...props} />
      {expanded ? <SettingsPanel {...props} onCollapse={() => setExpanded(false)} /> : <Summary {...props} onExpand={() => setExpanded(true)} />}
    </>
  );
}

function TitleBar({ settings, update, status, connectedAt, theme, onToggleTheme }: Props) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2">
      <div className="mr-1.5 flex items-center gap-2.5 text-accent">
        <LogoIcon size={24} />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
          Sonda <span className="font-normal text-dim">Serial</span>
        </span>
      </div>
      <StatusPill status={status} connectedAt={connectedAt} />
      <div className="min-w-0 flex-1" />
      <button
        type="button"
        aria-pressed={settings.autoReconnect}
        onClick={() => update({ autoReconnect: !settings.autoReconnect })}
        className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-fg-2 hover:bg-raised"
      >
        <span className={`relative inline-block h-[18px] w-[30px] rounded-full ${settings.autoReconnect ? "bg-accent" : "bg-line-input"}`}>
          <span
            className={`absolute top-[2px] size-[14px] rounded-full transition-[left] ${
              settings.autoReconnect ? "left-[14px] bg-panel" : "left-[2px] bg-dim"
            }`}
          />
        </span>
        Auto-reconnect
      </button>
      <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={onToggleTheme}>
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </IconButton>
      <IconButton
        label={settings.showPlot ? "Hide plot" : "Show plot"}
        onClick={() => update({ showPlot: !settings.showPlot })}
        className={settings.showPlot ? "text-accent" : ""}
      >
        <ChartIcon />
      </IconButton>
    </header>
  );
}

function SettingsPanel({
  settings,
  update,
  ports,
  onRefreshPorts,
  status,
  onToggleConnection,
  onCollapse,
}: Props & { onCollapse: () => void }) {
  const locked = status === "connected" || status === "connecting";

  return (
    <section aria-label="Port settings" className="flex flex-wrap items-stretch gap-2.5 border-b border-line bg-panel px-4 pt-2 pb-3">
      <div className="flex w-32 flex-col gap-2 pt-2">
        <ConnectButton status={status} onClick={onToggleConnection} />
        <button
          type="button"
          onClick={onRefreshPorts}
          disabled={locked}
          className="flex h-[34px] items-center justify-center gap-2 rounded-lg font-medium text-fg-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-raised disabled:opacity-40"
        >
          <RefreshIcon size={14} />
          Rescan
        </button>
      </div>

      <Group legend="Port" disabled={locked}>
        <PortList ports={ports} value={settings.port} onChange={(port) => update({ port })} />
      </Group>

      <Group legend="Baud rate" disabled={locked}>
        <BaudGrid value={settings.baudRate} onChange={(baudRate) => update({ baudRate })} />
      </Group>

      <Group legend="Data bits" disabled={locked}>
        {DATA_BITS.map((n) => (
          <Radio key={n} name="data-bits" mono checked={settings.dataBits === n} onChange={() => update({ dataBits: n })}>
            {n}
          </Radio>
        ))}
      </Group>

      <Group legend="Parity" disabled={locked}>
        {PARITY.map((p) => {
          const supported = p.value === "none" || p.value === "odd" || p.value === "even";
          return (
            <Radio
              key={p.value}
              name="parity"
              checked={settings.parity === p.value}
              disabled={!supported}
              title={supported ? undefined : NOT_SUPPORTED}
              onChange={() => supported && update({ parity: p.value as Settings["parity"] })}
            >
              {p.label}
            </Radio>
          );
        })}
      </Group>

      <Group legend="Stop bits" disabled={locked}>
        {STOP_BITS.map((s) => {
          const supported = s.value !== 1.5;
          return (
            <Radio
              key={s.value}
              name="stop-bits"
              mono
              checked={settings.stopBits === s.value}
              disabled={!supported}
              title={supported ? undefined : NOT_SUPPORTED}
              onChange={() => supported && update({ stopBits: s.value as Settings["stopBits"] })}
            >
              {s.label}
            </Radio>
          );
        })}
      </Group>

      <Group legend="Flow control" disabled={locked}>
        {FLOW.map((f) => (
          <Radio key={f.value} name="flow-control" checked={settings.flowControl === f.value} onChange={() => update({ flowControl: f.value })}>
            {f.label}
          </Radio>
        ))}
      </Group>

      <Group legend="Frame · 'A' (0x41)" className="flex-[1_1_300px]">
        <FrameDiagram baudRate={settings.baudRate} dataBits={settings.dataBits} parity={settings.parity} stopBits={settings.stopBits} />
      </Group>

      <IconButton label="Hide settings" onClick={onCollapse} className="ml-auto size-8 self-start">
        <ChevronUpIcon size={14} />
      </IconButton>
    </section>
  );
}

function Summary({ settings, status, onToggleConnection, onExpand }: Props & { onExpand: () => void }) {
  const chip = "inline-flex h-7 items-center rounded-md border border-line-strong bg-raised px-2.5 font-mono text-xs text-fg-2";
  return (
    <section aria-label="Connection summary" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-line bg-panel px-4 py-2">
      <ConnectButton status={status} onClick={onToggleConnection} compact />
      <span className="inline-flex h-7 items-center rounded-md bg-accent-soft px-2.5 font-mono text-xs font-medium text-accent">
        {settings.port || "No port"}
      </span>
      <span className={chip}>{settings.baudRate} baud</span>
      <span className={chip}>{frameLabel(settings)}</span>
      <span className={chip}>{FLOW.find((f) => f.value === settings.flowControl)?.short}</span>
      <div className="min-w-0 flex-1" />
      <button type="button" onClick={onExpand} className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-fg-2 hover:bg-raised">
        Settings
        <ChevronDownIcon size={14} />
      </button>
    </section>
  );
}

function Group({
  legend,
  disabled,
  className = "",
  children,
}: {
  legend: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      disabled={disabled}
      className={`m-0 flex min-w-0 flex-col gap-px rounded-lg border border-line-strong bg-raised px-3 pt-1 pb-2.5 disabled:opacity-60 ${className}`}
    >
      <legend className="-ml-1 px-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{legend}</legend>
      {children}
    </fieldset>
  );
}

function ConnectButton({ status, onClick, compact }: { status: ConnectionStatus; onClick: () => void; compact?: boolean }) {
  const idle = status === "disconnected";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "connecting"}
      className={`flex items-center justify-center gap-2 rounded-lg font-semibold ${compact ? "h-8 px-3.5" : "h-10 px-[18px]"} ${
        idle ? "bg-accent text-on-accent hover:brightness-110" : "text-fg shadow-[inset_0_0_0_1px_var(--color-line-focus)] hover:bg-raised"
      }`}
    >
      <PlugIcon />
      {idle ? "Connect" : status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Cancel" : "Disconnect"}
    </button>
  );
}

function PortList({ ports, value, onChange }: { ports: PortInfo[]; value: string; onChange: (port: string) => void }) {
  const list = value && !ports.some((p) => p.name === value) ? [...ports, { name: value, description: "not connected" }] : ports;
  if (list.length === 0) {
    return <p className="m-0 max-w-44 py-1 text-xs leading-relaxed text-muted">No ports found. Plug in your board; the list updates by itself.</p>;
  }
  return (
    <div className="scroll-thin flex max-h-[148px] min-w-40 flex-col gap-px overflow-y-auto">
      {list.map((p) => (
        <Radio key={p.name} name="port" checked={p.name === value} onChange={() => onChange(p.name)}>
          <span className="flex max-w-56 flex-col py-0.5 leading-tight">
            <b className="font-mono text-xs font-medium">{p.name}</b>
            {p.description && <span className="truncate text-[11px] font-normal text-dim">{p.description}</span>}
          </span>
        </Radio>
      ))}
    </div>
  );
}

function BaudGrid({ value, onChange }: { value: number; onChange: (baud: number) => void }) {
  const custom = !BAUD_RATES.includes(value);
  const [text, setText] = useState(custom ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!BAUD_RATES.includes(value)) setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n > 0) onChange(n);
    else setText(custom ? String(value) : "");
  };

  return (
    <div className="grid grid-flow-col grid-rows-6 gap-x-3.5 gap-y-px">
      {BAUD_RATES.map((b) => (
        <Radio
          key={b}
          name="baud-rate"
          mono
          checked={value === b}
          onChange={() => {
            onChange(b);
            setText("");
          }}
        >
          {baudLabel(b)}
        </Radio>
      ))}
      <Radio name="baud-rate" mono checked={custom} onChange={() => inputRef.current?.focus()}>
        <input
          ref={inputRef}
          value={text}
          inputMode="numeric"
          placeholder="Other"
          aria-label="Custom baud rate"
          onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="h-[22px] w-[74px] rounded border border-line-strong bg-bg px-1.5 font-mono text-xs text-fg outline-none placeholder:text-dim focus:border-tx"
        />
      </Radio>
    </div>
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
    connected: { dot: "bg-ok shadow-[0_0_0_3px_var(--color-ok-ring)]", text: `Connected · ${formatDuration(now - (connectedAt ?? now))}` },
    connecting: { dot: "bg-warn", text: "Connecting…" },
    reconnecting: { dot: "bg-warn animate-pulse", text: "Waiting for device…" },
    disconnected: { dot: "bg-dim", text: "Disconnected" },
  }[status];

  return (
    <div className="flex h-8 items-center gap-2 rounded-full border border-line-strong bg-field px-3" aria-live="polite">
      <span className={`size-2 rounded-full ${meta.dot}`} />
      <span className="font-mono text-xs text-fg-2">{meta.text}</span>
    </div>
  );
}
