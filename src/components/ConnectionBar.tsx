import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Language, t } from "../lib/i18n";
import { frameLabel, type InputLines, type OutputLines, type PortInfo } from "../lib/serial";
import type { Settings } from "../lib/settings";
import { formatDuration } from "../lib/stream";
import type { Theme } from "../lib/theme";
import { FrameDiagram } from "./FrameDiagram";
import { ChartIcon, ChevronDownIcon, ChevronUpIcon, GearIcon, MoonIcon, PlugIcon, SunIcon } from "./icons";
import { Switch } from "./RoutePanel";
import { IconButton, Segmented } from "./ui";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];

type Frame = Pick<Settings, "dataBits" | "parity" | "stopBits">;

/** The frames almost everyone uses, listed first in the drop-down. */
const COMMON_FRAMES: Frame[] = [
  { dataBits: 8, parity: "none", stopBits: 1 },
  { dataBits: 8, parity: "even", stopBits: 1 },
  { dataBits: 8, parity: "odd", stopBits: 1 },
  { dataBits: 8, parity: "none", stopBits: 2 },
  { dataBits: 7, parity: "even", stopBits: 1 },
  { dataBits: 7, parity: "odd", stopBits: 1 },
];

const frameKey = (f: Frame) => `${f.dataBits}-${f.parity}-${f.stopBits}`;

/** Every other supported combination (5–8 data bits, none/even/odd parity, 1 or 2 stop bits). */
const OTHER_FRAMES: Frame[] = ([8, 7, 6, 5] as const)
  .flatMap((dataBits) =>
    (["none", "even", "odd"] as const).flatMap((parity) => ([1, 2] as const).map((stopBits) => ({ dataBits, parity, stopBits }))),
  )
  .filter((f) => !COMMON_FRAMES.some((c) => frameKey(c) === frameKey(f)));

/** ST-LINK virtual COM ports, the usual board in the lab. */
export const isStBoard = (p: PortInfo) => /st-?link|stmicro/i.test(p.description);

/** Short name for a port in the drop-down: "COM8 · ST-LINK". */
function portLabel(p: PortInfo) {
  if (isStBoard(p)) return `${p.name} · ST-LINK`;
  const d = p.description.replace(/\s*\(COM\d+\)\s*$/i, "");
  return d ? `${p.name} · ${d.length > 24 ? `${d.slice(0, 23)}…` : d}` : p.name;
}

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
  language: Language;
  onOpenHelp: () => void;
  outputs: OutputLines;
  /** Null while no port is open. */
  inputs: InputLines | null;
  onSetOutput: (line: keyof OutputLines, value: boolean) => void;
  /** Forgets every setting, quick command and route, as on a fresh install. */
  onResetAll: () => void;
}

/**
 * The command bar: Connect, the connection state and the three settings people
 * change (port, speed, frame) as drop-downs, the only place they are set.
 * The rest lives in a "More settings" flyout that floats over the window.
 */
