import {
  inputClass,
  SettingRow,
  SettingsButton,
  SettingsIconButton,
} from "@/features/settings/ui/SettingsFields";
import { cn } from "@/lib/utils";
import {
  aiService,
  type AiHttpProviderScope,
} from "@/services/tauri/ai.service";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export type ProviderHeaderRow = {
  id: number;
  name: string;
  value: string;
};

export const RESERVED_AI_PROVIDER_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "proxy-authorization",
]);

export const AI_PROVIDER_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

let nextProviderHeaderRowId = 1;

export function providerHeaderRows(
  headers: Record<string, string>,
): ProviderHeaderRow[] {
  return Object.entries(headers).map(([name, value]) => ({
    id: nextProviderHeaderRowId++,
    name,
    value,
  }));
}

export function providerHeadersFromRows(
  rows: readonly ProviderHeaderRow[],
): Record<string, string> {
  const headers: Record<string, string> = {};
  const names = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && !row.value) continue;
    if (!AI_PROVIDER_HEADER_NAME.test(name)) {
      throw new Error(`Invalid request header name: ${name || "empty name"}.`);
    }
    const canonical = name.toLowerCase();
    if (RESERVED_AI_PROVIDER_HEADERS.has(canonical)) {
      throw new Error(
        `${name} is managed by OxideStudio and cannot be overridden.`,
      );
    }
    if (names.has(canonical)) {
      throw new Error(`Request header ${name} is duplicated.`);
    }
    if (/[\r\n\0]/u.test(row.value)) {
      throw new Error(
        `Request header ${name} contains an invalid line break or null byte.`,
      );
    }
    names.add(canonical);
    headers[name] = row.value;
  }
  return headers;
}

export function ProviderHeadersEditor({
  baseUrl,
  scope,
}: {
  baseUrl: string;
  scope: AiHttpProviderScope;
}) {
  const [rows, setRows] = useState<ProviderHeaderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    const destination = baseUrl.trim();
    setStatus(null);
    if (!destination) {
      setRows([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void aiService
      .getProviderHeaders(destination, scope)
      .then((headers) => {
        if (active) setRows(providerHeaderRows(headers));
      })
      .catch((error: any) => {
        if (active) {
          setRows([]);
          setStatus({
            kind: "error",
            message: error?.message || String(error),
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [baseUrl, scope]);

  const updateRow = (id: number, field: "name" | "value", value: string) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setStatus(null);
  };

  const save = async () => {
    const destination = baseUrl.trim();
    if (!destination) {
      setStatus({
        kind: "error",
        message: "Enter the provider base URL first.",
      });
      return;
    }
    let headers: Record<string, string>;
    try {
      headers = providerHeadersFromRows(rows);
    } catch (error: any) {
      setStatus({ kind: "error", message: error?.message || String(error) });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const names = await aiService.setProviderHeaders(
        destination,
        scope,
        headers,
      );
      setStatus({
        kind: "success",
        message: names.length
          ? `Saved ${names.length} private request header${names.length === 1 ? "" : "s"}.`
          : "Removed all private request headers.",
      });
    } catch (error: any) {
      setStatus({ kind: "error", message: error?.message || String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow label="Request headers:">
      <div className="w-[520px] overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))]">
        <div className="flex items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-2.5 py-2">
          <div>
            <div className="text-[11px] font-medium text-[hsl(var(--wb-text))]">
              Gateway and tenant routing
            </div>
            <div className="mt-0.5 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
              Authorization may replace the API key bearer header. HTTP framing
              headers stay protected.
            </div>
          </div>
          <span className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--wb-text-muted))]">
            {scope}
          </span>
        </div>
        <div className="space-y-1.5 p-2.5">
          {loading ? (
            <div className="py-2 text-[11px] text-[hsl(var(--wb-text-muted))]">
              Loading private headers…
            </div>
          ) : rows.length ? (
            rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_28px] gap-1.5"
              >
                <input
                  aria-label="Request header name"
                  className={cn(inputClass, "w-full font-mono text-[11px]")}
                  value={row.name}
                  onChange={(event) =>
                    updateRow(row.id, "name", event.target.value)
                  }
                  placeholder="X-Tenant"
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  aria-label={`${row.name || "Request header"} value`}
                  className={cn(inputClass, "w-full font-mono text-[11px]")}
                  type="password"
                  value={row.value}
                  onChange={(event) =>
                    updateRow(row.id, "value", event.target.value)
                  }
                  placeholder="Private value"
                  autoComplete="off"
                  spellCheck={false}
                />
                <SettingsIconButton
                  title={`Remove ${row.name || "request header"}`}
                  onClick={() => {
                    setRows((current) =>
                      current.filter((item) => item.id !== row.id),
                    );
                    setStatus(null);
                  }}
                >
                  <Trash2 size={13} />
                </SettingsIconButton>
              </div>
            ))
          ) : (
            <div className="rounded-[4px] border border-dashed border-[hsl(var(--wb-border-subtle))] px-2.5 py-2 text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
              No additional headers. Add one when an API gateway requires a
              tenant, project, or alternate authorization header.
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-[4px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] disabled:opacity-45"
              disabled={loading || saving}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { id: nextProviderHeaderRowId++, name: "", value: "" },
                ])
              }
            >
              <Plus size={12} /> Add header
            </button>
            <SettingsButton
              intent="primary"
              disabled={loading || saving || !baseUrl.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save headers"}
            </SettingsButton>
          </div>
          {status && (
            <div
              role="status"
              className={cn(
                "text-[10px] leading-4",
                status.kind === "error"
                  ? "text-[hsl(var(--destructive))]"
                  : "text-emerald-400",
              )}
            >
              {status.message}
            </div>
          )}
          <div className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
            Values are stored in a current-user-only Rust credential file and
            never enter browser storage, project files, logs, or Agent
            checkpoints.
          </div>
        </div>
      </div>
    </SettingRow>
  );
}
