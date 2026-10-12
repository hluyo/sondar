import { formatNumber, t } from "../lib/i18n";
import type { PortConfig } from "../lib/serial";

/** Example character drawn on the line: 'A' = 0x41 = 0100 0001. */
const SAMPLE = 0x41;
const UNIT = 34;
const IDLE = 22;
const HIGH = 12;
const LOW = 40;
const CELL_Y = 50;
const CELL_H = 22;

interface Cell {
  kind: "start" | "data" | "parity" | "stop";
  label: string;
  level: 0 | 1;
  width: number;
}

function frameCells({ dataBits, parity, stopBits }: Pick<PortConfig, "dataBits" | "parity" | "stopBits">): Cell[] {
  const cells: Cell[] = [{ kind: "start", label: "Start", level: 0, width: 1 }];
  let ones = 0;
  // UART sends the least significant bit first.
  for (let i = 0; i < dataBits; i++) {
    const level = ((SAMPLE >> i) & 1) as 0 | 1;
    ones += level;
    cells.push({ kind: "data", label: `D${i}`, level, width: 1 });
  }
  if (parity !== "none") {
    const level = (parity === "even" ? ones % 2 : 1 - (ones % 2)) as 0 | 1;
    cells.push({ kind: "parity", label: "P", level, width: 1 });
  }
  cells.push({ kind: "stop", label: "Stop", level: 1, width: stopBits });
  return cells;
}

function bitTime(baudRate: number) {
  const us = 1e6 / baudRate;
  if (us >= 1000) return `${(us / 1000).toFixed(2)} ms`;
  return `${us >= 100 ? Math.round(us) : us.toFixed(2)} µs`;
}

const CELL_FILL: Record<Cell["kind"], string> = {
  start: "fill-bg",
  data: "fill-field",
  parity: "fill-par",
  stop: "fill-bg",
};

/** Draws how one character travels on the wire with the current settings. */
export function FrameDiagram(props: Pick<PortConfig, "baudRate" | "dataBits" | "parity" | "stopBits">) {
  const cells = frameCells(props);
  const bits = cells.reduce((sum, c) => sum + c.width, 0);
  const width = IDLE * 2 + bits * UNIT;

  let x = IDLE;
  let wave = `0,${HIGH} ${IDLE},${HIGH}`;
  const drawn = cells.map((c, i) => {
    const w = c.width * UNIT;
    const y = c.level ? HIGH : LOW;
    wave += ` ${x},${y} ${x + w},${y}`;
    const cell = (
      <g key={i}>
        <rect x={x + 1} y={CELL_Y} width={w - 2} height={CELL_H} rx={3} className={`${CELL_FILL[c.kind]} stroke-line-strong`} />
        <text x={x + w / 2} y={CELL_Y + 15} textAnchor="middle" className="fill-muted font-mono text-[10px]">
          {c.label}
        </text>
        <text x={x + w / 2} y={(HIGH + LOW) / 2 + 4} textAnchor="middle" className="fill-fg-2 font-mono text-[11px] font-medium">
          {c.level}
        </text>
      </g>
    );
    x += w;
    return cell;
  });
  wave += ` ${x},${HIGH} ${width},${HIGH}`;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} 74`} role="img" aria-label={t("UART frame")} className="block h-auto w-full">
        <line x1={0} y1={HIGH} x2={width} y2={HIGH} strokeDasharray="3 3" className="stroke-line-focus" />
        {drawn}
        <polyline points={wave} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-accent" />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted tabular-nums">
        <span>
          <b className="font-medium text-fg">{bits}</b> {t("bits per character")}
        </span>
        <span>
          {t("1 bit")} = <b className="font-medium text-fg">{bitTime(props.baudRate)}</b>
        </span>
        <span>
          {t("max")} <b className="font-medium text-fg">{formatNumber(Math.floor(props.baudRate / bits))}</b> {t("chars/s")}
        </span>
      </div>
    </div>
  );
}
