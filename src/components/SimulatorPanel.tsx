import { useEffect, useState } from "react";
import { FAULT_LABELS, type FaultKind, type GpsConfig, type GpsSimulator, type TrackMode } from "../lib/gpsSimulator";
import { t } from "../lib/i18n";
import { GGA_FIELDS } from "../lib/nmea";
import { PlayIcon } from "./icons";
import { Switch } from "./RoutePanel";
import { Segmented } from "./ui";

const fieldInput = "h-9 w-full min-w-0 rounded-lg border bg-field px-2.5 font-mono text-[12.5px] text-fg outline-none disabled:opacity-45";

/** Start/stop and status of the synthetic GPS, in place of the route player. */
export function SyntheticCard({ simulator, config, connected }: { simulator: GpsSimulator; config: GpsConfig; connected: boolean }) {
  const now = Date.now();
  const lostLeft = Math.ceil((simulator.lostUntil - now) / 1000);
  const silentLeft = Math.ceil((simulator.silentUntil - now) / 1000);
  const running = simulator.running;
  const noFix = lostLeft > 0 || config.quality === 0;

  let status: { text: string; dot: string };
  if (!connected) status = { text: t("Connect a port to start sending"), dot: "bg-dim" };
  else if (!running) status = { text: t("Stopped · {n} sentences sent", { n: simulator.frames }), dot: "bg-dim" };
  else if (silentLeft > 0) status = { text: t("Silent for {n} s · nothing is sent", { n: silentLeft }), dot: "bg-warn" };
  else
    status = {
      text: t("Sending {talker}GGA · {rate} Hz · {n} sentences", { talker: config.talker, rate: config.rate, n: simulator.frames }) + (noFix ? ` · ${t("no fix")}` : ""),
      dot: noFix ? "bg-warn" : "bg-ok",
    };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!connected}
          onClick={() => (running ? simulator.stop() : simulator.start())}
          className={`flex h-10 items-center gap-2 rounded-lg px-4 font-semibold disabled:opacity-45 ${
            running ? "text-fg shadow-[inset_0_0_0_1px_var(--color-line-focus)] hover:bg-field" : "bg-accent text-on-accent hover:brightness-110"
          }`}
        >
          {running ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h12v12H6z" />
            </svg>
          ) : (
            <PlayIcon size={13} />
          )}
          {running ? t("Stop") : t("Start sending")}
        </button>
        <TimedButton active={lostLeft > 0} disabled={!running} onClick={() => simulator.toggleLostFix()}>
          {lostLeft > 0 ? t("Fix lost · {n} s (restore)", { n: lostLeft }) : t("Lose fix for 10 s")}
        </TimedButton>
        <TimedButton active={silentLeft > 0} disabled={!running} onClick={() => simulator.toggleSilence()}>
          {silentLeft > 0 ? t("Silent · {n} s (resume)", { n: silentLeft }) : t("Go silent for 5 s")}
        </TimedButton>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-2" aria-live="polite">
        <span className={`size-2 shrink-0 rounded-full ${status.dot}`} />
        <span className="font-mono">{status.text}</span>
      </div>
    </div>
  );
}

function TimedButton({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !active}
      className={`flex h-10 items-center rounded-lg border px-3 font-medium disabled:opacity-45 ${
        active ? "border-transparent bg-accent-soft text-accent" : "border-line-strong text-fg hover:bg-field"
      }`}
    >
      {children}
    </button>
  );
}

