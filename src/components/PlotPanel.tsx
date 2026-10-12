import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { type ChannelStats, CHANNEL_COLORS, PlotStore } from "../lib/plotStore";
import type { YAxisMode } from "../lib/settings";
import { cssColor, type Theme } from "../lib/theme";
import { DownloadIcon, FolderIcon, PauseIcon, PlayIcon, RefreshIcon } from "./icons";
import { IconButton, Segmented } from "./ui";

export interface YAxis {
  mode: YAxisMode;
  min: number | null;
  max: number | null;
}

interface Props {
  store: PlotStore;
  theme: Theme;
  windowSeconds: number;
  onWindowChange: (seconds: number) => void;
  yAxis: YAxis;
  onYAxisChange: (axis: Partial<YAxis>) => void;
  /** Saves the plot data as CSV; resolves to the file path, or null on failure. */
  onExport: () => Promise<string | null>;
  onOpenExportFolder: () => void;
}

const WINDOWS = [5, 10, 30, 60];
const LIVE_FRAME_MS = 33;
const STATS_MS = 250;

const Y_MODES: { value: YAxisMode; label: string; title: string }[] = [
  { value: "auto", label: "Auto", title: "Fit the visible data, growing and shrinking with it" },
  { value: "expand", label: "Expand", title: "Grow to fit new peaks and never shrink" },
  { value: "manual", label: "Manual", title: "Fixed limits" },
];

/** Axis colors come from the theme tokens, so the chart is rebuilt when the theme changes. */
function axis(): uPlot.Axis {
  return {
    stroke: cssColor("--color-dim"),
    grid: { stroke: cssColor("--color-grid"), width: 1 },
    ticks: { stroke: cssColor("--color-line"), width: 1, size: 4 },
    font: '11px "JetBrains Mono Variable", monospace',
  };
}

function chartOptions(
  names: string[],
  width: number,
  height: number,
  hidden: Record<string, boolean>,
  yRange: uPlot.Range.Function,
  onSelect: (u: uPlot) => void,
): uPlot.Options {
  const a = axis();
  return {
    width,
    height,
    legend: { show: false },
    // Dragging selects a time span to zoom into; the panel applies it (and double-click resets).
    cursor: { drag: { x: true, y: false, setScale: false }, points: { size: 6 }, bind: { dblclick: () => null } },
    hooks: { setSelect: [onSelect] },
    scales: { x: { time: true }, y: { range: yRange } },
    axes: [{ ...a, space: 70 }, { ...a, size: 56 }],
    series: [
      {},
      ...names.map((name, i) => ({
        label: name,
        stroke: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
        width: 1.5,
        spanGaps: true,
        points: { show: false },
        show: !hidden[name],
      })),
    ],
  };
}

function format(v: number | null) {
  if (v === null) return "—";
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3);
}

/** Rounds a limit taken from the chart so it is pleasant to edit. */
function tidy(v: number) {
  return Number(v.toPrecision(3));
}

