import { useEffect, useReducer, useRef, useState } from "react";
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
import type { PositionTracker } from "../lib/positionTracker";
import { DownloadIcon, FolderIcon, PauseIcon, PlayIcon, RefreshIcon } from "./icons";
import { Segmented, ToggleButton } from "./ui";

interface Props {
  player: RoutePlayer;
  tracker: PositionTracker;
  connected: boolean;
  speed: Speed;
  loop: boolean;
  txOnlyGga: boolean;
  faults: RouteFaults;
  onChange: (patch: { routeSpeed?: Speed; routeLoop?: boolean; routeTxOnlyGga?: boolean; routeFaults?: RouteFaults }) => void;
  onRouteLoaded: (route: RouteData) => void;
  /** Saves a file under Documents/Sonda Serial/exports and resolves to its path, or null. */
  onExport: (name: string, contents: string) => Promise<string | null>;
  onOpenExportFolder: () => void;
}

const sectionTitle = "m-0 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted";

const VERDICTS: Record<BurstResult["verdict"], { label: string; tone: string; mark: string }> = {
  pending: { label: "waiting", tone: "text-muted", mark: "…" },
  ok: { label: "correct", tone: "text-ok", mark: "✓" },
  rounding: { label: "correct, rounding", tone: "text-ok", mark: "✓" },
  wrong: { label: "wrong", tone: "text-err", mark: "✗" },
  format: { label: "format error", tone: "text-err", mark: "✗" },
  noResponse: { label: "no response", tone: "text-warn", mark: "–" },
  duplicate: { label: "duplicate", tone: "text-warn", mark: "×2" },
};

/** Distance along the received positions, skipping repeated points. */
function travelled(points: { lat: number; lon: number }[]) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  return d;
}

/**
 * Plays a recorded route (one NMEA burst file per second) to the device and
 * grades every answer against the reference CSV. Built for the GPS tracking lab.
 */
