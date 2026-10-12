import { useState } from "react";
import type { QuickCommand } from "../lib/settings";
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";
import { IconButton, PanelTitle } from "./ui";

interface Props {
  commands: QuickCommand[];
  onChange: (commands: QuickCommand[]) => void;
  onRun: (command: string) => void;
}

const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-line-strong bg-field px-2 text-fg outline-none focus:border-line-focus";

export function QuickCommands({ commands, onChange, onRun }: Props) {
  const [editing, setEditing] = useState(false);

  const patch = (id: string, p: Partial<QuickCommand>) =>
    onChange(commands.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const add = () => {
    onChange([...commands, { id: crypto.randomUUID(), name: "New", command: "" }]);
    setEditing(true);
  };

  return (
    <aside aria-label="Quick commands" className="flex w-[248px] shrink-0 flex-col gap-1.5 overflow-y-auto rounded-xl border border-line bg-panel p-3 scroll-thin">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <PanelTitle>Quick commands</PanelTitle>
        <div className="flex gap-1.5">
          <IconButton label={editing ? "Done editing" : "Edit commands"} onClick={() => setEditing(!editing)} className="size-7 rounded-md">
            {editing ? <CheckIcon size={14} /> : <PencilIcon size={14} />}
          </IconButton>
          <IconButton label="New quick command" onClick={add} className="size-7 rounded-md">
            <PlusIcon size={14} />
          </IconButton>
        </div>
      </div>

      {commands.length === 0 && (
        <p className="m-0 px-1 text-xs leading-relaxed text-muted">
          Keep the commands you send often here. Run them with a click or F1…F12.
        </p>
      )}

      {commands.map((c, i) =>
        editing ? (
          <div key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised p-2">
            <div className="flex gap-1.5">
              <input
                aria-label="Name"
                value={c.name}
                onChange={(e) => patch(c.id, { name: e.target.value })}
                className={`${inputClass} font-medium`}
              />
              <IconButton
                label={`Delete ${c.name}`}
                onClick={() => onChange(commands.filter((x) => x.id !== c.id))}
                className="size-8 shrink-0 rounded-md hover:text-err"
              >
                <TrashIcon size={14} />
              </IconButton>
            </div>
            <input
              aria-label="Command"
              placeholder="Command to send"
              value={c.command}
              spellCheck={false}
              onChange={(e) => patch(c.id, { command: e.target.value })}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>
        ) : (
          <button
            key={c.id}
            type="button"
            disabled={!c.command}
            onClick={() => onRun(c.command)}
            className="flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-2 text-left text-fg hover:border-line-focus disabled:opacity-50"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{c.name}</span>
              <span className="truncate font-mono text-[11.5px] text-muted">{c.command || "(empty)"}</span>
            </span>
            {i < 12 && (
              <kbd className="rounded border border-line-input px-1.5 py-px font-mono text-[11px] text-muted">F{i + 1}</kbd>
            )}
          </button>
        ),
      )}
    </aside>
  );
}