export function PlotPanel({ store, theme, windowSeconds, onWindowChange, yAxis, onYAxisChange, onExport, onOpenExportFolder }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const windowRef = useRef(windowSeconds);
  const pausedRef = useRef(false);
  const hiddenRef = useRef<Record<string, boolean>>({});
  const themeRef = useRef(theme);
  const yAxisRef = useRef(yAxis);
  /** Range reached so far in "expand" mode. */
  const heldRef = useRef<[number, number] | null>(null);
  /** Time span being inspected, or null while following live data. */
  const zoomRef = useRef<[number, number] | null>(null);
  /** Last live time span drawn, to come back to after a zoom. */
  const liveRangeRef = useRef<[number, number] | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<ChannelStats[]>([]);

  windowRef.current = windowSeconds;
  themeRef.current = theme;
  yAxisRef.current = yAxis;

  useEffect(() => {
    const host = hostRef.current!;
    let layout = -1;
    let builtTheme = themeRef.current;
    let drawnVersion = -1;
    let drawnWindow = -1;
    let lastDraw = 0;
    let lastStats = 0;
    let frame = 0;

    // Called by uPlot every time the x window moves, with the min/max of the visible, shown series.
    const yRange: uPlot.Range.Function = (_u, dataMin, dataMax) => {
      const { mode, min, max } = yAxisRef.current;
      if (mode === "manual" && min !== null && max !== null && min < max) return [min, max];
      if (dataMin == null || dataMax == null) return [0, 1];
      let lo = dataMin;
      let hi = dataMax;
      if (mode === "expand") {
        const held = heldRef.current;
        if (held) {
          lo = Math.min(lo, held[0]);
          hi = Math.max(hi, held[1]);
        }
        heldRef.current = [lo, hi];
      }
      return uPlot.rangeNum(lo, hi, 0.1, true);
    };

    const onSelect = (u: uPlot) => {
      const { left, width } = u.select;
      if (width < 4) return;
      const range: [number, number] = [u.posToVal(left, "x"), u.posToVal(left + width, "x")];
      u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
      zoomRef.current = range;
      u.setScale("x", { min: range[0], max: range[1] });
      setZoomed(true);
    };

    const build = () => {
      plotRef.current?.destroy();
      const { width, height } = host.getBoundingClientRect();
      plotRef.current = new uPlot(
        chartOptions(store.names, Math.max(width, 50), Math.max(height, 50), hiddenRef.current, yRange, onSelect),
        [[], ...store.names.map(() => [])],
        host,
      );
      if (store.layoutVersion !== layout) heldRef.current = null;
      layout = store.layoutVersion;
      builtTheme = themeRef.current;
      drawnVersion = -1;
      zoomRef.current = null;
      setZoomed(false);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (pausedRef.current) return;
      if (store.layoutVersion !== layout || themeRef.current !== builtTheme) build();
      const plot = plotRef.current!;
      if (zoomRef.current) return; // frozen while zoomed in

      const t = Date.now() / 1000;
      const win = windowRef.current;
      const lastX = store.x[store.x.length - 1];
      const live = lastX !== undefined && t - lastX < win;
      const changed = store.version !== drawnVersion || win !== drawnWindow;

      if (changed || (live && now - lastDraw > LIVE_FRAME_MS)) {
        const start = Math.max(0, store.firstIndexFrom(t - win) - 1);
        plot.setData([store.x.slice(start), ...store.ys.map((y) => y.slice(start))] as uPlot.AlignedData, false);
        plot.setScale("x", { min: t - win, max: t });
        liveRangeRef.current = [t - win, t];
        drawnVersion = store.version;
        drawnWindow = win;
        lastDraw = now;
      }
      if (now - lastStats > STATS_MS) {
        setStats(store.stats(t - win));
        lastStats = now;
      }
    };
    frame = requestAnimationFrame(loop);

    const observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (width > 0 && height > 0) plotRef.current?.setSize({ width, height });
    });
    observer.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [store]);

  /** Recomputes the y range now (also while paused). */
  const rescale = () => {
    const plot = plotRef.current;
    const { min, max } = plot?.scales.x ?? {};
    if (plot && min != null && max != null) plot.setScale("x", { min, max });
  };

  const resetHeld = () => {
    heldRef.current = null;
    rescale();
  };

  useEffect(rescale, [yAxis.mode, yAxis.min, yAxis.max]);

  const setMode = (mode: YAxisMode) => {
    heldRef.current = null;
    // The first time manual is chosen, start from what is on screen.
    const y = plotRef.current?.scales.y;
    if (mode === "manual" && (yAxis.min === null || yAxis.max === null) && y?.min != null && y.max != null) {
      onYAxisChange({ mode, min: tidy(y.min), max: tidy(y.max) });
    } else {
      onYAxisChange({ mode });
    }
  };

  const resetZoom = () => {
    if (!zoomRef.current) return;
    zoomRef.current = null;
    setZoomed(false);
    const live = liveRangeRef.current;
    if (live) plotRef.current?.setScale("x", { min: live[0], max: live[1] });
  };

  const exportCsv = async () => {
    const path = await onExport();
    if (path) {
      setExported(path.split(/[\\/]/).pop() ?? path);
      window.setTimeout(() => setExported(null), 8000);
    }
  };

  const togglePaused = () => {
    pausedRef.current = !paused;
    setPaused(!paused);
  };

  const applyHidden = (next: Record<string, boolean>) => {
    hiddenRef.current = next;
    setHidden(next);
    store.names.forEach((name, i) => plotRef.current?.setSeries(i + 1, { show: !next[name] }));
    resetHeld();
  };

  const toggleChannel = (name: string) => applyHidden({ ...hidden, [name]: !hidden[name] });
  const showAll = () => applyHidden({});
  const hideAll = () => applyHidden(Object.fromEntries(store.names.map((n) => [n, true])));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">Live plot</h2>
          <span className="text-xs text-muted">Fed by the same lines as the terminal · drag to zoom</span>
        </div>
        <Segmented
          label="Time window"
          mono
          value={windowSeconds}
          options={WINDOWS.map((w) => ({ value: w, label: `${w} s` }))}
          onChange={onWindowChange}
        />
        <IconButton label={paused ? "Resume plot" : "Pause plot"} onClick={togglePaused}>
          {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
        </IconButton>
        <IconButton label="Export data to CSV" onClick={exportCsv} disabled={stats.length === 0}>
          <DownloadIcon size={14} />
        </IconButton>
      </div>

      {exported && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs text-fg-2">
          Saved <span className="font-mono">{exported}</span>
          <button type="button" onClick={onOpenExportFolder} className="ml-auto flex items-center gap-1.5 font-medium text-accent hover:underline">
            <FolderIcon size={13} />
            Open folder
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Y axis</span>
        <Segmented label="Y axis" value={yAxis.mode} options={Y_MODES} onChange={setMode} />
        {yAxis.mode === "expand" && (
          <button
            type="button"
            onClick={resetHeld}
            title="Start growing again from the current data"
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs text-fg-2 hover:bg-raised"
          >
            <RefreshIcon size={13} />
            Reset
          </button>
        )}
        {yAxis.mode === "manual" && <ManualLimits yAxis={yAxis} onChange={onYAxisChange} />}
      </div>

      {stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {stats.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={!hidden[s.name]}
              title={hidden[s.name] ? `Show ${s.name}` : `Hide ${s.name}`}
              onClick={() => toggleChannel(s.name)}
              className={`flex h-9 items-center gap-2 rounded-full border px-3 ${
                hidden[s.name] ? "border-line bg-transparent opacity-50" : "border-line-strong bg-raised"
              }`}
            >
              <span
                className="grid size-3.5 place-items-center rounded-[4px] border-[1.5px]"
                style={{ borderColor: s.color, background: hidden[s.name] ? "transparent" : s.color }}
              >
                {!hidden[s.name] && (
                  <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="var(--color-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="font-mono text-xs text-muted">{s.name}</span>
              <span className="font-mono text-[12.5px] font-medium tabular-nums">{format(s.last)}</span>
            </button>
          ))}
          {stats.length > 1 && (
            <span className="flex gap-1">
              <button type="button" onClick={showAll} className="h-7 rounded-md px-2 text-xs text-muted hover:bg-raised hover:text-fg-2">
                All
              </button>
              <button type="button" onClick={hideAll} className="h-7 rounded-md px-2 text-xs text-muted hover:bg-raised hover:text-fg-2">
                None
              </button>
            </span>
          )}
        </div>
      )}

      <div className="relative min-h-[200px] flex-1 overflow-hidden rounded-md bg-bg">
        <div ref={hostRef} className="absolute inset-0" onDoubleClick={resetZoom} />
        {zoomed && (
          <button
            type="button"
            onClick={resetZoom}
            title="Back to live data (or double-click the chart)"
            className="absolute top-2 right-2 flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-on-accent shadow-[0_4px_14px_var(--color-shadow)] hover:brightness-110"
          >
            <RefreshIcon size={13} />
            Reset zoom
          </button>
        )}
        {stats.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
            <div className="flex max-w-80 flex-col gap-2 text-xs leading-relaxed text-muted">
              <span className="text-[13px] text-fg-2">Lines with numbers are plotted here automatically</span>
              <span>
                For example <code className="font-mono text-fg-2">temp=24.5 hum=40</code>,{" "}
                <code className="font-mono text-fg-2">temp:24.5,hum:40</code> or <code className="font-mono text-fg-2">24.5,40</code>
              </span>
            </div>
          </div>
        )}
      </div>

      {stats.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-right text-muted">
              <th scope="col" className="border-b border-line py-1.5 text-left font-medium">Channel</th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">Min</th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">Max</th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">Mean</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.name} className="text-right font-mono tabular-nums">
                <th scope="row" className="border-b border-row-line py-1.5 text-left font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-[3px] w-2.5 rounded-sm" style={{ background: s.color }} />
                    {s.name}
                  </span>
                </th>
                <td className="border-b border-row-line py-1.5 text-fg-2">{format(s.min)}</td>
                <td className="border-b border-row-line py-1.5 text-fg-2">{format(s.max)}</td>
                <td className="border-b border-row-line py-1.5 text-fg-2">{format(s.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Min/Max inputs for manual mode. Values apply on Enter or when leaving the field. */
function ManualLimits({ yAxis, onChange }: { yAxis: YAxis; onChange: (axis: Partial<YAxis>) => void }) {
  const [minText, setMinText] = useState(String(yAxis.min ?? 0));
  const [maxText, setMaxText] = useState(String(yAxis.max ?? 1));

  useEffect(() => setMinText(String(yAxis.min ?? 0)), [yAxis.min]);
  useEffect(() => setMaxText(String(yAxis.max ?? 1)), [yAxis.max]);

  const min = Number(minText);
  const max = Number(maxText);
  const valid = minText.trim() !== "" && maxText.trim() !== "" && Number.isFinite(min) && Number.isFinite(max) && min < max;

  const commit = () => {
    if (valid) onChange({ min, max });
  };

  const input = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-field pr-1 pl-2.5 text-xs text-muted">
      {label}
      <input
        value={value}
        inputMode="decimal"
        aria-label={`Y axis ${label.toLowerCase()}`}
        aria-invalid={!valid}
        onChange={(e) => set(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={`h-7 w-20 rounded border bg-transparent px-1.5 font-mono text-xs text-fg outline-none ${
          valid ? "border-transparent focus:border-tx" : "border-err"
        }`}
      />
    </label>
  );

  return (
    <>
      {input("Min", minText, setMinText)}
      {input("Max", maxText, setMaxText)}
      {!valid && <span className="text-xs text-err">Min must be lower than Max</span>}
    </>
  );
}