export function RoutePanel(props: Props) {
  const { player, tracker, connected, speed, loop, txOnlyGga, faults, onChange } = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => player.changes.on(rerender), [player]);
  // Received points and distances come from the tracker; refresh a few times per second.
  useEffect(() => {
    const id = window.setInterval(rerender, 400);
    return () => window.clearInterval(id);
  }, []);

  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const load = async (task: () => Promise<RouteData>) => {
    setLoading(true);
    setLoadError(null);
    try {
      props.onRouteLoaded(await task());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const route = player.route;
  const total = route?.steps.length ?? 0;
  const current = player.current;
  const sent = player.position;
  const summary = player.summary();
  const recent = player.results.slice(-8).reverse();
  const canPlay = !!route && connected;
  const setFaults = (patch: Partial<RouteFaults>) => onChange({ routeFaults: { ...faults, ...patch } });

  const exportFile = async (kind: "csv" | "gpx") => {
    if (!route) return;
    const base = `${route.name}_device`.replace(/[^\w.-]+/g, "_");
    const path = await props.onExport(`${base}.${kind}`, kind === "csv" ? resultsCsv(player.results) : resultsGpx(route, player.results));
    if (path) {
      setExported(path.split(/[\\/]/).pop() ?? path);
      window.setTimeout(() => setExported(null), 8000);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3.5 scroll-thin">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">Recorded route</h2>
          <span className="text-xs text-muted">Sends one NMEA burst file per second and checks the device's answers</span>
        </div>
        <button
          type="button"
          onClick={() => folderInput.current?.click()}
          disabled={loading}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised disabled:opacity-45"
        >
          <FolderIcon size={14} />
          Open folder…
        </button>
        <button
          type="button"
          onClick={() => zipInput.current?.click()}
          disabled={loading}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised disabled:opacity-45"
        >
          Open ZIP…
        </button>
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
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg border border-err px-3 py-2 text-xs text-fg">
          Could not load the route: {loadError}
        </div>
      )}

      {!route ? (
        <div className="rounded-lg border border-dashed border-line-focus px-4 py-5 text-xs leading-relaxed text-muted">
          <p className="m-0 mb-1.5 text-[13px] font-medium text-fg-2">No route loaded</p>
          Open the route folder (or its ZIP). It must contain <code className="font-mono text-fg-2">tramas/nmea_0001.txt…</code>, one burst per
          second, and <code className="font-mono text-fg-2">ruta_referencia.csv</code> with the expected answer for each burst.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-lg border border-line bg-raised px-3 py-2.5">
            <span className="truncate font-medium">{route.name}</span>
            <span className="text-xs text-muted">
              {route.startLabel} → {route.endLabel} · {total} bursts{route.date ? ` · ${route.date}` : ""}
            </span>
          </div>

          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canPlay}
                onClick={() => (player.playing ? player.pause() : player.play())}
                className={`flex h-10 items-center gap-2 rounded-lg px-4 font-semibold disabled:opacity-45 ${
                  player.playing ? "text-fg shadow-[inset_0_0_0_1px_var(--color-line-focus)] hover:bg-raised" : "bg-accent text-on-accent hover:brightness-110"
                }`}
              >
                {player.playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                {player.playing ? "Pause" : player.finished ? "Play again" : sent > 0 ? "Resume" : "Play"}
              </button>
              <button
                type="button"
                disabled={!canPlay}
                onClick={() => player.step()}
                title="Send only the next burst"
                className="flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 font-medium text-fg hover:bg-raised disabled:opacity-45"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6 5v14l9-7zM16 5h3v14h-3z" />
                </svg>
                Step
              </button>
              <button
                type="button"
                onClick={() => player.reset()}
                title="Back to the first burst; clears the route on the map"
                className="flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 font-medium text-fg hover:bg-raised"
              >
                <RefreshIcon size={14} />
                Reset
              </button>
              <ToggleButton pressed={loop} onClick={() => onChange({ routeLoop: !loop })} title="Start again after the last burst">
                Loop
              </ToggleButton>
              <div className="ml-auto">
                <Segmented
                  label="Playback speed"
                  mono
                  value={speed}
                  options={SPEEDS.map((s) => ({ value: s, label: `×${String(s).replace(".", ",")}` }))}
                  onChange={(routeSpeed) => onChange({ routeSpeed })}
                />
              </div>
            </div>
            {!connected && <span className="text-xs text-muted">Connect the port to send the route.</span>}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between font-mono text-xs">
                <span className="text-fg">
                  <span className="text-[15px] font-semibold">{sent}</span> / {total}
                </span>
                <span className="text-muted">{current && sent > 0 ? `${current.file} · ${current.utc} UTC` : "Not started"}</span>
              </div>
              <div
                role="progressbar"
                aria-label="Route progress"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={sent}
                className="h-2 overflow-hidden rounded-full bg-field"
              >
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${total ? (sent / total) * 100 : 0}%` }} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-fg-2">
              <input type="checkbox" checked={txOnlyGga} onChange={(e) => onChange({ routeTxOnlyGga: e.target.checked })} className="accent-[var(--color-accent)]" />
              Terminal: show only <code className="font-mono">$GPGGA</code> of each burst (the whole burst is still sent)
            </label>
          </section>

          <section className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label="Points received" value={String(tracker.trail.length)} />
            <Stat label="Burst time (UTC)" value={current && sent > 0 ? current.utc : "—"} />
            <Stat label="Speed (CSV)" value={current?.speedKmh != null && sent > 0 ? `${current.speedKmh.toFixed(1)} km/h` : "—"} />
            <Stat label="Distance (device)" value={formatDistance(travelled(tracker.trail))} />
            <div className="col-span-2 flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-raised px-2.5 py-2 sm:col-span-4">
              <span className="text-[11px] text-muted">Last POS</span>
              <span className="truncate font-mono text-[12.5px]">
                {tracker.last ? `POS,${tracker.last.lat.toFixed(6)},${tracker.last.lon.toFixed(6)}` : "—"}
                {tracker.signal === "nofix" && <span className="ml-2 text-warn">NOFIX</span>}
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={sectionTitle}>Validation</h3>
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex min-w-[96px] flex-col items-center justify-center rounded-lg border border-line bg-raised px-3 py-2">
                <span className="text-[11px] text-muted">Grade</span>
                <span className={`font-mono text-2xl font-semibold ${summary.sent === 0 ? "text-muted" : summary.grade >= 5 ? "text-ok" : "text-err"}`}>
                  {summary.sent ? summary.grade.toFixed(1) : "—"}
                </span>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-1.5 font-mono text-xs">
                <Count label="Correct" value={summary.correct} tone="text-ok" />
                <Count label="Wrong" value={summary.wrong} tone="text-err" />
                <Count label="No response" value={summary.noResponse} tone="text-warn" />
                <Count label="Duplicate" value={summary.duplicate} tone="text-warn" />
              </div>
            </div>
            {player.finished && (
              <div className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-xs text-fg">
                Route finished: {summary.sent} bursts sent, {summary.correct} correct, {summary.wrong} wrong, {summary.noResponse} without response,{" "}
                {summary.duplicate} duplicate. Grade <b>{summary.grade.toFixed(1)}</b> ({summary.sent ? Math.round((summary.correct / summary.sent) * 100) : 0} %).
              </div>
            )}
            {recent.length > 0 && (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="border-b border-line py-1 font-medium">#</th>
                    <th scope="col" className="border-b border-line py-1 font-medium">UTC</th>
                    <th scope="col" className="border-b border-line py-1 font-medium">Received</th>
                    <th scope="col" className="border-b border-line py-1 text-right font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {recent.map((r, i) => {
                    const v = VERDICTS[r.verdict];
                    const expectedSilence = r.verdict === "ok" && r.expected === null;
                    return (
                      <tr key={`${r.step.index}-${player.results.length - i}`}>
                        <td className="border-b border-row-line py-1 text-muted">{r.step.index}</td>
                        <td className="border-b border-row-line py-1 text-muted">{r.step.utc}</td>
                        <td className="max-w-0 truncate border-b border-row-line py-1" title={r.responses.map((x) => x.text).join(" | ")}>
                          {r.responses.length ? r.responses.map((x) => x.text).join(" | ") : <span className="text-dim">(none)</span>}
                          {r.injected && <span className="ml-1.5 text-warn">« {INJECTED_LABELS[r.injected]}</span>}
                        </td>
                        <td className={`border-b border-row-line py-1 text-right whitespace-nowrap ${v.tone}`}>
                          {v.mark} {expectedSilence ? "no response, expected" : v.label}
                          {r.errorMeters !== null && ` · ${formatDistance(r.errorMeters)}`}
                          {r.late && " · late"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={sectionTitle}>Fault injection</h3>
            <EveryRow
              name="Altered checksum"
              hint="Changes the $GPGGA checksum: the device must not answer that burst"
              fault={faults.checksum}
              onChange={(checksum) => setFaults({ checksum })}
            />
            <EveryRow
              name="Lost bytes"
              hint="Removes characters from $GPGGA, so its checksum fails"
              fault={faults.bytesLost}
              onChange={(bytesLost) => setFaults({ bytesLost })}
            />
            <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-2">
              <span className="flex min-w-[150px] flex-1 flex-col">
                <span className="font-medium">Signal loss</span>
                <span className="text-[11.5px] text-muted">Bursts without position, with the right time: the device must answer NOFIX</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={faults.signalLossBursts}
                  onChange={(e) => setFaults({ signalLossBursts: Math.max(1, Math.min(300, Number(e.target.value) || 1)) })}
                  className="h-8 w-16 rounded-md border border-line-strong bg-field px-2 font-mono text-fg outline-none focus:border-tx"
                  aria-label="Bursts without signal"
                />
                bursts
              </label>
              <button
                type="button"
                onClick={() => player.toggleSignalLoss()}
                className={`flex h-9 items-center rounded-lg border px-3 font-medium ${
                  player.signalLossLeft > 0 ? "border-transparent bg-accent-soft text-accent" : "border-line-strong text-fg hover:bg-raised"
                }`}
              >
                {player.signalLossLeft > 0 ? `${player.signalLossLeft} left (cancel)` : "Lose signal"}
              </button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={sectionTitle}>Export</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={player.results.length === 0}
                onClick={() => exportFile("csv")}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised disabled:opacity-45"
              >
                <DownloadIcon size={14} />
                Received route (CSV)
              </button>
              <button
                type="button"
                disabled={player.results.length === 0}
                onClick={() => exportFile("gpx")}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised disabled:opacity-45"
              >
                <DownloadIcon size={14} />
                GPX
              </button>
            </div>
            {exported && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs text-fg-2">
                Saved <span className="font-mono">{exported}</span>
                <button type="button" onClick={props.onOpenExportFolder} className="ml-auto flex items-center gap-1.5 font-medium text-accent hover:underline">
                  <FolderIcon size={13} />
                  Open folder
                </button>
              </div>
            )}
            <span className="text-[11.5px] text-muted">The full TX/RX record is saved with the terminal's Log button.</span>
          </section>
        </>
      )}
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

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-line bg-raised px-2.5 py-1.5">
      <span className="font-sans text-muted">{label}</span>
      <span className={`font-semibold ${value ? tone : "text-muted"}`}>{value}</span>
    </div>
  );
}

function EveryRow({
  name,
  hint,
  fault,
  onChange,
}: {
  name: string;
  hint: string;
  fault: { on: boolean; every: number };
  onChange: (fault: { on: boolean; every: number }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-1.5">
      <button type="button" aria-pressed={fault.on} aria-label={name} onClick={() => onChange({ ...fault, on: !fault.on })} className="grid h-8 w-10 place-items-center">
        <span className={`relative inline-block h-[18px] w-[30px] rounded-full ${fault.on ? "bg-accent" : "bg-line-input"}`}>
          <span className={`absolute top-[2px] size-[14px] rounded-full transition-[left] ${fault.on ? "left-[14px] bg-panel" : "left-[2px] bg-dim"}`} />
        </span>
      </button>
      <span className="flex min-w-[150px] flex-1 flex-col">
        <span className="font-medium">{name}</span>
        <span className="text-[11.5px] text-muted">{hint}</span>
      </span>
      <label className={`flex items-center gap-1.5 text-xs text-muted ${fault.on ? "" : "opacity-45"}`}>
        1 every
        <input
          type="number"
          min={2}
          max={100}
          value={fault.every}
          onChange={(e) => onChange({ ...fault, every: Math.max(2, Math.min(100, Number(e.target.value) || 2)) })}
          className="h-8 w-14 rounded-md border border-line-strong bg-field px-2 font-mono text-fg outline-none focus:border-tx"
          aria-label={`${name}: one burst every`}
        />
      </label>
    </div>
  );
}
