import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LINE_ENDINGS } from "../lib/encoding";
import { t } from "../lib/i18n";
import type { QuickCommand, Settings } from "../lib/settings";
import { type Emitter, formatBytes, type StreamEvent } from "../lib/stream";
import type { Theme } from "../lib/theme";
import { TerminalRenderer } from "../lib/terminalRenderer";
import type { ConnectionStatus } from "./ConnectionBar";
import { ArrowDownIcon, CheckIcon, ClockIcon, EchoIcon, FolderIcon, PauseIcon, PencilIcon, PlayIcon, PlugIcon, SendIcon, TrashIcon } from "./icons";
import { IconButton, Segmented, ToggleButton } from "./ui";


interface ReceiveProps {
  bus: Emitter<StreamEvent>;
  theme: Theme;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onClear: () => void;
  log: { path: string; bytes: number } | null;
  onToggleLog: () => void;
  onOpenLogFolder: () => void;
  counters: { rx: number; tx: number };
  status: ConnectionStatus;
  onConnect: () => void;
}

/** What arrives from the device (and, with "Show sent", what was sent), in order. */
export function ReceivePanel(props: ReceiveProps) {
  const { bus, theme, settings, update, onClear, log, onToggleLog, onOpenLogFolder, counters, status } = props;
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
  const welcome = status === "disconnected" && counters.rx === 0 && counters.tx === 0;

  return (
    <section aria-label={t("Received")} className="flex min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_var(--color-shadow)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line py-2 pr-2.5 pl-3.5">
        <h2 className="m-0 mr-1 text-sm font-semibold">{t("Received")}</h2>
        <span className="font-mono text-[11.5px] text-muted">{formatBytes(counters.rx)}</span>
        <div className="min-w-0 flex-1" />
        <Segmented
          label={t("View")}
          mono
          value={settings.viewMode}
          options={[
            { value: "ascii", label: "ASCII", title: t("Text") },
            { value: "hex", label: "HEX", title: t("Bytes in hexadecimal") },
          ]}
          onChange={(viewMode) => update({ viewMode })}
        />
        <ToggleButton pressed={settings.timestamps} title={t("Show the time of each line")} onClick={() => update({ timestamps: !settings.timestamps })}>
          <ClockIcon size={14} />
          {t("Time")}
        </ToggleButton>
        <ToggleButton pressed={settings.echo} title={t("Also show what is sent (TX lines)")} onClick={() => update({ echo: !settings.echo })}>
          <EchoIcon size={14} />
          {t("Show sent")}
        </ToggleButton>
        <button
          type="button"
          onClick={togglePause}
          title={t("Freeze the view; nothing is lost")}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-fg hover:bg-raised"
        >
          {paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
          {paused ? t("Resume") : t("Pause")}
        </button>
        <ToggleButton pressed={!!log} title={log ? t("Stop saving · {path}", { path: log.path }) : t("Save everything to a text file")} onClick={onToggleLog}>
          <span className={`size-2.5 rounded-full ${log ? "animate-pulse bg-err" : "border-[1.5px] border-err"}`} />
          {log ? `${t("Saving")} · ${formatBytes(log.bytes)}` : t("Save log")}
        </ToggleButton>
        <IconButton label={t("Open logs folder")} onClick={onOpenLogFolder} className="size-8">
          <FolderIcon size={14} />
        </IconButton>
        <IconButton label={t("Clear terminal and plot")} onClick={clear}>
          <TrashIcon />
        </IconButton>
      </div>

      <div className="relative min-h-[200px] flex-1">
        <div ref={hostRef} className="absolute inset-0 bg-raised py-2 pl-3" />
        {showJump && !welcome && (
          <button
            type="button"
            onClick={goToEnd}
            className="absolute right-5 bottom-3.5 flex h-9 items-center gap-2 rounded-full bg-accent px-3.5 font-semibold text-on-accent shadow-[0_6px_20px_var(--color-shadow)] hover:brightness-110"
          >
            <ArrowDownIcon size={14} />
            {t("Go to end")}
            {paused && pendingLines > 0 ? ` · ${t("{n} new", { n: pendingLines })}` : ""}
          </button>
        )}
        {welcome && (
          <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-panel p-4">
            <div className="flex max-w-[440px] flex-col gap-3 rounded-xl border border-line-strong bg-raised px-5 py-4">
              <h3 className="m-0 text-[17px] font-semibold">{t("Connect your board")}</h3>
              <ol className="m-0 flex flex-col gap-1.5 pl-5 leading-relaxed text-fg-2">
                <li>{t("Plug the board in with its USB cable.")}</li>
                <li>{t("Choose it in the Port drop-down above. ST boards show as “ST-LINK”.")}</li>
                <li>{t("Press Connect. What the board sends will show up here.")}</li>
              </ol>
              <button
                type="button"
                onClick={props.onConnect}
                disabled={!settings.port}
                className="flex h-10 items-center gap-2 self-start rounded-lg bg-accent px-5 font-semibold text-on-accent hover:brightness-110 disabled:opacity-45"
              >
                <PlugIcon />
                {settings.port ? t("Connect to {port}", { port: settings.port }) : t("Choose a port first")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

interface SendProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onSend: (text: string) => void;
}

/** Everything that goes to the device: quick commands and the command line. */
export function SendPanel({ settings, update, onSend }: SendProps) {
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
    <section aria-label={t("Send to the board")} className="flex flex-col gap-2.5 rounded-xl border border-line bg-sendbar py-2.5 pr-3 pl-3.5 shadow-[0_1px_2px_var(--color-shadow)]">
      <QuickCommandBar commands={settings.quickCommands} onChange={(quickCommands) => update({ quickCommands })} onRun={onSend} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-0 flex-[1_1_280px] items-center gap-2 rounded-lg border border-line-input bg-field px-3 focus-within:border-line-focus">
          <span className="font-mono font-semibold text-tx">›</span>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={onKeyDown}
            aria-label={t("Command to send")}
            placeholder={t("Type a command and press Enter   ↑↓ history   \\r \\n \\xHH")}
            autoComplete="off"
            spellCheck={false}
            className="h-10 min-w-0 flex-1 border-0 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:text-dim"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted" title={t("Characters added at the end of each command")}>
          {t("Line ending")}
          <select
            value={settings.lineEnding}
            onChange={(e) => update({ lineEnding: e.target.value as Settings["lineEnding"] })}
            className="h-9 rounded-lg border border-line-strong bg-field px-2 font-mono text-xs text-fg outline-none"
          >
            {LINE_ENDINGS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id === "none" ? t("None") : e.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={submit}
          className="flex h-11 items-center gap-2 rounded-lg bg-accent px-5 font-semibold text-on-accent hover:brightness-110"
        >
          {t("Send")}
          <SendIcon size={14} />
        </button>
      </div>
    </section>
  );
}

const inputClass = "h-8 min-w-0 rounded-md border border-line-strong bg-field px-2 text-fg outline-none focus:border-line-focus";

/** Named commands sent with a click or F1–F12; editable in place. */
function QuickCommandBar({ commands, onChange, onRun }: { commands: QuickCommand[]; onChange: (c: QuickCommand[]) => void; onRun: (command: string) => void }) {
  const [editing, setEditing] = useState(false);
  const patch = (id: string, p: Partial<QuickCommand>) => onChange(commands.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const add = () => {
    onChange([...commands, { id: crypto.randomUUID(), name: t("New"), command: "" }]);
    setEditing(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="m-0 mr-1 text-sm font-semibold">{t("Send to the board")}</h2>
      <span className="text-xs text-muted">{t("Quick commands")}:</span>

      {commands.length === 0 && !editing && <span className="text-xs text-dim">{t("none yet")}</span>}

      {commands.map((c, i) =>
        editing ? (
          <div key={c.id} className="flex items-center gap-1 rounded-lg border border-line-strong bg-raised p-1">
            <input aria-label={t("Name")} value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })} className={`${inputClass} w-24 font-medium`} />
            <input
              aria-label={t("Command")}
              placeholder={t("Command")}
              value={c.command}
              spellCheck={false}
              onChange={(e) => patch(c.id, { command: e.target.value })}
              className={`${inputClass} w-28 font-mono text-xs`}
            />
            <IconButton label={t("Delete {name}", { name: c.name })} onClick={() => onChange(commands.filter((x) => x.id !== c.id))} className="size-8 rounded-md hover:text-err">
              <TrashIcon size={13} />
            </IconButton>
          </div>
        ) : (
          <button
            key={c.id}
            type="button"
            disabled={!c.command}
            onClick={() => onRun(c.command)}
            title={c.command ? t("Send {cmd}", { cmd: c.command }) : t("Empty: edit it to add a command")}
            className="flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-raised pr-2.5 pl-1.5 text-fg hover:border-line-focus disabled:opacity-50"
          >
            {i < 12 && <kbd className="rounded border border-line-input px-1.5 font-mono text-[10.5px] text-muted">F{i + 1}</kbd>}
            <span className="font-medium">{c.name}</span>
            <span className="max-w-28 truncate font-mono text-[11px] text-muted">{c.command || t("(empty)")}</span>
          </button>
        ),
      )}

      <button type="button" onClick={add} className="h-8 rounded-lg border border-dashed border-line-focus px-2.5 text-muted hover:text-fg-2">
        + {t("Add")}
      </button>
      {commands.length > 0 && (
        <IconButton label={editing ? t("Done editing") : t("Edit quick commands")} onClick={() => setEditing(!editing)} className="size-8">
          {editing ? <CheckIcon size={14} /> : <PencilIcon size={14} />}
        </IconButton>
      )}
    </div>
  );
}
