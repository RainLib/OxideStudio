import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  compileSqlParameters,
  extractSqlParameters,
  type SqlParameterMode,
  type SqlParameterValue,
} from "@/lib/sqlParameters";
import { AlertTriangle, Braces, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ParameterDraft = SqlParameterValue & { assigned: boolean };

interface SqlParametersPanelProps {
  sql: string;
  dialect?: string | null;
  isConnected: boolean;
  isExecuting: boolean;
  onClose: () => void;
  onRun: (compiledSql: string) => void;
}

function initialDrafts(sql: string, dialect?: string | null) {
  return Object.fromEntries(
    extractSqlParameters(sql, dialect).map((parameter) => [
      parameter.key,
      { mode: "quoted", value: "", assigned: false } satisfies ParameterDraft,
    ])
  );
}

export function SqlParametersPanel({
  sql,
  dialect,
  isConnected,
  isExecuting,
  onClose,
  onRun,
}: SqlParametersPanelProps) {
  const parameters = useMemo(
    () => extractSqlParameters(sql, dialect),
    [dialect, sql]
  );
  const [drafts, setDrafts] = useState<Record<string, ParameterDraft>>(() =>
    initialDrafts(sql, dialect)
  );

  useEffect(() => {
    setDrafts(initialDrafts(sql, dialect));
  }, [dialect, sql]);

  const values = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(drafts)
          .filter(([, draft]) => draft.assigned)
          .map(([key, { mode, value }]) => [key, { mode, value }])
      ),
    [drafts]
  );
  const compilation = useMemo(
    () => compileSqlParameters(sql, values, dialect),
    [dialect, sql, values]
  );
  const issueByKey = useMemo(
    () => new Map(compilation.issues.map((issue) => [issue.key, issue.message])),
    [compilation.issues]
  );
  const usesRawSql = Object.values(drafts).some(
    (draft) => draft.mode === "raw"
  );

  const updateMode = (key: string, mode: SqlParameterMode) => {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        mode,
        assigned: mode === "null" || Boolean(current[key]?.value),
      },
    }));
  };

  const updateValue = (key: string, value: string) => {
    setDrafts((current) => {
      const draft = current[key] || {
        mode: "quoted" as const,
        value: "",
        assigned: false,
      };
      return {
        ...current,
        [key]: { ...draft, value, assigned: true },
      };
    });
  };

  const markAssigned = (key: string) => {
    setDrafts((current) => {
      const draft = current[key];
      if (!draft || draft.assigned) return current;
      return { ...current, [key]: { ...draft, assigned: true } };
    });
  };

  return (
    <section
      aria-label="SQL parameters"
      className="border-b border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]"
    >
      <div className="flex h-9 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3">
        <Braces size={14} className="text-[hsl(var(--wb-accent))]" />
        <h2 className="text-[12px] font-semibold">SQL parameters</h2>
        <span className="text-[10px] wb-muted">
          {parameters.length} {parameters.length === 1 ? "value" : "values"}
        </span>
        <span className="ml-auto text-[10px] wb-muted">
          Runs a temporary copy; editor text stays unchanged
        </span>
        <button
          type="button"
          className="wb-icon-button"
          aria-label="Close SQL parameters"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex max-h-[42vh] flex-wrap overflow-y-auto custom-scrollbar">
        <div className="min-w-[340px] flex-[3_1_460px] px-3 py-2">
          <div className="mb-1 grid grid-cols-[minmax(92px,0.8fr)_112px_minmax(160px,2fr)] gap-2 px-1 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
            <span>Placeholder</span>
            <span>Value type</span>
            <span>Value</span>
          </div>
          <div className="space-y-1">
            {parameters.map((parameter) => {
              const draft = drafts[parameter.key] || {
                mode: "quoted" as const,
                value: "",
                assigned: false,
              };
              const issue = issueByKey.get(parameter.key);
              return (
                <div key={parameter.key}>
                  <div className="grid grid-cols-[minmax(92px,0.8fr)_112px_minmax(160px,2fr)] items-center gap-2 rounded-[4px] px-1 py-1 hover:bg-[hsl(var(--wb-hover))]">
                    <div className="min-w-0">
                      <code className="block truncate text-[11px] text-[hsl(var(--wb-text))]">
                        {parameter.label}
                      </code>
                      {parameter.occurrences > 1 && (
                        <span className="text-[9px] wb-muted">
                          {parameter.occurrences} occurrences
                        </span>
                      )}
                    </div>
                    <select
                      aria-label={`Value type for ${parameter.label}`}
                      className="wb-field w-full"
                      value={draft.mode}
                      onChange={(event) =>
                        updateMode(
                          parameter.key,
                          event.target.value as SqlParameterMode
                        )
                      }
                    >
                      <option value="quoted">Quoted text</option>
                      <option value="raw">Raw SQL</option>
                      <option value="null">NULL</option>
                    </select>
                    {draft.mode === "null" ? (
                      <div className="flex h-7 items-center rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] wb-muted">
                        NULL
                      </div>
                    ) : (
                      <Input
                        aria-label={`Value for ${parameter.label}`}
                        className="wb-field w-full font-mono"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                          draft.mode === "raw"
                            ? "42, CURRENT_DATE, table_name…"
                            : "Text; quotes are escaped"
                        }
                        value={draft.value || ""}
                        onFocus={() => markAssigned(parameter.key)}
                        onChange={(event) =>
                          updateValue(parameter.key, event.target.value)
                        }
                      />
                    )}
                  </div>
                  {issue && (
                    <p className="px-1 pb-1 text-[9px] text-red-300">{issue}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-[280px] flex-[2_1_360px] border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2 min-[900px]:border-l min-[900px]:border-t-0">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-medium wb-muted">Execution preview</span>
            <span className="text-[9px] wb-muted">Read only</span>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-[hsl(var(--wb-editor))] p-2 font-mono text-[10px] leading-4 text-[hsl(var(--wb-text))] custom-scrollbar">
            {compilation.sql}
          </pre>
          {usesRawSql && (
            <div className="mt-2 flex gap-2 rounded-[4px] border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[9px] leading-4 text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Raw SQL is inserted without quoting. Review the preview before running.
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-10 items-center justify-between gap-3 border-t border-[hsl(var(--wb-border-subtle))] px-3 py-1.5">
        <p className="text-[9px] wb-muted">
          Quoted text is encoded as a SQL text value. Raw SQL is for numbers, expressions, and identifiers.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="wb-text-button"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="wb-primary-button"
            disabled={
              compilation.issues.length > 0 || !isConnected || isExecuting
            }
            onClick={() => onRun(compilation.sql)}
          >
            <Play size={11} className="fill-current" />
            Run generated SQL
          </Button>
        </div>
      </div>
    </section>
  );
}
