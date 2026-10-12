import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LINE_ENDINGS, type LineEnding } from "../lib/encoding";
import type { Settings } from "../lib/settings";
import { type Emitter, formatBytes, type StreamEvent } from "../lib/stream";
import type { Theme } from "../lib/theme";
import { TerminalRenderer } from "../lib/terminalRenderer";
import { ArrowDownIcon, ClockIcon, EchoIcon, FolderIcon, PauseIcon, PlayIcon, SendIcon, TrashIcon } from "./icons";
import { IconButton, Segmented, ToggleButton } from "./ui";

interface Props {
  bus: Emitter<StreamEvent>;
  theme: Theme;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onSend: (text: string) => void;
  onClear: () => void;
  log: { path: string; bytes: number } | null;
  onToggleLog: () => void;
  onOpenLogFolder: () => void;
}

export function TerminalPanel({ bus, theme, settings, update, onSend, onClear, log, onToggleLog, onOpenLogFolder }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const [paused, setPaused] = useState(false);
  const [pendingLines, setPendingLines] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new TerminalRenderer(host, themeRef.current);
    rendererRef.current = renderer;
    renderer.onPendingChange = setPendingLines;
    renderer.onScrollChange = setAtBottom;

    const unsubscribe = bus.on((e) => renderer.handle(e));
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => renderer.resize());
    });
    observer.observe(host);
    // Re-measure once the web font is ready, or the cell size is off.
    document.fonts.ready.then(() => renderer.resize());

    return () => {
      unsubscribe();
      observer.disconnect();
      cancelAnimationFrame(frame);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [bus]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMode(settings.viewMode);
    r.timestamps = settings.timestamps;
    r.echo = settings.echo;
  }, [settings.viewMode, settings.timestamps, settings.echo]);

  useEffect(() => rendererRef.current?.setTheme(theme), [theme]);

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    rendererRef.current?.setPaused(next);
  };

  const goToEnd = () => {
    if (paused) togglePause();
    else rendererRef.current?.scrollToBottom();
  };

  const clear = () => {
    rendererRef.current?.clear();
    onClear();
  };

  const showJump = paused || !atBottom;

  return (
    <section aria-label="Terminal" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-2">
        <Segmented
          label="View"
          mono
          value={settings.viewMode}
          options={[
            { value: "ascii", label: "ASCII" },
            { value: "hex", label: "HEX" },
          ]}
          onChange={(viewMode) => update({ viewMode })}
        />
        <ToggleButton pressed={settings.timestamps} onClick={() => update({ timestamps: !settings.timestamps })}>
          <ClockIcon size={14} />
          Time
        </ToggleButton>
        <ToggleButton
          pressed={settings.echo}
          title="Show sent commands in the terminal"
          onClick={() => update({ echo: !settings.echo })}
        >
          <EchoIcon size={14} />
          Echo
        </ToggleButton>
        <ToggleButton pressed={!!log} title={log ? `Stop logging · ${log.path}` : "Save everything to a text file"} onClick={onToggleLog}>
          <span className={`size-2.5 rounded-full ${log ? "animate-pulse bg-err" : "border-[1.5px] border-current"}`} />
          {log ? `Log · ${formatBytes(log.bytes)}` : "Log"}
        </ToggleButton>
        <IconButton label="Open logs folder" onClick={onOpenLogFolder} className="size-8">
          <FolderIcon size={14} />
        </IconButton>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={togglePause}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised"
        >
          {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
          {paused ? "Resume" : "Pause"}
        </button>
        <IconButton label="Clear terminal and plot" onClick={clear}>
          <TrashIcon />
        </IconButton>
      </div>

      <div className="relative min-h-[240px] flex-1">
        <div ref={hostRef} className="absolute inset-0 py-2 pl-3" />
        {showJump && (
          <button
            type="button"
            onClick={goToEnd}
            className="absolute right-5 bottom-3.5 flex h-9 items-center gap-2 rounded-full bg-accent px-3.5 font-semibold text-on-accent shadow-[0_6px_20px_var(--color-shadow)] hover:brightness-110"
          >
            <ArrowDownIcon size={14} />
            Go to end{paused && pendingLines > 0 ? ` · ${pendingLines} new` : ""}
          </button>
        )}
      </div>

      <SendBar settings={settings} update={update} onSend={onSend} />
    </section>
  );
}

function SendBar({ settings, update, onSend }: Pick<Props, "settings" | "update" | "onSend">) {
  const [text, setText] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const history = settings.history;

  const submit = () => {
    if (!text) return;
    onSend(text);
    setText("");
    setHistoryIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const i = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(i);
      setText(history[i]);
    } else if (e.key === "ArrowDown" && historyIndex >= 0) {
      e.preventDefault();
      const i = historyIndex + 1;
      setHistoryIndex(i >= history.length ? -1 : i);
      setText(i >= history.length ? "" : history[i]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sendbar p-2.5">
      <label className="flex h-11 min-w-0 flex-[1_1_280px] items-center gap-2 rounded-lg border border-line-input bg-field px-3 focus-within:border-line-focus">
        <span className="font-mono font-medium text-accent">›</span>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={onKeyDown}
          aria-label="Command to send"
          placeholder="Type a command…   ↑↓ history   \r \n \xHH"
          autoComplete="off"
          spellCheck={false}
          className="h-10 min-w-0 flex-1 border-0 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:text-dim"
        />
      </label>
      <Segmented<LineEnding>
        label="Line ending"
        mono
        value={settings.lineEnding}
        options={LINE_ENDINGS.map((e) => ({ value: e.id, label: e.label }))}
        onChange={(lineEnding) => update({ lineEnding })}
      />
      <button
        type="button"
        onClick={submit}
        className="flex h-11 items-center gap-2 rounded-lg bg-accent px-[18px] font-semibold text-on-accent hover:brightness-110"
      >
        Send
        <SendIcon size={14} />
      </button>
    </div>
  );
}