/** Track, receiver and fault settings of the synthetic GPS. */
export function SyntheticSettings({ config, onConfigChange }: { config: GpsConfig; onConfigChange: (c: GpsConfig) => void }) {
  const set = (patch: Partial<GpsConfig>) => onConfigChange({ ...config, ...patch });
  const setFault = (kind: FaultKind, patch: Partial<GpsConfig["faults"][FaultKind]>) =>
    set({ faults: { ...config.faults, [kind]: { ...config.faults[kind], ...patch } } });
  const modes: { value: TrackMode; label: string }[] = [
    { value: "fixed", label: t("Fixed point") },
    { value: "circle", label: t("Circle") },
    { value: "line", label: t("Straight line") },
  ];
  const faults: { kind: FaultKind; name: string; hint: string }[] = [
    { kind: "checksum", name: t("Bad checksum"), hint: t("Wrong *hh at the end") },
    { kind: "truncate", name: t("Truncated sentence"), hint: t("Cut before the end, no checksum") },
    { kind: "garbage", name: t("Garbage bytes"), hint: t("Noise before the $") },
  ];
  const title = "m-0 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted";

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={title}>{t("Track")}</h3>
          <Segmented label={t("Movement")} value={config.mode} options={modes} onChange={(mode) => set({ mode })} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <NumberField label={t("Latitude (°)")} value={config.lat} min={-90} max={90} onChange={(lat) => set({ lat })} />
          <NumberField label={t("Longitude (°)")} value={config.lon} min={-180} max={180} onChange={(lon) => set({ lon })} />
          <NumberField label={t("Altitude (m)")} value={config.altitude} min={-1000} max={20000} onChange={(altitude) => set({ altitude })} />
          <NumberField label={t("Speed (m/s)")} value={config.speed} min={0} max={400} disabled={config.mode === "fixed"} onChange={(speed) => set({ speed })} />
          {config.mode === "circle" && <NumberField label={t("Radius (m)")} value={config.radius} min={1} max={100000} onChange={(radius) => set({ radius })} />}
          {config.mode === "line" && <NumberField label={t("Heading (°)")} value={config.heading} min={0} max={360} onChange={(heading) => set({ heading })} />}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className={title}>{t("Receiver")}</h3>
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex min-w-[130px] flex-1 flex-col gap-1 text-[11.5px] text-muted">
            {t("Fix quality")}
            <select
              value={config.quality}
              onChange={(e) => set({ quality: Number(e.target.value) as GpsConfig["quality"] })}
              className="h-9 rounded-lg border border-line-strong bg-field px-2 text-[12.5px] text-fg outline-none"
            >
              <option value={1}>1 · {t("GPS fix")}</option>
              <option value={2}>2 · {t("DGPS fix")}</option>
              <option value={0}>0 · {t("No fix")}</option>
            </select>
          </label>
          <div className="flex flex-col gap-1 text-[11.5px] text-muted">
            {t("Satellites")}
            <div className="flex h-9 items-center rounded-lg border border-line-strong bg-field">
              <button type="button" aria-label={t("Fewer satellites")} onClick={() => set({ satellites: Math.max(0, config.satellites - 1) })} className="h-full w-8 text-base text-fg-2">
                −
              </button>
              <span className="w-7 text-center font-mono text-[12.5px] text-fg">{config.satellites}</span>
              <button type="button" aria-label={t("More satellites")} onClick={() => set({ satellites: Math.min(24, config.satellites + 1) })} className="h-full w-8 text-base text-fg-2">
                +
              </button>
            </div>
          </div>
          <div className="w-[72px]">
            <NumberField label="HDOP" value={config.hdop} min={0} max={99.9} onChange={(hdop) => set({ hdop })} />
          </div>
          <div className="flex flex-col gap-1 text-[11.5px] text-muted">
            {t("Rate")}
            <Segmented
              label={t("Sentences per second")}
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
                { value: "GP", label: "GP", title: t("GPS only") },
                { value: "GN", label: "GN", title: t("Multi-constellation (GNSS)") },
              ]}
              onChange={(talker) => set({ talker })}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={title}>{t("Simulate errors")}</h3>
        {faults.map((f) => {
          const fault = config.faults[f.kind];
          return (
            <div key={f.kind} className="flex flex-wrap items-center gap-2.5">
              <Switch on={fault.on} label={f.name} onClick={() => setFault(f.kind, { on: !fault.on })} />
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
                  aria-label={t("{name}: probability", { name: f.name })}
                  onChange={(e) => setFault(f.kind, { percent: Number(e.target.value) })}
                  className="w-24 accent-[var(--color-accent)]"
                />
                <span className="w-9 text-right">{fault.percent} %</span>
              </label>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** The last synthetic sentence, field by field. */
export function LastSentence({ simulator }: { simulator: GpsSimulator }) {
  const last = simulator.last;
  if (!last) return <p className="m-0 text-xs text-muted">{t("Nothing sent yet.")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-xs whitespace-nowrap text-tx select-text scroll-thin">
        {last.text}
        <span className="text-dim">\r\n</span>
        {(last.fault || last.garbage) && <span className="text-warn">  « {t(FAULT_LABELS[last.fault ?? "garbage"])}</span>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5">
        <Chip label={t("Sentence")} value={`${last.talker}GGA`} tone="text-tx" />
        {last.fields.map((value, i) => (
          <Chip key={i} label={t(GGA_FIELDS[i])} value={value || t("(empty)")} tone={value ? "text-fg" : "text-dim"} />
        ))}
        <Chip label={last.fault === "checksum" ? t("Checksum (wrong)") : "Checksum"} value={`*${last.checksum}`} tone={last.fault === "checksum" ? "text-err" : "text-ok"} />
      </div>
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
