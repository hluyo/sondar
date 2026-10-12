import { useEffect, useReducer, useState } from "react";
import { FAULT_LABELS, type FaultKind, type GpsConfig, type GpsSimulator, type TrackMode } from "../lib/gpsSimulator";
import { GGA_FIELDS } from "../lib/nmea";
import { PlayIcon } from "./icons";
import { Segmented } from "./ui";

interface Props {
  simulator: GpsSimulator;
  config: GpsConfig;
  onConfigChange: (config: GpsConfig) => void;
  connected: boolean;
}

const MODES: { value: TrackMode; label: string }[] = [
  { value: "fixed", label: "Fixed point" },
  { value: "circle", label: "Circle" },
  { value: "line", label: "Straight line" },
];

const FAULTS: { kind: FaultKind; name: string; hint: string }[] = [
  { kind: "checksum", name: "Bad checksum", hint: "Wrong *hh at the end" },
  { kind: "truncate", name: "Truncated sentence", hint: "Cut before the end, no checksum" },
  { kind: "garbage", name: "Garbage bytes", hint: "Noise before the $" },
];

const sectionTitle = "m-0 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted";
const fieldInput =
  "h-9 w-full min-w-0 rounded-lg border bg-field px-2.5 font-mono text-[12.5px] text-fg outline-none disabled:opacity-45";

/**
 * Controls for the GPS simulator. The simulator itself lives in App so it keeps
 * sending while another tab is shown; this panel only edits its settings.
 */
