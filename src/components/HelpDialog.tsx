import { useEffect, useRef } from "react";
import { t } from "../lib/i18n";

/** Five-step quick guide, opened with the "?" button. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps = [
    [t("Connect"), t("Plug the board in, choose its port in the Port drop-down (ST boards show as “ST-LINK”) and press Connect. 115200 8N1 is the usual setting; the rest is in “More settings”.")],
    [t("Read"), t("Everything the board sends appears under Received. Pause freezes the view without losing data; HEX shows the raw bytes.")],
    [t("Send"), t("Type in Send to the board and press Enter. Save the commands you repeat as quick commands and launch them with F1–F12.")],
    [t("Plot"), t("Lines with numbers (temp=24.5 or 24.5,40) are drawn in the Plot tab, one channel per name.")],
    [t("GPS"), t("In the GPS tab, load a recorded route and press Play: the board receives NMEA frames and the map shows the positions it answers, with a grade.")],
  ];

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-[520px] max-w-full flex-col gap-4 overflow-y-auto rounded-2xl border border-line-strong bg-panel p-6 shadow-[0_20px_60px_var(--color-shadow)]"
      >
        <div className="flex items-center justify-between">
          <h2 id="help-title" className="m-0 text-lg font-semibold">
            {t("Quick guide")}
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className="size-9 rounded-lg text-muted hover:bg-raised">
            ✕
          </button>
        </div>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {steps.map(([title, text], i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{i + 1}</span>
              <span className="flex flex-col gap-0.5">
                <b>{title}</b>
                <span className="leading-relaxed text-fg-2">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-xs text-muted">{t("Tip: hover over any button to see what it does.")}</p>
      </div>
    </div>
  );
}
