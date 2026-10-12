import { useEffect, useRef, useState } from "react";
import { formatNumber, t } from "../lib/i18n";
import type { PositionTracker } from "../lib/positionTracker";
import { type RouteData, routeFromFiles, routeFromZip } from "../lib/routeData";
import {
  type BurstResult,
  formatDistance,
  haversine,
  INJECTED_LABELS,
  resultsCsv,
  resultsGpx,
  type RouteFaults,
  type RoutePlayer,
  type Speed,
  SPEEDS,
} from "../lib/routePlayer";
import { DownloadIcon, FolderIcon, PauseIcon, PlayIcon, RefreshIcon } from "./icons";

/** Opens a route folder or ZIP through hidden file inputs. */
export function useRouteLoader(onLoaded: (route: RouteData) => void) {
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  });

  const load = async (task: () => Promise<RouteData>) => {
    setLoading(true);
    setError(null);
    try {
      onLoaded(await task());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const inputs = (
    <>
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) load(() => routeFromFiles(files));
        }}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) load(() => routeFromZip(file));
        }}
      />
    </>
  );

  return {
    inputs,
    loading,
    error,
    openFolder: () => folderInput.current?.click(),
    openZip: () => zipInput.current?.click(),
  };
}

export type RouteLoader = ReturnType<typeof useRouteLoader>;

function LoadButtons({ loader, primary }: { loader: RouteLoader; primary?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={loader.openFolder}
        disabled={loader.loading}
        className={`flex h-9 items-center gap-1.5 rounded-lg px-3.5 font-medium disabled:opacity-45 ${
          primary ? "bg-accent font-semibold text-on-accent hover:brightness-110" : "border border-line-strong text-fg hover:bg-raised"
        }`}
      >
        <FolderIcon size={14} />
        {t("Open route folder…")}
      </button>
      <button
        type="button"
        onClick={loader.openZip}
        disabled={loader.loading}
        className="flex h-9 items-center rounded-lg border border-line-strong px-3.5 text-fg hover:bg-raised disabled:opacity-45"
      >
        {t("Open ZIP…")}
      </button>
    </div>
  );
}

export function LoadError({ loader }: { loader: RouteLoader }) {
  if (!loader.error) return null;
  return (
    <div role="alert" className="rounded-lg border border-err px-3 py-2 text-xs text-fg">
      {t("Could not load the route: {error}", { error: loader.error })}
    </div>
  );
}

