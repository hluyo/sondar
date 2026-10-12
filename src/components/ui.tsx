import type { ReactNode } from "react";

/** Labeled control with the compact "field pill" look of the connection bar. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-field pl-3 pr-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

export const selectClass =
  "h-9 border-0 bg-transparent pr-1 font-medium text-fg outline-none disabled:text-muted";

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  mono?: boolean;
}

export function Segmented<T extends string | number>({ label, value, options, onChange, mono }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg border border-line bg-raised p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-[30px] rounded-md px-2.5 text-xs ${mono ? "font-mono" : ""} ${
              on ? "bg-[#262c36] text-[#f2f4f7] shadow-[inset_0_0_0_1px_#363e4b]" : "text-muted hover:text-fg-2"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleButton({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 ${
        pressed ? "bg-[#1a1f27] text-fg" : "text-muted hover:text-fg-2"
      }`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  className = "",
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-9 place-items-center rounded-lg border border-line-strong text-fg-2 hover:bg-raised disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>;
}
