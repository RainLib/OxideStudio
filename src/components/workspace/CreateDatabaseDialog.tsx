import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertCircle, Code2, Copy, Database, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionStore } from "@/store/useConnectionStore";
import { databaseService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri";
import { useSchemaStore } from "@/store/useSchemaStore";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
} from "@/lib/databaseDialect";
import { createNamespaceDdl } from "@/lib/databaseNamespaceDdl";
import { useProjectStore } from "@/store/useProjectStore";
import { refreshPostgresDatabaseCatalog } from "@/services/postgresDatabaseCatalogCache";

interface CreateDatabaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnectionId: string;
  onCreated?: (name: string) => void;
}

const MYSQL_CHARSETS = ["utf8mb4", "utf8", "latin1", "ascii", "gbk", "gb2312"];

const MYSQL_COLLATIONS: Record<string, string[]> = {
  utf8mb4: ["utf8mb4_general_ci", "utf8mb4_unicode_ci", "utf8mb4_bin"],
  utf8: ["utf8_general_ci", "utf8_unicode_ci", "utf8_bin"],
  latin1: ["latin1_general_ci", "latin1_swedish_ci", "latin1_bin"],
  ascii: ["ascii_general_ci", "ascii_bin"],
  gbk: ["gbk_chinese_ci", "gbk_bin"],
  gb2312: ["gb2312_chinese_ci", "gb2312_bin"],
};

const fieldClass =
  "h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2.5 text-[12px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";
const labelClass = "pt-2 text-[11px] text-[hsl(var(--wb-text-muted))]";