export function SimulatorPanel({ simulator, config, onConfigChange, connected }: Props) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => simulator.changes.on(rerender), [simulator]);
  // Countdowns for "lost fix" and "silent" keep moving even when no frame is sent.
  useEffect(() => {
    const id = window.setInterval(rerender, 500);
    return () => window.clearInterval(id);
  }, []);

  const set = (patch: Partial<GpsConfig>) => onConfigChange({ ...config, ...patch });
  const setFault = (kind: FaultKind, patch: Partial<GpsConfig["faults"][FaultKind]>) =>
    set({ faults: { ...config.faults, [kind]: { ...config.faults[kind], ...patch } } });

  const now = Date.now();
  const lostLeft = Math.ceil((simulator.lostUntil - now) / 1000);
  const silentLeft = Math.ceil((simulator.silentUntil - now) / 1000);
  const running = simulator.running;
  const last = simulator.last;

  let status: { text: string; dot: string };
  if (!connected) status = { text: "Connect a port to start sending", dot: "bg-dim" };
  else if (!running) status = { text: `Stopped · ${simulator.frames} sentences sent`, dot: "bg-dim" };
  else if (silentLeft > 0) status = { text: `Silent for ${silentLeft} s · nothing is sent`, dot: "bg-warn" };
  else
    status = {
      text: `Sending ${config.talker}GGA · ${config.rate} Hz · ${simulator.frames} sentences${lostLeft > 0 || config.quality === 0 ? " · no fix" : ""}`,
      dot: lostLeft > 0 || config.quality === 0 ? "bg-warn" : "bg-ok",
    };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3.5 scroll-thin">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">GPS receiver</h2>
          <span className="text-xs text-muted">Sends NMEA GGA sentences to the device, like a GPS module</span>
        </div>
        <button
          type="button"
          disabled={!connected}
          onClick={() => (running ? simulator.stop() : simulator.start())}
          className={`flex h-10 items-center gap-2 rounded-lg px-[18px] font-semibold disabled:opacity-45 ${
            running ? "text-fg shadow-[inset_0_0_0_1px_var(--color-line-focus)] hover:bg-raised" : "bg-accent text-on-accent hover:brightness-110"
          }`}
        >
          {running ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h12v12H6z" />
            </svg>
          ) : (
            <PlayIcon size={13} />
          )}
          {running ? "Stop" : "Start sending"}
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-fg-2" aria-live="polite">
        <span className={`size-2 shrink-0 rounded-full ${status.dot}`} />
        <span className="font-mono">{status.text}</span>
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitle}>Track</h3>
          <Segmented label="Movement" value={config.mode} options={MODES} onChange={(mode) => set({ mode })} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <NumberField label="Latitude (°)" value={config.lat} min={-90} max={90} onChange={(lat) => set({ lat })} />
          <NumberField label="Longitude (°)" value={config.lon} min={-180} max={180} onChange={(lon) => set({ lon })} />
          <NumberField label="Altitude (m)" value={config.altitude} min={-1000} max={20000} onChange={(altitude) => set({ altitude })} />
          <NumberField
            label="Speed (m/s)"
            value={config.speed}
            min={0}
            max={400}
            disabled={config.mode === "fixed"}
            onChange={(speed) => set({ speed })}
          />
          {config.mode === "circle" && <NumberField label="Radius (m)" value={config.radius} min={1} max={100000} onChange={(radius) => set({ radius })} />}
          {config.mode === "line" && <NumberField label="Heading (°)" value={config.heading} min={0} max={360} onChange={(heading) => set({ heading })} />}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className={sectionTitle}>Receiver</h3>
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex min-w-[130px] flex-1 flex-col gap-1 text-[11.5px] text-muted">
            Fix quality
            <select
              value={config.quality}
              onChange={(e) => set({ quality: Number(e.target.value) as GpsConfig["quality"] })}
              className="h-9 rounded-lg border border-line-strong bg-field px-2 text-[12.5px] text-fg outline-none"
            >
              <option value={1}>1 · GPS fix</option>
              <option value={2}>2 · DGPS fix</option>
              <option value={0}>0 · No fix</option>
            </select>
          </label>
          <div className="flex flex-col gap-1 text-[11.5px] text-muted">
            Satellites
            <div className="flex h-9 items-center rounded-lg border border-line-strong bg-field">
              <button type="button" aria-label="Fewer satellites" onClick={() => set({ satellites: Math.max(0, config.satellites - 1) })} className="h-full w-8 text-base text-fg-2">
                −
              </button>
              <span className="w-7 text-center font-mono text-[12.5px] text-fg">{config.satellites}</span>
              <button type="button" aria-label="More satellites" onClick={() => set({ satellites: Math.min(24, config.satellites + 1) })} className="h-full w-8 text-base text-fg-2">
                +
              </button>
            </div>
          </div>
          <div className="w-[72px]">
            <NumberField label="HDOP" value={config.hdop} min={0} max={99.9} onChange={(hdop) => set({ hdop })} />
          </div>
          <div className="flex flex-col gap-1 text-[11.5px] text-muted">
            Rate
            <Segmented
              label="Sentences per second"
              mono
              value={config.rate}
              options={([1, 2, 5, 10] as const).map((r) => ({ value: r, label: `${r} Hz` }))}
              onChange={(rate) => set({ rate })}
            />
          </div>
          <div className="flex flex-col gap-1 text-[11.5px] text-muted">
            Talker
            <Segmented
              label="Talker ID"
              mono
              value={config.talker}
              options={[
                { value: "GP", label: "GP", title: "GPS only" },
                { value: "GN", label: "GN", title: "Multi-constellation (GNSS)" },
              ]}
              onChange={(talker) => set({ talker })}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Fault injection</h3>
        {FAULTS.map((f) => {
          const fault = config.faults[f.kind];
          return (
            <div key={f.kind} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-1.5">
              <button
                type="button"
                aria-pressed={fault.on}
                aria-label={f.name}
                onClick={() => setFault(f.kind, { on: !fault.on })}
                className="grid h-8 w-10 place-items-center"
              >
                <span className={`relative inline-block h-[18px] w-[30px] rounded-full ${fault.on ? "bg-accent" : "bg-line-input"}`}>
                  <span className={`absolute top-[2px] size-[14px] rounded-full transition-[left] ${fault.on ? "left-[14px] bg-panel" : "left-[2px] bg-dim"}`} />
                </span>
              </button>
              <span className="flex min-w-[150px] flex-1 flex-col">
                <span className="font-medium">{f.name}</span>
                <span className="text-[11.5px] text-muted">{f.hint}</span>
              </span>
              <label className={`flex items-center gap-2 font-mono text-xs text-fg-2 ${fault.on ? "" : "opacity-45"}`}>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={fault.percent}
                  aria-label={`${f.name} probability`}
                  onChange={(e) => setFault(f.kind, { percent: Number(e.target.value) })}
                  className="w-24 accent-[var(--color-accent)]"
                />
                <span className="w-9 text-right">{fault.percent} %</span>
              </label>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <TimedButton active={lostLeft > 0} disabled={!running} onClick={() => simulator.toggleLostFix()}>
            {lostLeft > 0 ? `Fix lost · ${lostLeft} s (restore)` : "Lose fix for 10 s"}
          </TimedButton>
          <TimedButton active={silentLeft > 0} disabled={!running} onClick={() => simulator.toggleSilence()}>
            {silentLeft > 0 ? `Silent · ${silentLeft} s (resume)` : "Go silent for 5 s"}
          </TimedButton>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Last sentence, field by field</h3>
        {last ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-xs whitespace-nowrap text-tx select-text scroll-thin">
              {last.text}
              <span className="text-dim">\r\n</span>
              {(last.fault || last.garbage) && (
                <span className="text-warn">  « injected: {last.fault ? FAULT_LABELS[last.fault] : FAULT_LABELS.garbage}</span>
              )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5">
              <Chip label="Sentence" value={`${last.talker}GGA`} tone="text-tx" />
              {last.fields.map((value, i) => (
                <Chip key={i} label={GGA_FIELDS[i]} value={value || "(empty)"} tone={value ? "text-fg" : "text-dim"} />
              ))}
              <Chip
                label={last.fault === "checksum" ? "Checksum (wrong)" : "Checksum"}
                value={`*${last.checksum}`}
                tone={last.fault === "checksum" ? "text-err" : "text-ok"}
              />
            </div>
          </>
        ) : (
          <p className="m-0 text-xs text-muted">Nothing sent yet.</p>
        )}
      </section>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-raised px-2 py-1.5">
      <span className="truncate text-[10.5px] text-muted">{label}</span>
      <span className={`truncate font-mono text-xs ${tone}`}>{value}</span>
    </div>
  );
}

function TimedButton({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !active}
      className={`flex h-10 flex-[1_1_180px] items-center justify-center rounded-lg border px-3 font-medium disabled:opacity-45 ${
        active ? "border-transparent bg-accent-soft text-accent" : "border-line-strong text-fg hover:bg-raised"
      }`}
    >
      {children}
    </button>
  );
}

/** Numeric input that applies on Enter or when leaving the field, and rejects out-of-range values. */
function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const n = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max;
  const commit = () => {
    if (valid && n !== value) onChange(n);
    else if (!valid) setText(String(value));
  };

  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11.5px] text-muted">
      {label}
      <input
        value={text}
        inputMode="decimal"
        disabled={disabled}
        aria-invalid={!valid}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={`${fieldInput} ${valid ? "border-line-strong focus:border-tx" : "border-err"}`}
      />
    </label>
  );
}
