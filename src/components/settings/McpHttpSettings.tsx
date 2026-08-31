import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  PUBLIC_MCP_TOOLS,
  mcpHttpService,
  type McpHttpServerSettings,
  type McpHttpServerStatus,
} from "@/services/tauri/mcp-http.service";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { Check, Clipboard, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";

const inputClass =
  "h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-control-bg))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]";

const defaultSettings: McpHttpServerSettings = {
  enabled: false,
  host: "127.0.0.1",
  port: 43521,
  path: "/mcp",
  allowRemote: false,
  allowedHosts: [],
  allowedOrigins: [],
  projectId: "",
  connectionId: null,
  databases: [],
  tools: PUBLIC_MCP_TOOLS.map((tool) => tool.name),
  maxRows: 200,
  maxResultBytes: 262144,
  queryTimeoutSecs: 30,
};

export function McpHttpSettings() {
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const connections = useConnectionStore((state) => state.connections);
  const [settings, setSettings] = useState<McpHttpServerSettings | null>(null);
  const [status, setStatus] = useState<McpHttpServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [databaseText, setDatabaseText] = useState("");
  const [allowedHostText, setAllowedHostText] = useState("");
  const [allowedOriginText, setAllowedOriginText] = useState("");

  const projectConnections = useMemo(
    () =>
      connections.filter(
        (connection) => connection.projectId === (settings?.projectId || activeProjectId),
      ),
    [activeProjectId, connections, settings?.projectId],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([mcpHttpService.loadSettings(), mcpHttpService.status()])
      .then(([loaded, currentStatus]) => {
        if (!active) return;
        const next = {
          ...defaultSettings,
          ...loaded,
          projectId: loaded.projectId || activeProjectId,
          tools:
            loaded.tools.length > 0
              ? loaded.tools
              : PUBLIC_MCP_TOOLS.map((tool) => tool.name),
        };
        setSettings(next);
        setDatabaseText(next.databases.join(", "));
        setAllowedHostText(next.allowedHosts.join(", "));
        setAllowedOriginText(next.allowedOrigins.join(", "));
        setStatus(currentStatus);
      })
      .catch((error) => {
        if (active) setMessage({ kind: "error", text: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [activeProjectId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void mcpHttpService
        .status()
        .then(setStatus)
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!settings) {
    return (
      <div className="py-10 text-center text-[12px] text-[hsl(var(--wb-text-muted))]">
        Loading MCP service settings…
      </div>
    );
  }

  const patch = (updates: Partial<McpHttpServerSettings>) =>
    setSettings((current) => (current ? { ...current, ...updates } : current));

  const persist = async (enabled = settings.enabled) => {
    const tools = settings.tools.filter((name) =>
      PUBLIC_MCP_TOOLS.some((tool) => tool.name === name),
    );
    if (enabled && tools.length === 0) {
      setMessage({ kind: "error", text: "Select at least one public read-only tool." });
      return;
    }
    const next: McpHttpServerSettings = {
      ...settings,
      enabled,
      projectId: settings.projectId || activeProjectId,
      connectionId: settings.connectionId || null,
      databases: splitList(databaseText),
      allowedHosts: splitList(allowedHostText),
      allowedOrigins: splitList(allowedOriginText),
      tools,
    };
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await mcpHttpService.saveSettings(next);
      setSettings(next);
      setStatus(nextStatus);
      setMessage({
        kind: "success",
        text: enabled ? "Streamable HTTP service is running." : "MCP HTTP service stopped.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const refreshStatus = async () => {
    setBusy(true);
    try {
      setStatus(await mcpHttpService.status());
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const rotateToken = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setStatus(await mcpHttpService.rotateToken());
      setMessage({
        kind: "success",
        text: "Access token rotated. Existing clients must use the new token.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-[6px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[hsl(var(--wb-text))]">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--wb-accent))]" />
              Public read-only MCP
            </div>
            <p className="mt-1 max-w-[70ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
              Exposes project-scoped database tools over authenticated MCP Streamable HTTP.
              This service never exposes mutation tools and is separate from the private
              Assistant approval bridge.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`h-2 w-2 rounded-full ${
                status?.running ? "bg-emerald-500" : "bg-[hsl(var(--wb-text-faint))]"
              }`}
            />
            <span className="text-[hsl(var(--wb-text-muted))]">
              {status?.running ? "Running" : settings.enabled ? "Unavailable" : "Stopped"}
            </span>
          </div>
        </div>
      </section>

      <SettingsGroup title="Authorization scope">
        <Field label="Project">
          <select
            className={inputClass}
            value={settings.projectId || activeProjectId}
            disabled={busy}
            onChange={(event) => patch({ projectId: event.target.value, connectionId: null })}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Connection">
          <select
            className={inputClass}
            value={settings.connectionId || ""}
            disabled={busy}
            onChange={(event) => patch({ connectionId: event.target.value || null })}
          >
            <option value="">Any connection in the selected project</option>
            {projectConnections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Databases" detail="Comma-separated. Empty grants the selected connection's normal database scope.">
          <input
            className={inputClass}
            value={databaseText}
            disabled={busy}
            onChange={(event) => setDatabaseText(event.target.value)}
            placeholder="reporting, analytics"
          />
        </Field>
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
            Allowed tools
          </div>
          {PUBLIC_MCP_TOOLS.map((tool) => {
            const checked = settings.tools.includes(tool.name);
            return (
              <label
                key={tool.name}
                className="flex cursor-pointer items-start gap-2 rounded-[4px] px-2 py-1.5 hover:bg-[hsl(var(--wb-hover))]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[hsl(var(--wb-accent))]"
                  checked={checked}
                  disabled={busy}
                  onChange={() =>
                    patch({
                      tools: checked
                        ? settings.tools.filter((name) => name !== tool.name)
                        : [...settings.tools, tool.name],
                    })
                  }
                />
                <span>
                  <span className="block text-[12px] text-[hsl(var(--wb-text))]">
                    {tool.title}
                    <code className="ml-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
                      {tool.name}
                    </code>
                  </span>
                  <span className="block text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                    {tool.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Limits">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Maximum rows">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={1000}
              value={settings.maxRows}
              disabled={busy}
              onChange={(event) => patch({ maxRows: Number(event.target.value) })}
            />
          </Field>
          <Field label="Maximum result bytes">
            <input
              className={inputClass}
              type="number"
              min={4096}
              max={1048576}
              value={settings.maxResultBytes}
              disabled={busy}
              onChange={(event) => patch({ maxResultBytes: Number(event.target.value) })}
            />
          </Field>
          <Field label="Query timeout (seconds)" detail="0 disables the deadline.">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={settings.queryTimeoutSecs ?? 30}
              disabled={busy}
              onChange={(event) => patch({ queryTimeoutSecs: Number(event.target.value) })}
            />
          </Field>
        </div>
      </SettingsGroup>

      <details className="rounded-[6px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-[hsl(var(--wb-text))]">
          Network and remote access
        </summary>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="Host">
            <input className={inputClass} value={settings.host} disabled={busy} onChange={(event) => patch({ host: event.target.value })} />
          </Field>
          <Field label="Port">
            <input className={inputClass} type="number" min={1} max={65535} value={settings.port} disabled={busy} onChange={(event) => patch({ port: Number(event.target.value) })} />
          </Field>
          <Field label="Path">
            <input className={inputClass} value={settings.path} disabled={busy} onChange={(event) => patch({ path: event.target.value })} />
          </Field>
        </div>
        <label className="mt-3 flex items-start gap-2 text-[12px] text-[hsl(var(--wb-text))]">
          <input type="checkbox" className="mt-0.5 accent-[hsl(var(--wb-accent))]" checked={settings.allowRemote} disabled={busy} onChange={() => patch({ allowRemote: !settings.allowRemote })} />
          <span>
            Allow a non-loopback listener
            <span className="block text-[10px] leading-4 text-[hsl(var(--wb-warning))]">
              Remote HTTP is unencrypted. Use a trusted network or a TLS reverse proxy.
            </span>
          </span>
        </label>
        {settings.allowRemote && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Allowed hosts" detail="Comma-separated Host header values.">
              <input className={inputClass} value={allowedHostText} disabled={busy} onChange={(event) => setAllowedHostText(event.target.value)} placeholder="mcp.example.internal" />
            </Field>
            <Field label="Allowed origins" detail="Exact HTTP(S) browser origins.">
              <input className={inputClass} value={allowedOriginText} disabled={busy} onChange={(event) => setAllowedOriginText(event.target.value)} placeholder="https://client.example.internal" />
            </Field>
          </div>
        )}
      </details>

      {status?.enabled && (
        <SettingsGroup title="Client connection">
          <CopyField label="Endpoint" value={status.endpoint || ""} />
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-[hsl(var(--wb-text-muted))]">
              <span>Bearer token</span>
              <button type="button" className="hover:text-[hsl(var(--wb-text))]" onClick={() => setShowToken((value) => !value)}>
                {showToken ? "Hide" : "Reveal"}
              </button>
            </div>
            <div className="flex gap-2">
              <input className={inputClass} type={showToken ? "text" : "password"} readOnly value={status.accessToken || ""} />
              <Button variant="outline" size="sm" className="h-8" onClick={() => void copyText(status.accessToken || "") }>
                <Clipboard className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
              <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void rotateToken()}>
                <KeyRound className="mr-1 h-3.5 w-3.5" /> Rotate
              </Button>
            </div>
          </div>
        </SettingsGroup>
      )}

      {(message || status?.lastError) && (
        <div className={`rounded-[4px] border px-3 py-2 text-[11px] ${message?.kind === "success" && !status?.lastError ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
          {status?.lastError || message?.text}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] pt-3">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refreshStatus()}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          Refresh status
        </Button>
        <div className="flex gap-2">
          {settings.enabled && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void persist(false)}>
              Stop service
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={() => void persist(true)}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {settings.enabled ? "Restart with changes" : "Save and start"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[6px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-4">
      <h3 className="mb-3 text-[12px] font-semibold text-[hsl(var(--wb-text))]">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[hsl(var(--wb-text-muted))]">{label}</span>
      {children}
      {detail && <span className="mt-1 block text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">{detail}</span>}
    </label>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input className={inputClass} readOnly value={value} />
        <Button variant="outline" size="sm" className="h-8" disabled={!value} onClick={() => void copyText(value)}>
          <Clipboard className="mr-1 h-3.5 w-3.5" /> Copy
        </Button>
      </div>
    </Field>
  );
}

function splitList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

async function copyText(value: string) {
  if (value) await navigator.clipboard.writeText(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
