import type { ReactNode } from "react";
import type { SideTab } from "../lib/settings";

const TABS: { id: SideTab; label: string }[] = [
  { id: "plot", label: "Plot" },
  { id: "map", label: "Map" },
  { id: "simulator", label: "Simulator" },
];

interface Props {
  tab: SideTab;
  onTabChange: (tab: SideTab) => void;
  /** Short live status next to a tab name, e.g. "GGA 1 Hz" while the simulator runs. */
  badges?: Partial<Record<SideTab, string>>;
  panels: Record<SideTab, ReactNode>;
}

/**
 * Right-hand panel with tabs. Every panel stays mounted while hidden so the
 * plot keeps its data, the map its tracks and the simulator keeps sending.
 */
export function SidePanel({ tab, onTabChange, badges = {}, panels }: Props) {
  return (
    <section aria-label="Tools" className="flex min-h-0 w-[min(42%,600px)] min-w-[380px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div role="tablist" aria-label="Tools" className="flex items-end gap-1 border-b border-line px-3 pt-1.5">
        {TABS.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              onClick={() => onTabChange(t.id)}
              className={`flex h-10 items-center gap-2 px-3.5 font-semibold ${
                selected ? "text-fg shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted hover:text-fg-2"
              }`}
            >
              {t.label}
              {badges[t.id] && (
                <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-accent-soft px-2 font-mono text-[10.5px] font-medium text-accent">
                  <span className="size-1.5 rounded-full bg-accent" />
                  {badges[t.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          className={t.id === tab ? "flex min-h-0 flex-1 flex-col" : "hidden"}
        >
          {panels[t.id]}
        </div>
      ))}
    </section>
  );
}
