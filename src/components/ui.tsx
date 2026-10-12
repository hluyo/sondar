import { type ReactNode, useState } from "react";

/** Radio option in the style of the connection panel groups. */
export function Radio({
  name,
  checked,
  onChange,
  disabled,
  title,
  mono,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      title={title}
      className={`flex min-h-6 cursor-pointer items-center gap-2 rounded-[5px] pr-1.5 pl-0.5 whitespace-nowrap text-fg-2 hover:bg-field has-checked:font-medium has-checked:text-fg has-disabled:cursor-default has-disabled:hover:bg-transparent ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="peer sr-only" />
      <span className="size-[13px] shrink-0 rounded-full border-[1.5px] border-line-focus bg-bg peer-checked:border-accent peer-checked:bg-[radial-gradient(circle,var(--color-accent)_0_3.5px,var(--color-bg)_4px)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-tx" />
      <span className={mono ? "font-mono text-xs tabular-nums" : ""}>{children}</span>
    </label>
  );
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
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
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`h-[30px] rounded-md px-2.5 text-xs ${mono ? "font-mono" : ""} ${
              on ? "bg-seg-on text-seg-on-fg shadow-[inset_0_0_0_1px_var(--color-line-focus)]" : "text-muted hover:text-fg-2"
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
        pressed ? "bg-toggle-on text-fg" : "text-muted hover:text-fg-2"
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

/** A titled section that folds away; closed by default to keep screens short. */
export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-11 w-full items-center gap-2.5 bg-raised px-3 text-left text-fg hover:bg-field"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
        </svg>
        <span className="font-semibold">{title}</span>
        {summary && <span className="ml-auto truncate text-xs text-muted">{summary}</span>}
      </button>
      {open && <div className="border-t border-line px-3 py-2.5">{children}</div>}
    </div>
  );
}