export function ConnectionBar(props: Props) {
  const { settings, update, ports, onRefreshPorts, status, connectedAt, theme, onToggleTheme, language } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusCustomBaud, setFocusCustomBaud] = useState(false);
  const locked = status === "connected" || status === "connecting";
  const lockedTitle = locked ? t("Disconnect to change it") : undefined;
  const knownPort = ports.some((p) => p.name === settings.port);
  const bauds = BAUD_RATES.includes(settings.baudRate) ? BAUD_RATES : [...BAUD_RATES, settings.baudRate].sort((a, b) => a - b);
  const allFrames = [...COMMON_FRAMES, ...OTHER_FRAMES];

  const openMore = (customBaud = false) => {
    setFocusCustomBaud(customBaud);
    setMoreOpen(true);
  };

  return (
    <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-bg px-4 py-2.5">
      <ConnectButton status={status} onClick={props.onToggleConnection} />
      <StatusPill status={status} connectedAt={connectedAt} />
      <span className="mx-1 h-6 w-px bg-line-strong" />

      <Combo label={t("Port")} value={settings.port} disabled={locked} title={lockedTitle} width="190px" onFocus={onRefreshPorts} onChange={(port) => update({ port })}>
        {!settings.port && <option value="">{ports.length ? t("Choose a port") : t("No ports")}</option>}
        {settings.port && !knownPort && <option value={settings.port}>{`${settings.port} · ${t("not connected")}`}</option>}
        {ports.map((p) => (
          <option key={p.name} value={p.name}>
            {portLabel(p)}
          </option>
        ))}
      </Combo>

      <Combo
        label={t("Speed")}
        value={String(settings.baudRate)}
        disabled={locked}
        title={lockedTitle}
        width="112px"
        onChange={(v) => (v === "other" ? openMore(true) : update({ baudRate: Number(v) }))}
      >
        {bauds.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
        <option value="other">{t("Other…")}</option>
      </Combo>

      <Combo
        label={t("Frame")}
        value={frameKey(settings)}
        disabled={locked}
        title={lockedTitle ?? t("Data bits, parity and stop bits")}
        width="82px"
        onChange={(v) => {
          const f = allFrames.find((x) => frameKey(x) === v);
          if (f) update({ dataBits: f.dataBits, parity: f.parity, stopBits: f.stopBits });
        }}
      >
        <optgroup label={t("Common")}>
          {COMMON_FRAMES.map((f) => (
            <option key={frameKey(f)} value={frameKey(f)}>
              {frameLabel(f)}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("Others")}>
          {OTHER_FRAMES.map((f) => (
            <option key={frameKey(f)} value={frameKey(f)}>
              {frameLabel(f)}
            </option>
          ))}
        </optgroup>
      </Combo>

      <div className="relative">
        <button
          type="button"
          onClick={() => (moreOpen ? setMoreOpen(false) : openMore())}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={`flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-fg ${moreOpen ? "bg-toggle-on" : "hover:bg-field"}`}
        >
          <GearIcon size={15} />
          {t("More settings")}
          {moreOpen ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
        </button>
        {moreOpen && <MoreSettings {...props} focusCustomBaud={focusCustomBaud} onClose={() => setMoreOpen(false)} />}
      </div>

      <div className="min-w-0 flex-1" />
      <Segmented
        label={t("Language")}
        value={language}
        options={[
          { value: "es", label: "ES", title: "Español" },
          { value: "en", label: "EN", title: "English" },
        ]}
        onChange={(lang) => update({ language: lang })}
      />
      <IconButton label={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")} onClick={onToggleTheme} className="size-8 border-transparent">
        {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
      </IconButton>
      <IconButton label={t("Quick guide")} onClick={props.onOpenHelp} className="size-8 border-transparent font-semibold">
        ?
      </IconButton>
      <IconButton
        label={settings.showPlot ? t("Hide side panel (plot, GPS)") : t("Show side panel (plot, GPS)")}
        onClick={() => update({ showPlot: !settings.showPlot })}
        className={`size-8 border-transparent ${settings.showPlot ? "text-accent" : ""}`}
      >
        <ChartIcon size={15} />
      </IconButton>
    </header>
  );
}

/** Windows-style combo box: a labelled native select with its own chevron. */
function Combo({
  label,
  value,
  onChange,
  onFocus,
  disabled,
  width,
  title,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  disabled?: boolean;
  width: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted" title={title}>
      {label}
      <span className="relative inline-flex">
        <select
          value={value}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          style={{ width }}
          className="h-8 appearance-none rounded-md border border-line-strong border-b-line-focus bg-raised pr-8 pl-2.5 text-sm text-fg outline-none hover:bg-field focus-visible:border-b-accent disabled:cursor-default disabled:text-fg-2 disabled:hover:bg-raised"
        >
          {children}
        </select>
        <ChevronDownIcon size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
      </span>
    </label>
  );
}

/**
 * Flyout with what is not in the bar: a custom speed, flow control, control
 * lines, auto-reconnect and the frame diagram. It floats over the window, so
 * nothing moves; a click outside or Esc closes it.
 */
function MoreSettings(props: Props & { focusCustomBaud: boolean; onClose: () => void }) {
  const { settings, update, status, outputs, inputs, onSetOutput, focusCustomBaud, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const baudInput = useRef<HTMLInputElement>(null);
  const [baudText, setBaudText] = useState(BAUD_RATES.includes(settings.baudRate) ? "" : String(settings.baudRate));
  const [confirmReset, setConfirmReset] = useState(false);
  const locked = status === "connected" || status === "connecting";
  const connected = status === "connected";

  useEffect(() => {
    if (focusCustomBaud) baudInput.current?.focus();
  }, [focusCustomBaud]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const button = ref.current?.parentElement?.querySelector("button");
      if (!ref.current?.contains(e.target as Node) && !button?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const baud = Number(baudText);
  const baudValid = Number.isInteger(baud) && baud >= 50 && baud <= 12_000_000;
  const applyBaud = () => baudValid && update({ baudRate: baud });

  const lines: { key: keyof InputLines; label: string; title: string }[] = [
    { key: "cts", label: "CTS", title: "Clear To Send" },
    { key: "dsr", label: "DSR", title: "Data Set Ready" },
    { key: "cd", label: "CD", title: "Carrier Detect" },
    { key: "ri", label: "RI", title: "Ring Indicator" },
  ];
  const outputButton = (line: keyof OutputLines, title: string, ownedByFlow = false) => {
    const on = outputs[line];
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={!connected || ownedByFlow}
        title={ownedByFlow ? t("Controlled by RTS/CTS flow control") : title}
        onClick={() => onSetOutput(line, !on)}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-xs disabled:opacity-40 ${
          on ? "border-transparent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-fg"
        }`}
      >
        <span className={`size-1.5 rounded-full ${on ? "bg-accent" : "bg-line-input"}`} />
        {line.toUpperCase()}
      </button>
    );
  };
  const row = "flex items-center justify-between gap-4 py-2.5";

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("More settings")}
      className="absolute top-10 left-0 z-[1100] w-[440px] max-w-[calc(100vw-32px)] rounded-xl border border-line-strong bg-panel px-4 py-2 shadow-[0_8px_24px_var(--color-shadow)]"
    >
      <div className={`${row} border-b border-line`}>
        <label htmlFor="custom-baud" className="text-sm">
          {t("Custom speed")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="custom-baud"
            ref={baudInput}
            value={baudText}
            inputMode="numeric"
            disabled={locked}
            placeholder={String(settings.baudRate)}
            onChange={(e) => setBaudText(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && applyBaud()}
            className="h-8 w-28 rounded-md border border-line-strong border-b-line-focus bg-raised px-2.5 font-mono text-sm text-fg outline-none focus:border-b-accent disabled:opacity-50"
          />
          <span className="text-xs text-muted">{t("baud")}</span>
          <button
            type="button"
            onClick={applyBaud}
            disabled={locked || !baudValid}
            className="h-8 rounded-md bg-accent px-3 text-sm text-on-accent hover:brightness-110 disabled:opacity-40"
          >
            {t("Apply")}
          </button>
        </div>
      </div>

      <div className={`${row} border-b border-line`}>
        <label htmlFor="flow-control" className="text-sm">
          {t("Flow control")}
        </label>
        <span className="relative inline-flex">
          <select
            id="flow-control"
            value={settings.flowControl}
            disabled={locked}
            onChange={(e) => update({ flowControl: e.target.value as Settings["flowControl"] })}
            className="h-8 w-40 appearance-none rounded-md border border-line-strong border-b-line-focus bg-raised pr-8 pl-2.5 text-sm text-fg outline-none disabled:opacity-60"
          >
            <option value="none">{t("No flow control")}</option>
            <option value="hardware">RTS/CTS</option>
            <option value="software">XON/XOFF</option>
          </select>
          <ChevronDownIcon size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
        </span>
      </div>

      <div className={`${row} border-b border-line`}>
        <span className="flex flex-col">
          <span className="text-sm">{t("Auto-reconnect")}</span>
          <span className="text-xs text-muted">{t("If the board is unplugged, wait for it and connect again")}</span>
        </span>
        <Switch on={settings.autoReconnect} label={t("Auto-reconnect")} onClick={() => update({ autoReconnect: !settings.autoReconnect })} />
      </div>

      <div className={`${row} border-b border-line`}>
        <span className="text-sm">{t("Control lines")}</span>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {outputButton("dtr", "Data Terminal Ready")}
            {outputButton("rts", "Request To Send", settings.flowControl === "hardware")}
          </div>
          <div className="flex gap-2.5">
            {lines.map((l) => {
              const on = inputs?.[l.key] ?? false;
              return (
                <span key={l.key} title={l.title} className="flex items-center gap-1 font-mono text-[11px] text-muted">
                  <span className={`size-2 rounded-full ${on ? "bg-ok" : "bg-line-input"}`} />
                  {l.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 py-2.5">
        <span className="text-sm">
          {t("Frame of 'A' (0x41)")} · <span className="font-mono text-xs text-muted">{frameLabel(settings)}</span>
        </span>
        <FrameDiagram baudRate={settings.baudRate} dataBits={settings.dataBits} parity={settings.parity} stopBits={settings.stopBits} />
      </div>

      <div className={`${row} border-t border-line`}>
        <span className="flex flex-col">
          <span className="text-sm">{t("Reset everything")}</span>
          <span className="text-xs text-muted">{t("Settings, quick commands and route back to a fresh install")}</span>
        </span>
        {confirmReset ? (
          <span className="flex gap-1.5">
            <button type="button" onClick={() => setConfirmReset(false)} className="h-8 rounded-md border border-line-strong bg-raised px-3 text-sm hover:bg-field">
              {t("Cancel")}
            </button>
            <button type="button" onClick={props.onResetAll} className="h-8 rounded-md bg-err px-3 text-sm text-white hover:brightness-110">
              {t("Yes, reset")}
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className="h-8 rounded-md border border-line-strong bg-raised px-3 text-sm hover:bg-field">
            {t("Reset…")}
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectButton({ status, onClick }: { status: ConnectionStatus; onClick: () => void }) {
  const idle = status === "disconnected";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "connecting"}
      className={`flex h-8 items-center justify-center gap-2 rounded-md px-3.5 ${
        idle ? "bg-accent text-on-accent hover:brightness-110" : "border border-line-strong border-b-line-focus bg-raised text-fg hover:bg-field"
      }`}
    >
      <PlugIcon />
      {idle ? t("Connect") : status === "connecting" ? t("Connecting…") : status === "reconnecting" ? t("Cancel") : t("Disconnect")}
    </button>
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
    connected: { dot: "bg-ok", pill: "border-transparent bg-ok-ring text-ok", text: `${t("Connected")} · ${formatDuration(now - (connectedAt ?? now))}` },
    connecting: { dot: "bg-warn", pill: "border-line-strong bg-field text-fg-2", text: t("Connecting…") },
    reconnecting: { dot: "bg-warn animate-pulse", pill: "border-line-strong bg-field text-fg-2", text: t("Waiting for the device…") },
    disconnected: { dot: "bg-dim", pill: "border-line-strong bg-field text-fg-2", text: t("Disconnected") },
  }[status];

  return (
    <div className={`flex h-7 items-center gap-2 rounded-full border px-3 ${meta.pill}`} aria-live="polite">
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      <span className="text-xs">{meta.text}</span>
    </div>
  );
}
