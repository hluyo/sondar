import { useEffect, useState } from "react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { t } from "../lib/i18n";
import { AppLogo } from "./icons";

/** The native window, or null in a plain browser preview. */
function nativeWindow(): Window | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Our own title bar (the window has no native decorations): logo, name, the
 * connection state in grey, and the Windows caption buttons. Empty areas drag
 * the window; double-clicking them maximizes it.
 */
export function TitleBar({ subtitle }: { subtitle: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = nativeWindow();
    if (!win) return;
    let stop: (() => void) | undefined;
    const sync = () => win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    win
      .onResized(sync)
      .then((un) => (stop = un))
      .catch(() => {});
    return () => stop?.();
  }, []);

  const caption = "grid h-full w-[46px] place-items-center text-fg hover:bg-field";

  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-center bg-bg pl-3 select-none">
      <AppLogo size={16} />
      <span data-tauri-drag-region className="ml-2.5 text-xs text-fg">
        Sonda Serial
      </span>
      <span data-tauri-drag-region className="ml-3 truncate text-xs text-muted">
        {subtitle}
      </span>
      <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
      <button type="button" aria-label={t("Minimize")} title={t("Minimize")} onClick={() => nativeWindow()?.minimize()} className={caption}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? t("Restore") : t("Maximize")}
        title={maximized ? t("Restore") : t("Maximize")}
        onClick={() => nativeWindow()?.toggleMaximize()}
        className={caption}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          {maximized ? <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /> : <rect x=".5" y=".5" width="9" height="9" />}
        </svg>
      </button>
      <button
        type="button"
        aria-label={t("Close")}
        title={t("Close")}
        onClick={() => nativeWindow()?.close()}
        className="grid h-full w-[46px] place-items-center text-fg hover:bg-[#c42b1c] hover:text-white"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
