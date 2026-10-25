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
import type {
  DatabaseCapabilities,
  DatabaseDriverInstallation,
} from "@/services/tauri";
import { useSchemaStore } from "@/store/useSchemaStore";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  normalizeDatabaseDriverName,
} from "@/lib/databaseDialect";
import {
  createNamespaceDdl,
  mongoCreateDatabasePreview,
} from "@/lib/databaseNamespaceDdl";
import { useProjectStore } from "@/store/useProjectStore";
import { refreshPostgresDatabaseCatalog } from "@/services/postgresDatabaseCatalogCache";
import { connectionUsesExternalDriverPackage } from "@/features/database-drivers";

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
  const [capabilityResolutionError, setCapabilityResolutionError] = useState<string | null>(null);
  const [driverInstallations, setDriverInstallations] = useState<
    DatabaseDriverInstallation[] | null
  >(null);
  const [driverResolutionError, setDriverResolutionError] = useState<string | null>(null);

  const connections = useConnectionStore((state) => state.connections);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const setCurrentSchema = useSchemaStore((state) => state.setCurrentSchema);
  const connection = connections.find((item) => item.id === activeConnectionId);
  const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
  const normalizedDriver = normalizeDatabaseDriverName(driver) || driver;
  const activeCapabilities = capabilities || defaultDatabaseCapabilities(driver);
  const isCapabilitiesLoading =
    capabilities === null || driverInstallations === null;
  const canCreateNamespace =
    !isCapabilitiesLoading &&
    !capabilityResolutionError &&
    !driverResolutionError &&
    activeCapabilities.supportsCreateDatabase === true;
  const namespaceLabel = activeCapabilities.namespaceLabel || "database";
  const titleNamespaceLabel =
    namespaceLabel.charAt(0).toUpperCase() + namespaceLabel.slice(1);
  // Connection aliases must use the same canonical dialect as the Host.
  // MariaDB is a MySQL-family example: its capability form and preview must
  // not silently degrade simply because the saved connection uses an alias.
  const isPostgres = normalizedDriver === "postgres";
  const isMysql = normalizedDriver === "mysql";
  const isMongo = normalizedDriver === "mongodb";
  const usesExternalDriverPackage = connectionUsesExternalDriverPackage(
    driver,
    connection?.driverPackageVersion,
    driverInstallations || [],
  );
  const hasSqlPreview =
    (isPostgres || isMysql) && !usesExternalDriverPackage;
  const hasMongoCommandPreview = isMongo && !usesExternalDriverPackage;
  const supportsOwner = activeCapabilities.supportsCreateDatabaseOwner === true;
  const supportsCharset = activeCapabilities.supportsCreateDatabaseCharset === true;
  const supportsCollation = activeCapabilities.supportsCreateDatabaseCollation === true;
  const ddl = useMemo(
    () => {
      if (isCapabilitiesLoading) {
        return "-- Loading the verified driver capability contract before creating a namespace.";
      }
      if (capabilityResolutionError) {
        return "-- The active driver capability contract could not be verified. Namespace creation is disabled.";
      }
      if (!activeCapabilities.supportsCreateDatabase) {
        return `-- ${activeCapabilities.displayName} does not declare namespace creation for this connection.\n-- Install or activate a driver package that explicitly supports this operation.`;
      }
      if (hasMongoCommandPreview) {
        return mongoCreateDatabasePreview(databaseName);
      }
      if (!hasSqlPreview) {
        return databaseName.trim()
          ? `-- ${activeCapabilities.displayName} will validate and create “${databaseName.trim()}” inside its verified driver runtime.\n-- No host-generated SQL is used for this database family.`
          : "-- Enter a name to review the driver-managed creation request.";
      }
      return createNamespaceDdl({
        driver: normalizedDriver,
        name: databaseName,
        owner: isPostgres ? owner : undefined,
        charset: isMysql ? charset : undefined,
        collation: isMysql ? collation : undefined,
      });
    },
    [
      activeCapabilities.displayName,
      capabilityResolutionError,
      activeCapabilities.supportsCreateDatabase,
      charset,
      collation,
      databaseName,
      driver,
      hasMongoCommandPreview,
      hasSqlPreview,
      isCapabilitiesLoading,
      isMysql,
      isPostgres,
      normalizedDriver,
      owner,
    ]
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
    setCapabilityResolutionError(null);
    void databaseService
      .getDatabaseCapabilities(driver, connection?.driverPackageVersion)
      .then((value) => {
        if (!cancelled) setCapabilities(value);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setCapabilities(defaultDatabaseCapabilities(driver));
          setCapabilityResolutionError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to verify the active driver capability contract.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.driverPackageVersion, driver]);

  useEffect(() => {
    let cancelled = false;
    setDriverInstallations(null);
    setDriverResolutionError(null);
    void databaseService
      .listDatabaseDriverInstallations()
      .then((installations) => {
        if (!cancelled) setDriverInstallations(installations);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setDriverInstallations([]);
          setDriverResolutionError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to verify the active driver package.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.driverPackageVersion, normalizedDriver]);

  const handleCharsetChange = (nextCharset: string) => {
    const normalized = nextCharset === "__default" ? "" : nextCharset;
    setCharset(normalized);
    setCollation("");
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = databaseName.trim();
    if (isCapabilitiesLoading) {
      setError("Driver capabilities are still loading. Please wait before creating a namespace.");
      return;
    }
    if (capabilityResolutionError) {
      setError("The active driver capability contract could not be verified. Reopen this dialog and try again.");
      return;
    }
    if (driverResolutionError) {
      setError("The active driver package could not be verified. Reopen this dialog and try again.");
      return;
    }
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
        supportsCharset ? charset || undefined : undefined,
        supportsCollation ? collation || undefined : undefined,
        supportsOwner ? owner.trim() || undefined : undefined
      );
      // The persisted catalog cache keeps its historical PostgreSQL name,
      // but it is driver-scoped and backs every capability-declared
      // catalog provider. Refresh it for an external database/catalog create
      // too; loading only the current connection's schemas would leave the
      // new namespace invisible until a later manual refresh.
      if (isPostgres || activeCapabilities.supportsDatabaseCatalogs) {
        await refreshPostgresDatabaseCatalog({
          projectId: activeProjectId,
          connectionId: activeConnectionId,
          driver: isPostgres ? "postgres" : driver,
        });
      } else {
        await loadSchemas(activeConnectionId, true);
        if (!activeCapabilities.supportsDatabaseCatalogs) {
          await setCurrentSchema(name);
        }
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
      <DialogContent layout="custom" className="w-[760px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0">
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

                {supportsOwner && (
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
                        Optional owner / authorization principal for the new {namespaceLabel}.
                      </p>
                    </div>
                  </>
                )}

                {supportsCharset && isMysql && (
                  <>
                    <span className={labelClass}>Character set</span>
                    <Select value={charset || "__default"} onValueChange={handleCharsetChange} disabled={isSubmitting}>
                      <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                      <SelectContent className="">
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
                      <SelectContent className="">
                        <SelectItem value="__default">Default for character set</SelectItem>
                        {(MYSQL_COLLATIONS[charset] || []).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {supportsCharset && !isMysql && (
                  <>
                    <label htmlFor="namespace-charset" className={labelClass}>Character set</label>
                    <input
                      id="namespace-charset"
                      value={charset}
                      onChange={(event) => setCharset(event.target.value)}
                      className={fieldClass}
                      placeholder="Driver default"
                      disabled={isSubmitting}
                    />
                  </>
                )}

                {supportsCollation && !isMysql && (
                  <>
                    <label htmlFor="namespace-collation" className={labelClass}>Collation</label>
                    <input
                      id="namespace-collation"
                      value={collation}
                      onChange={(event) => setCollation(event.target.value)}
                      className={fieldClass}
                      placeholder="Driver default"
                      disabled={isSubmitting}
                    />
                  </>
                )}
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-[4px] bg-red-500/8 px-2.5 py-2 text-[11px] text-red-400" role="alert">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {(capabilityResolutionError || driverResolutionError) && (
                <div className="mt-4 flex items-start gap-2 rounded-[4px] bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-200" role="alert">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>Unable to verify the active driver capability contract. Creation remains disabled until it can be read.</span>
                </div>
              )}
            </section>

            <section className="flex min-w-0 flex-col bg-[hsl(var(--wb-editor))]">
              <div className="flex h-9 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium">
                  <Code2 size={13} className="text-[hsl(var(--wb-accent))]" />
                  {hasSqlPreview
                    ? "SQL Preview"
                    : hasMongoCommandPreview
                      ? "MongoDB command preview"
                      : "Driver request"}
                </span>
                <button
                  type="button"
                  className="wb-icon-button h-6 w-6"
                  title={hasSqlPreview ? "Copy SQL" : "Copy request preview"}
                  onClick={() => void navigator.clipboard.writeText(ddl)}
                >
                  <Copy size={12} />
                </button>
              </div>
              <pre className="min-h-0 flex-1 whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))]">
                {ddl}
              </pre>
              <div className="border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
                {isCapabilitiesLoading
                  ? "Verifying the active driver package…"
                  : capabilityResolutionError
                    ? "The active driver capability contract could not be verified."
                  : driverResolutionError
                    ? "The active driver package could not be verified."
                  : canCreateNamespace
                    ? usesExternalDriverPackage
                      ? "Creation is enabled by the verified driver runtime; OxideStudio does not generate Host SQL for this package."
                      : "Creation is enabled by the active driver capability contract."
                    : "Creation is unavailable for the active driver capability contract."}
              </div>
            </section>
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:space-x-0">
            <button type="button" className="wb-text-button h-7 px-3 text-[11px]" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="wb-primary-button h-7 min-w-[96px] justify-center px-3 text-[11px]"
              disabled={isSubmitting || !databaseName.trim() || !canCreateNamespace}
              title={
                isCapabilitiesLoading
                  ? "Verifying driver capabilities"
                  : capabilityResolutionError
                    ? "The active driver capability contract could not be verified"
                  : driverResolutionError
                    ? "The active driver package could not be verified"
                  : canCreateNamespace
                    ? undefined
                    : "The active driver does not support namespace creation"
              }
            >
              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : `Create ${titleNamespaceLabel}`}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
