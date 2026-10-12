import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";
import { t } from "../lib/i18n";
import type { SideTab } from "../lib/settings";

const MIN_WIDTH = 380;
const MAX_WIDTH = 1000;

interface Props {
  tab: SideTab;
  onTabChange: (tab: SideTab) => void;
  /** Short live status next to a tab name, e.g. "127/423" while a route plays. */
  badges?: Partial<Record<SideTab, string>>;
  panels: Record<SideTab, ReactNode>;
  width: number;
  /** Called while dragging the edge (live) and once more when the drag ends (to save). */
  onWidthChange: (width: number, done: boolean) => void;
}

/**
 * Right-hand panel with tabs. Every panel stays mounted while hidden so the
 * plot keeps its data and the GPS keeps playing. Its left edge can be dragged.
 */
export function SidePanel({ tab, onTabChange, badges = {}, panels, width, onWidthChange }: Props) {
  const tabs: { id: SideTab; label: string }[] = [
    { id: "plot", label: t("Plot") },
    { id: "gps", label: "GPS" },
  ];
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = (w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w, 0)));
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidthChange(clamp(drag.current.startWidth + drag.current.startX - e.clientX), false);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onWidthChange(clamp(drag.current.startWidth + drag.current.startX - e.clientX), true);
    drag.current = null;
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Drag to resize the side panel")}
        title={t("Drag to resize the side panel")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center"
      >
        <span className="h-10 w-1 rounded-full bg-line-strong transition-colors group-hover:bg-accent" />
      </div>
      <section
        aria-label={t("Tools")}
        style={{ width: `min(${width}px, 60%)` }}
        className="flex min-h-0 min-w-[360px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_var(--color-shadow)]"
      >
        <div role="tablist" aria-label={t("Tools")} className="flex items-end gap-1 border-b border-line px-3 pt-1.5">
          {tabs.map((tb) => {
            const selected = tb.id === tab;
            return (
              <button
                key={tb.id}
                type="button"
                role="tab"
                id={`tab-${tb.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tb.id}`}
                onClick={() => onTabChange(tb.id)}
                className={`relative flex h-11 items-center gap-2 px-4 text-sm ${selected ? "font-semibold text-fg" : "text-muted hover:text-fg"}`}
              >
                {tb.label}
                {/* Windows-style selection mark: a short rounded bar under the label. */}
                {selected && <span className="absolute bottom-1 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-accent" />}
                {badges[tb.id] && (
                  <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-accent-soft px-2 font-mono text-[10.5px] font-medium text-accent">
                    <span className="size-1.5 rounded-full bg-accent" />
                    {badges[tb.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {tabs.map((tb) => (
          <div
            key={tb.id}
            role="tabpanel"
            id={`panel-${tb.id}`}
            aria-labelledby={`tab-${tb.id}`}
            className={tb.id === tab ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            {panels[tb.id]}
          </div>
        ))}
      </section>
    </>
  );
}