export function CreateDatabaseDialog({
  isOpen,
  onClose,
  activeConnectionId,
  onCreated,
}: CreateDatabaseDialogProps) {
  const [databaseName, setDatabaseName] = useState("");
  const [owner, setOwner] = useState("");
  const [charset, setCharset] = useState("");
  const [collation, setCollation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities | null>(null);

  const connections = useConnectionStore((state) => state.connections);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const setCurrentSchema = useSchemaStore((state) => state.setCurrentSchema);
  const connection = connections.find((item) => item.id === activeConnectionId);
  const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
  const activeCapabilities = capabilities || defaultDatabaseCapabilities(driver);
  const namespaceLabel = activeCapabilities.namespaceLabel || "database";
  const titleNamespaceLabel =
    namespaceLabel.charAt(0).toUpperCase() + namespaceLabel.slice(1);
  const isPostgres = driver === "postgres";
  const isMysql = driver === "mysql";
  const ddl = useMemo(
    () =>
      createNamespaceDdl({
        driver,
        name: databaseName,
        owner: isPostgres ? owner : undefined,
        charset: isMysql ? charset : undefined,
        collation: isMysql ? collation : undefined,
      }),
    [charset, collation, databaseName, driver, isMysql, isPostgres, owner]
  );

  useEffect(() => {
    if (!isOpen) return;
    setDatabaseName("");
    setOwner("");
    setCharset("");
    setCollation("");
    setError(null);
    setIsSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    setCapabilities(null);
    void databaseService
      .getDatabaseCapabilities(driver)
      .then((value) => {
        if (!cancelled) setCapabilities(value);
      })
      .catch((nextError) => {
        console.warn("Failed to load database capabilities", nextError);
        if (!cancelled) setCapabilities(defaultDatabaseCapabilities(driver));
      });
    return () => {
      cancelled = true;
    };
  }, [driver]);

  const handleCharsetChange = (nextCharset: string) => {
    const normalized = nextCharset === "__default" ? "" : nextCharset;
    setCharset(normalized);
    setCollation("");
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = databaseName.trim();
    if (!activeCapabilities.supportsCreateDatabase) {
      setError(`${activeCapabilities.displayName} ${namespaceLabel} creation is not supported.`);
      return;
    }
    if (!name) {
      setError(`${titleNamespaceLabel} name is required.`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await databaseService.createDatabase(
        activeConnectionId,
        driver,
        name,
        activeCapabilities.supportsCreateDatabaseCharset ? charset : undefined,
        activeCapabilities.supportsCreateDatabaseCharset ? collation : undefined,
        isPostgres ? owner.trim() || undefined : undefined
      );
      if (isPostgres) {
        await refreshPostgresDatabaseCatalog({
          projectId: activeProjectId,
          connectionId: activeConnectionId,
          driver: "postgres",
        });
      } else {
        await loadSchemas(activeConnectionId, true);
        await setCurrentSchema(name);
      }
      onCreated?.(name);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="w-[760px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <form onSubmit={(event) => void handleCreate(event)}>
          <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
                <Database size={15} />
              </span>
              <div>
                <DialogTitle className="text-[13px] tracking-normal">
                  New {titleNamespaceLabel}
                </DialogTitle>
                <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                  {connection?.name || "Active data source"} · {activeCapabilities.displayName}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid min-h-[300px] grid-cols-[minmax(0,1fr)_minmax(300px,0.92fr)]">
            <section className="border-r border-[hsl(var(--wb-border-subtle))] px-4 py-4">
              <div className="mb-3 text-[11px] font-medium text-[hsl(var(--wb-text))]">
                General
              </div>
              <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-3">
                <label htmlFor="namespace-name" className={labelClass}>Name</label>
                <input
                  id="namespace-name"
                  autoFocus
                  value={databaseName}
                  onChange={(event) => {
                    setDatabaseName(event.target.value);
                    setError(null);
                  }}
                  className={fieldClass}
                  placeholder={isPostgres ? "app_schema" : "app_database"}
                  disabled={isSubmitting}
                />

                {isPostgres && (
                  <>
                    <label htmlFor="namespace-owner" className={labelClass}>Authorization</label>
                    <div>
                      <input
                        id="namespace-owner"
                        value={owner}
                        onChange={(event) => setOwner(event.target.value)}
                        className={fieldClass}
                        placeholder="Current user"
                        disabled={isSubmitting}
                      />
                      <p className="mt-1 text-[10px] wb-muted">
                        Optional role that will own the schema.
                      </p>
                    </div>
                  </>
                )}

                {activeCapabilities.supportsCreateDatabaseCharset && (
                  <>
                    <span className={labelClass}>Character set</span>
                    <Select value={charset || "__default"} onValueChange={handleCharsetChange} disabled={isSubmitting}>
                      <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                      <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                        <SelectItem value="__default">Server default</SelectItem>
                        {MYSQL_CHARSETS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    <span className={labelClass}>Collation</span>
                    <Select
                      value={collation || "__default"}
                      onValueChange={(value) => setCollation(value === "__default" ? "" : value)}
                      disabled={isSubmitting || !charset}
                    >
                      <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                      <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                        <SelectItem value="__default">Default for character set</SelectItem>
                        {(MYSQL_COLLATIONS[charset] || []).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-[4px] bg-red-500/8 px-2.5 py-2 text-[11px] text-red-400" role="alert">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </section>

            <section className="flex min-w-0 flex-col bg-[hsl(var(--wb-editor))]">
              <div className="flex h-9 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium">
                  <Code2 size={13} className="text-[hsl(var(--wb-accent))]" />
                  SQL Preview
                </span>
                <button
                  type="button"
                  className="wb-icon-button h-6 w-6"
                  title="Copy SQL"
                  onClick={() => void navigator.clipboard.writeText(ddl)}
                >
                  <Copy size={12} />
                </button>
              </div>
              <pre className="min-h-0 flex-1 whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))]">
                {ddl}
              </pre>
            </section>
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:space-x-0">
            <button type="button" className="wb-text-button h-7 px-3 text-[11px]" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="wb-primary-button h-7 min-w-[96px] justify-center px-3 text-[11px]" disabled={isSubmitting || !databaseName.trim()}>
              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : `Create ${titleNamespaceLabel}`}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
