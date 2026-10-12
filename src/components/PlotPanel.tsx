import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { type ChannelStats, CHANNEL_COLORS, PlotStore } from "../lib/plotStore";
import { PauseIcon, PlayIcon } from "./icons";
import { IconButton, Segmented } from "./ui";

interface Props {
  store: PlotStore;
  windowSeconds: number;
  onWindowChange: (seconds: number) => void;
}

const WINDOWS = [5, 10, 30, 60];
const LIVE_FRAME_MS = 33;
const STATS_MS = 250;

const axis: uPlot.Axis = {
  stroke: "#7a8392",
  grid: { stroke: "#1a1f27", width: 1 },
  ticks: { stroke: "#1d222a", width: 1, size: 4 },
  font: '11px "JetBrains Mono Variable", monospace',
};

function chartOptions(names: string[], width: number, height: number, hidden: Record<string, boolean>): uPlot.Options {
  return {
    width,
    height,
    legend: { show: false },
    cursor: { drag: { x: false, y: false }, points: { size: 6 } },
    scales: { x: { time: true } },
    axes: [{ ...axis, space: 70 }, { ...axis, size: 56 }],
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

export function PlotPanel({ store, windowSeconds, onWindowChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const windowRef = useRef(windowSeconds);
  const pausedRef = useRef(false);
  const hiddenRef = useRef<Record<string, boolean>>({});
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<ChannelStats[]>([]);

  windowRef.current = windowSeconds;

  useEffect(() => {
    const host = hostRef.current!;
    let layout = -1;
    let drawnVersion = -1;
    let drawnWindow = -1;
    let lastDraw = 0;
    let lastStats = 0;
    let frame = 0;

    const build = () => {
      plotRef.current?.destroy();
      const { width, height } = host.getBoundingClientRect();
      plotRef.current = new uPlot(
        chartOptions(store.names, Math.max(width, 50), Math.max(height, 50), hiddenRef.current),
        [[], ...store.names.map(() => [])],
        host,
      );
      layout = store.layoutVersion;
      drawnVersion = -1;
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (pausedRef.current) return;
      if (store.layoutVersion !== layout) build();
      const plot = plotRef.current!;

      const t = Date.now() / 1000;
      const win = windowRef.current;
      const lastX = store.x[store.x.length - 1];
      const live = lastX !== undefined && t - lastX < win;
      const changed = store.version !== drawnVersion || win !== drawnWindow;

      if (changed || (live && now - lastDraw > LIVE_FRAME_MS)) {
        const start = Math.max(0, store.firstIndexFrom(t - win) - 1);
        plot.setData([store.x.slice(start), ...store.ys.map((y) => y.slice(start))] as uPlot.AlignedData, false);
        plot.setScale("x", { min: t - win, max: t });
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

  const togglePaused = () => {
    pausedRef.current = !paused;
    setPaused(!paused);
  };

  const toggleChannel = (name: string) => {
    const next = { ...hidden, [name]: !hidden[name] };
    hiddenRef.current = next;
    setHidden(next);
    const i = store.names.indexOf(name);
    if (i >= 0) plotRef.current?.setSeries(i + 1, { show: !next[name] });
  };

  return (
    <section aria-label="Gráfica en vivo" className="flex min-h-0 w-[min(40%,560px)] min-w-[360px] shrink-0 flex-col gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">Gráfica en vivo</h2>
          <span className="text-xs text-muted">Se alimenta de las mismas líneas que la terminal</span>
        </div>
        <Segmented
          label="Ventana de tiempo"
          mono
          value={windowSeconds}
          options={WINDOWS.map((w) => ({ value: w, label: `${w} s` }))}
          onChange={onWindowChange}
        />
        <IconButton label={paused ? "Reanudar gráfica" : "Pausar gráfica"} onClick={togglePaused}>
          {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
        </IconButton>
      </div>

      {stats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={!hidden[s.name]}
              onClick={() => toggleChannel(s.name)}
              className={`flex h-9 items-center gap-2 rounded-full border border-line-strong bg-raised px-3 ${
                hidden[s.name] ? "opacity-45 line-through" : ""
              }`}
            >
              <span className="h-[3px] w-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="font-mono text-xs text-muted">{s.name}</span>
              <span className="font-mono text-[12.5px] font-medium tabular-nums">{format(s.last)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative min-h-[200px] flex-1 overflow-hidden rounded-md bg-bg">
        <div ref={hostRef} className="absolute inset-0" />
        {stats.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
            <div className="flex max-w-80 flex-col gap-2 text-xs leading-relaxed text-muted">
              <span className="text-[13px] text-fg-2">Las líneas con números se dibujan aquí solas</span>
              <span>
                Por ejemplo <code className="font-mono text-fg-2">temp=24.5 hum=40</code>,{" "}
                <code className="font-mono text-fg-2">temp:24.5,hum:40</code> o <code className="font-mono text-fg-2">24.5,40</code>
              </span>
            </div>
          </div>
        )}
      </div>

      {stats.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-right text-muted">
              <th scope="col" className="border-b border-line py-1.5 text-left font-medium">Canal</th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">Mín</th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">Máx</th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">Media</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.name} className="text-right font-mono tabular-nums">
                <th scope="row" className="border-b border-[#161a21] py-1.5 text-left font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-[3px] w-2.5 rounded-sm" style={{ background: s.color }} />
                    {s.name}
                  </span>
                </th>
                <td className="border-b border-[#161a21] py-1.5 text-fg-2">{format(s.min)}</td>
                <td className="border-b border-[#161a21] py-1.5 text-fg-2">{format(s.max)}</td>
                <td className="border-b border-[#161a21] py-1.5 text-fg-2">{format(s.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