/** First-time guide: connect, load a route, play. */
export function RouteSteps({ connected, loader }: { connected: boolean; loader: RouteLoader }) {
  const steps = [
    { title: t("Connect the board"), hint: connected ? t("Done") : t("Use Connect at the top left"), done: connected },
    { title: t("Load the route"), hint: t("The folder with tramas/nmea_0001.txt… and ruta_referencia.csv, or its ZIP"), done: false, load: true },
    { title: t("Press Play"), hint: t("The map shows what your board answers"), done: false },
  ];
  return (
    <div className="flex flex-col gap-3.5 rounded-xl border border-dashed border-line-focus p-4">
      <h3 className="m-0 text-base font-semibold">{t("GPS tracking in 3 steps")}</h3>
      {steps.map((s, i) => {
        const current = !s.done && steps.slice(0, i).every((p) => p.done || p.load);
        return (
          <div key={i} className="flex items-start gap-3">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full font-semibold ${
                s.done ? "bg-ok/15 text-ok" : current && s.load ? "bg-accent text-on-accent" : "bg-field text-muted"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <div className="flex flex-col gap-1.5 pt-0.5">
              <span className={`font-semibold ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
              <span className="text-xs text-muted">{s.hint}</span>
              {s.load && <LoadButtons loader={loader} primary />}
            </div>
          </div>
        );
      })}
      <LoadError loader={loader} />
    </div>
  );
}

interface PlayerProps {
  player: RoutePlayer;
  connected: boolean;
  speed: Speed;
  loop: boolean;
  onSpeed: (s: Speed) => void;
  onLoop: (l: boolean) => void;
}

const SPEED_LABELS: Record<Speed, string> = {
  0.5: "0.5× (slower)",
  1: "1× (real time)",
  2: "2× faster",
  5: "5× faster",
  10: "10× faster",
};

/** Play controls, progress and the score, right under the map. */
export function PlayerCard({ player, connected, speed, loop, onSpeed, onLoop }: PlayerProps) {
  const total = player.route?.steps.length ?? 0;
  const sent = player.position;
  const current = player.current;
  const s = player.summary();
  const disabled = !connected || !player.route;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => (player.playing ? player.pause() : player.play())}
          className={`flex h-10 items-center gap-2 rounded-lg px-4 font-semibold disabled:opacity-45 ${
            player.playing ? "text-fg shadow-[inset_0_0_0_1px_var(--color-line-focus)] hover:bg-field" : "bg-accent text-on-accent hover:brightness-110"
          }`}
        >
          {player.playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
          {player.playing ? t("Pause") : player.finished ? t("Play again") : sent > 0 ? t("Resume") : t("Play")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => player.step()}
          title={t("Send only the next frame")}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 font-medium text-fg hover:bg-field disabled:opacity-45"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 5v14l9-7zM16 5h3v14h-3z" />
          </svg>
          {t("Step")}
        </button>
        <button
          type="button"
          onClick={() => player.reset()}
          title={t("Back to the first frame; clears the route on the map")}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 font-medium text-fg hover:bg-field"
        >
          <RefreshIcon size={13} />
          {t("Reset")}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={loop} onChange={(e) => onLoop(e.target.checked)} className="accent-[var(--color-accent)]" />
            {t("Repeat")}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            {t("Speed")}
            <select
              value={speed}
              onChange={(e) => onSpeed(Number(e.target.value) as Speed)}
              className="h-9 rounded-lg border border-line-strong bg-field px-2 text-[12.5px] text-fg outline-none"
            >
              {SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {t(SPEED_LABELS[v])}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {!connected && <span className="text-xs text-muted">{t("Connect the port to send the route.")}</span>}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
          <span>
            {t("Frame")} <b className="text-[15px]">{sent}</b> {t("of")} {total}
          </span>
          <span className="text-muted">{current && sent > 0 ? `${current.utc} UTC` : t("Not started")}</span>
        </div>
        <div role="progressbar" aria-label={t("Route progress")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={sent} className="h-2 overflow-hidden rounded-full bg-field">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${total ? (sent / total) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Tile label={`✓ ${t("Correct")}`} value={String(s.correct)} tone="bg-ok/12 text-ok" />
        <Tile label={`✗ ${t("Wrong")}`} value={String(s.wrong)} tone={s.wrong ? "bg-err/12 text-err" : "bg-field text-fg"} />
        <Tile label={`– ${t("No response")}`} value={String(s.noResponse + s.duplicate)} tone="bg-field text-fg" />
        <Tile label={t("Grade")} value={s.sent ? formatNumber(s.grade, 1) : "—"} tone="bg-accent-soft text-accent" />
      </div>
      {player.finished && (
        <div className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-xs text-fg">
          {t("Route finished: {sent} frames, {correct} correct, {wrong} wrong, {none} without response, {dup} duplicate. Grade {grade} ({pct} %).", {
            sent: s.sent,
            correct: s.correct,
            wrong: s.wrong,
            none: s.noResponse,
            dup: s.duplicate,
            grade: formatNumber(s.grade, 1),
            pct: s.sent ? Math.round((s.correct / s.sent) * 100) : 0,
          })}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 ${tone}`}>
      <span className="truncate text-[11px] text-fg-2">{label}</span>
      <span className="font-mono text-lg leading-tight font-semibold">{value}</span>
    </div>
  );
}

/** Which route is loaded, with a way to change it. */
export function RouteHeader({ route, loader, onRemove }: { route: RouteData; loader: RouteLoader; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
        <span className="min-w-0 flex-1">
          <b className="text-fg">{route.startLabel}</b> → <b className="text-fg">{route.endLabel}</b> · {t("{n} frames", { n: route.steps.length })}
        </span>
        <button type="button" onClick={loader.openFolder} className="h-8 rounded-md px-2 text-tx hover:underline">
          {t("Change route")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={t("Remove the route and its map; the GPS tab goes back to the first steps")}
          className="h-8 rounded-md px-2 text-muted hover:text-err hover:underline"
        >
          {t("Remove route")}
        </button>
      </div>
      <LoadError loader={loader} />
    </div>
  );
}

/** Fault injection for the recorded route. */
export function RouteFaultsEditor({ player, faults, onChange }: { player: RoutePlayer; faults: RouteFaults; onChange: (f: RouteFaults) => void }) {
  const set = (patch: Partial<RouteFaults>) => onChange({ ...faults, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <EveryRow
        name={t("Altered checksum")}
        hint={t("Changes the $GPGGA checksum: the board must not answer that frame")}
        fault={faults.checksum}
        onChange={(checksum) => set({ checksum })}
      />
      <EveryRow
        name={t("Lost bytes")}
        hint={t("Removes characters from $GPGGA, so its checksum fails")}
        fault={faults.bytesLost}
        onChange={(bytesLost) => set({ bytesLost })}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex min-w-[160px] flex-1 flex-col">
          <span className="font-medium">{t("Signal loss")}</span>
          <span className="text-[11.5px] text-muted">{t("Frames without position, with the right time: the board must answer NOFIX")}</span>
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="number"
            min={1}
            max={300}
            value={faults.signalLossBursts}
            onChange={(e) => set({ signalLossBursts: Math.max(1, Math.min(300, Number(e.target.value) || 1)) })}
            className="h-8 w-16 rounded-md border border-line-strong bg-field px-2 font-mono text-fg outline-none focus:border-tx"
            aria-label={t("Frames without signal")}
          />
          {t("frames")}
        </label>
        <button
          type="button"
          onClick={() => player.toggleSignalLoss()}
          className={`flex h-9 items-center rounded-lg border px-3 font-medium ${
            player.signalLossLeft > 0 ? "border-transparent bg-accent-soft text-accent" : "border-line-strong text-fg hover:bg-raised"
          }`}
        >
          {player.signalLossLeft > 0 ? t("{n} left (cancel)", { n: player.signalLossLeft }) : t("Lose signal now")}
        </button>
      </div>
    </div>
  );
}

function EveryRow({ name, hint, fault, onChange }: { name: string; hint: string; fault: { on: boolean; every: number }; onChange: (f: { on: boolean; every: number }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Switch on={fault.on} label={name} onClick={() => onChange({ ...fault, on: !fault.on })} />
      <span className="flex min-w-[160px] flex-1 flex-col">
        <span className="font-medium">{name}</span>
        <span className="text-[11.5px] text-muted">{hint}</span>
      </span>
      <label className={`flex items-center gap-1.5 text-xs text-muted ${fault.on ? "" : "opacity-45"}`}>
        {t("1 every")}
        <input
          type="number"
          min={2}
          max={100}
          value={fault.every}
          onChange={(e) => onChange({ ...fault, every: Math.max(2, Math.min(100, Number(e.target.value) || 2)) })}
          className="h-8 w-14 rounded-md border border-line-strong bg-field px-2 font-mono text-fg outline-none focus:border-tx"
          aria-label={t("{name}: one frame every", { name })}
        />
      </label>
    </div>
  );
}

export function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick} className="grid h-8 w-10 shrink-0 place-items-center">
      <span className={`relative inline-block h-[18px] w-[30px] rounded-full ${on ? "bg-accent" : "bg-line-input"}`}>
        <span className={`absolute top-[2px] size-[14px] rounded-full transition-[left] ${on ? "left-[14px] bg-panel" : "left-[2px] bg-dim"}`} />
      </span>
    </button>
  );
}

const VERDICTS: Record<BurstResult["verdict"], { label: string; tone: string; mark: string }> = {
  pending: { label: "waiting", tone: "text-muted", mark: "…" },
  ok: { label: "correct", tone: "text-ok", mark: "✓" },
  rounding: { label: "correct, rounding", tone: "text-ok", mark: "✓" },
  wrong: { label: "wrong", tone: "text-err", mark: "✗" },
  format: { label: "format error", tone: "text-err", mark: "✗" },
  noResponse: { label: "no response", tone: "text-warn", mark: "–" },
  duplicate: { label: "duplicate", tone: "text-warn", mark: "×2" },
};

/** The last answers, one row per frame. */
export function ResultsTable({ player }: { player: RoutePlayer }) {
  const recent = player.results.slice(-8).reverse();
  if (recent.length === 0) return <p className="m-0 text-xs text-muted">{t("Nothing sent yet.")}</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th scope="col" className="border-b border-line py-1 font-medium">{t("Frame")}</th>
          <th scope="col" className="border-b border-line py-1 font-medium">{t("Received")}</th>
          <th scope="col" className="border-b border-line py-1 text-right font-medium">{t("Result")}</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {recent.map((r, i) => {
          const v = VERDICTS[r.verdict];
          const expectedSilence = r.verdict === "ok" && r.expected === null;
          return (
            <tr key={`${r.step.index}-${player.results.length - i}`}>
              <td className="border-b border-row-line py-1 whitespace-nowrap text-muted">
                {r.step.index} · {r.step.utc}
              </td>
              <td className="max-w-0 truncate border-b border-row-line py-1 pl-2" title={r.responses.map((x) => x.text).join(" | ")}>
                {r.responses.length ? r.responses.map((x) => x.text).join(" | ") : <span className="text-dim">{t("(nothing)")}</span>}
                {r.injected && <span className="ml-1.5 text-warn">« {t(INJECTED_LABELS[r.injected])}</span>}
              </td>
              <td className={`border-b border-row-line py-1 text-right whitespace-nowrap ${v.tone}`}>
                {v.mark} {expectedSilence ? t("no response, expected") : t(v.label)}
                {r.errorMeters !== null && ` · ${formatDistance(r.errorMeters)}`}
                {r.late && ` · ${t("late")}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function travelled(points: { lat: number; lon: number }[]) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  return d;
}

/** Live numbers: points, last position, time, speed and distance. */
export function RouteDetails({ player, tracker, txOnlyGga, onTxOnlyGga }: { player: RoutePlayer; tracker: PositionTracker; txOnlyGga: boolean; onTxOnlyGga: (v: boolean) => void }) {
  const current = player.current;
  const sent = player.position > 0;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label={t("Points received")} value={String(tracker.trail.length)} />
        <Stat label={t("Frame time (UTC)")} value={current && sent ? current.utc : "—"} />
        <Stat label={t("Speed (CSV)")} value={current?.speedKmh != null && sent ? `${formatNumber(current.speedKmh, 1)} km/h` : "—"} />
        <Stat label={t("Distance (board)")} value={formatDistance(travelled(tracker.trail))} />
        <div className="col-span-2">
          <Stat
            label={t("Last answer")}
            value={tracker.signal === "nofix" ? "NOFIX" : tracker.last ? `POS,${tracker.last.lat.toFixed(6)},${tracker.last.lon.toFixed(6)}` : "—"}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-2">
        <input type="checkbox" checked={txOnlyGga} onChange={(e) => onTxOnlyGga(e.target.checked)} className="accent-[var(--color-accent)]" />
        {t("Terminal: show only $GPGGA of each frame (the whole frame is still sent)")}
      </label>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-raised px-2.5 py-2">
      <span className="truncate text-[11px] text-muted">{label}</span>
      <span className="truncate font-mono text-[12.5px]">{value}</span>
    </div>
  );
}

/** Received route as CSV or GPX. */
export function RouteExport({
  player,
  onExport,
  onOpenExportFolder,
}: {
  player: RoutePlayer;
  onExport: (name: string, contents: string) => Promise<string | null>;
  onOpenExportFolder: () => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const route = player.route;
  const exportFile = async (kind: "csv" | "gpx") => {
    if (!route) return;
    const base = `${route.name}_board`.replace(/[^\w.-]+/g, "_");
    const path = await onExport(`${base}.${kind}`, kind === "csv" ? resultsCsv(player.results) : resultsGpx(route, player.results));
    if (path) {
      setSaved(path.split(/[\\/]/).pop() ?? path);
      window.setTimeout(() => setSaved(null), 8000);
    }
  };
  const button = "flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised disabled:opacity-45";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={player.results.length === 0} onClick={() => exportFile("csv")} className={button}>
          <DownloadIcon size={14} />
          {t("Received route (CSV)")}
        </button>
        <button type="button" disabled={player.results.length === 0} onClick={() => exportFile("gpx")} className={button}>
          <DownloadIcon size={14} />
          {t("Received route (GPX)")}
        </button>
      </div>
      {saved && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs text-fg-2">
          {t("Saved")} <span className="font-mono">{saved}</span>
          <button type="button" onClick={onOpenExportFolder} className="ml-auto flex items-center gap-1.5 font-medium text-accent hover:underline">
            <FolderIcon size={13} />
            {t("Open folder")}
          </button>
        </div>
      )}
      <span className="text-[11.5px] text-muted">{t("Saved in Documents\\Sonda Serial\\exports. The full TX/RX record is saved with “Save log” in the terminal.")}</span>
    </div>
  );
}
