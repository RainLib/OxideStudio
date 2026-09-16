import { inputClass } from "@/features/settings/ui/SettingsFields";
import {
  DEFAULT_APP_SETTINGS,
  type SqlSnippetSetting,
} from "@/lib/appSettings";
import { downloadText } from "@/lib/exportUtils";
import { cn } from "@/lib/utils";
import { Download, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function SqlSnippetSettingsEditor({
  snippets,
  onCommit,
}: {
  snippets: SqlSnippetSetting[];
  onCommit: (snippets: SqlSnippetSetting[]) => void;
}) {
  const serializedSnippets = useMemo(
    () => JSON.stringify(snippets),
    [snippets],
  );
  const [drafts, setDrafts] = useState<SqlSnippetSetting[]>(() =>
    snippets.map((snippet) => ({ ...snippet })),
  );
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDrafts(snippets.map((snippet) => ({ ...snippet })));
    setError(null);
    // A serialized dependency avoids resetting an in-progress local draft
    // when the parent recreates an equivalent settings object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedSnippets]);

  const validate = (next: SqlSnippetSetting[]) => {
    if (next.length > 100) return "At most 100 snippets are supported.";
    const prefixes = new Set<string>();
    const ids = new Set<string>();
    for (const snippet of next) {
      const id = snippet.id.trim();
      if (!id || ids.has(id)) {
        return "Every snippet must have a unique non-empty id.";
      }
      const prefix = snippet.prefix.trim().toLowerCase();
      if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(prefix)) {
        return `Trigger “${snippet.prefix || "(empty)"}” must start with a letter or underscore and contain only letters, numbers, _ or -.`;
      }
      if (prefixes.has(prefix)) {
        return `Trigger “${prefix}” is already used by another snippet.`;
      }
      if (!snippet.label.trim()) return `Snippet “${prefix}” needs a label.`;
      if (!snippet.body.trim()) return `Snippet “${prefix}” needs SQL content.`;
      if (snippet.label.length > 120) {
        return `Snippet “${prefix}” label is longer than 120 characters.`;
      }
      if (snippet.body.length > 65_536) {
        return `Snippet “${prefix}” SQL content is larger than 65,536 characters.`;
      }
      prefixes.add(prefix);
      ids.add(id);
    }
    return null;
  };

  const commit = (next: SqlSnippetSetting[]) => {
    const validationError = validate(next);
    setError(validationError);
    if (validationError) return false;
    const normalized = next.map((snippet) => ({
      ...snippet,
      prefix: snippet.prefix.trim().toLowerCase(),
      label: snippet.label.trim(),
      detail: snippet.detail.trim() || "Custom SQL snippet",
    }));
    onCommit(normalized);
    return true;
  };

  const updateDraft = (
    index: number,
    patch: Partial<SqlSnippetSetting>,
    commitImmediately = false,
  ) => {
    const next = drafts.map((snippet, snippetIndex) =>
      snippetIndex === index ? { ...snippet, ...patch } : snippet,
    );
    setDrafts(next);
    if (commitImmediately) commit(next);
  };

  const addSnippet = () => {
    const used = new Set(drafts.map((snippet) => snippet.prefix.toLowerCase()));
    let suffix = 1;
    let prefix = "snippet";
    while (used.has(prefix)) {
      prefix = `snippet${suffix}`;
      suffix += 1;
    }
    const next = [
      ...drafts,
      {
        id: `custom-${Date.now().toString(36)}-${suffix}`,
        prefix,
        label: "custom query",
        detail: "Custom SQL snippet",
        body: "SELECT ${1:*}\nFROM ${2:table};",
        enabled: true,
      },
    ];
    setDrafts(next);
    commit(next);
  };

  const exportSnippets = () => {
    const validationError = validate(drafts);
    setError(validationError);
    if (validationError) return;
    downloadText(
      `${JSON.stringify({ version: 1, snippets: drafts }, null, 2)}\n`,
      "oxide-sql-snippets.json",
      "application/json;charset=utf-8",
    );
  };

  const importSnippets = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const values = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { snippets?: unknown }).snippets)
          ? (parsed as { snippets: unknown[] }).snippets
          : null;
      if (!values)
        throw new Error("The file does not contain a snippets array.");
      const imported = values.map((value, index): SqlSnippetSetting => {
        if (!value || typeof value !== "object") {
          throw new Error(`Snippet ${index + 1} is not an object.`);
        }
        const candidate = value as Partial<SqlSnippetSetting>;
        if (
          typeof candidate.prefix !== "string" ||
          typeof candidate.label !== "string" ||
          typeof candidate.body !== "string"
        ) {
          throw new Error(
            `Snippet ${index + 1} requires string prefix, label and body fields.`,
          );
        }
        return {
          id:
            typeof candidate.id === "string" && candidate.id.trim()
              ? candidate.id.trim()
              : `imported-${Date.now().toString(36)}-${index}`,
          prefix: candidate.prefix,
          label: candidate.label,
          detail:
            typeof candidate.detail === "string"
              ? candidate.detail
              : "Imported SQL snippet",
          body: candidate.body,
          enabled: candidate.enabled !== false,
        };
      });
      if (commit(imported)) setDrafts(imported);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import SQL snippets.",
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          Type a trigger in the SQL editor to insert a cursor-navigable
          template. Use Monaco placeholders such as {"${1:table}"} and{" "}
          {"${2:column}"}.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) =>
              void importSnippets(event.currentTarget.files?.[0])
            }
          />
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={12} /> Import
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={exportSnippets}
            disabled={drafts.length === 0}
          >
            <Download size={12} /> Export
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={addSnippet}
          >
            <Plus size={12} /> Add
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={() => {
              const defaults =
                DEFAULT_APP_SETTINGS.editor.sqlCompletion.snippets.map(
                  (snippet) => ({ ...snippet }),
                );
              setDrafts(defaults);
              commit(defaults);
            }}
          >
            <RotateCcw size={12} /> Defaults
          </button>
        </div>
      </div>
      <div className="custom-scrollbar max-h-[430px] space-y-1.5 overflow-y-auto pr-1">
        {drafts.map((snippet, index) => (
          <div
            key={snippet.id}
            className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] p-2"
          >
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={snippet.enabled}
                aria-label={`${snippet.label} enabled`}
                onChange={(event) =>
                  updateDraft(index, { enabled: event.target.checked }, true)
                }
              />
              <input
                className={cn(inputClass, "w-24 font-mono text-[11px]")}
                value={snippet.prefix}
                maxLength={32}
                aria-label="Snippet trigger"
                title="Completion trigger"
                onChange={(event) =>
                  updateDraft(index, {
                    prefix: event.target.value
                      .toLowerCase()
                      .replace(/\s+/g, ""),
                  })
                }
                onBlur={() => commit(drafts)}
              />
              <input
                className={cn(inputClass, "min-w-0 flex-1 text-[11px]")}
                value={snippet.label}
                maxLength={120}
                aria-label="Snippet label"
                title="Completion label"
                onChange={(event) =>
                  updateDraft(index, { label: event.target.value })
                }
                onBlur={() => commit(drafts)}
              />
              <button
                type="button"
                className="wb-icon-button h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--destructive))]"
                title={`Delete ${snippet.label}`}
                aria-label={`Delete ${snippet.label}`}
                onClick={() => {
                  const next = drafts.filter(
                    (_, snippetIndex) => snippetIndex !== index,
                  );
                  setDrafts(next);
                  commit(next);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <textarea
              className="custom-scrollbar mt-1.5 min-h-20 w-full resize-y rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 py-1.5 font-mono text-[11px] leading-4 text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]"
              value={snippet.body}
              maxLength={65_536}
              spellCheck={false}
              aria-label={`${snippet.label} SQL template`}
              onChange={(event) =>
                updateDraft(index, { body: event.target.value })
              }
              onBlur={() => commit(drafts)}
            />
          </div>
        ))}
      </div>
      {drafts.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[hsl(var(--wb-border))] px-3 py-4 text-center text-[10px] text-[hsl(var(--wb-text-muted))]">
          No SQL snippets are enabled. Add one or restore the defaults.
        </p>
      )}
      {error && (
        <p
          className="text-[10px] leading-4 text-[hsl(var(--destructive))]"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
