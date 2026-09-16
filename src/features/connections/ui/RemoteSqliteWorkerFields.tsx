import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { RemoteSqliteDraft } from "@/features/connections/model/connectionFormTypes";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import { cn } from "@/lib/utils";
import type { RemoteSqliteSshConfig } from "@/services/tauri/types/connections";
import { Download, Loader2 } from "lucide-react";

interface RemoteSqliteWorkerFieldsProps {
  isRemoteSqlite: boolean;
  remoteSqlite: RemoteSqliteDraft;
  updateRemoteSqlite: (updates: Partial<RemoteSqliteSshConfig>) => void;
  sqliteWorkerBaseUrlInput: string;
  setSqliteWorkerBaseUrlInput: React.Dispatch<React.SetStateAction<string>>;
  saveSqliteWorkerBaseUrl: () => Promise<void>;
  isPreparingSqliteWorker: boolean;
  handlePrepareSqliteWorker: () => Promise<void>;
}

/** Signed SQLite worker placement, preparation, and upload policy for SSH files. */
export function RemoteSqliteWorkerFields({
  isRemoteSqlite,
  remoteSqlite,
  updateRemoteSqlite,
  sqliteWorkerBaseUrlInput,
  setSqliteWorkerBaseUrlInput,
  saveSqliteWorkerBaseUrl,
  isPreparingSqliteWorker,
  handlePrepareSqliteWorker,
}: RemoteSqliteWorkerFieldsProps) {
  if (!isRemoteSqlite) return null;

  return (
    <>
              <div className="col-span-2 my-2 border-t border-[hsl(var(--wb-border-subtle))]" />

              <span className={labelClass}>Worker placement</span>
              <Select
                value={remoteSqlite.placement}
                onValueChange={(placement) =>
                  updateRemoteSqlite({
                    placement: placement as typeof remoteSqlite.placement,
                  })
                }
              >
                <SelectTrigger className={fieldClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                  <SelectItem value="session">
                    Session only · remove on disconnect
                  </SelectItem>
                  <SelectItem value="persist">
                    Persistent · reuse the verified version
                  </SelectItem>
                  <SelectItem value="preplaced">
                    Preplaced · never upload
                  </SelectItem>
                </SelectContent>
              </Select>

              {remoteSqlite.placement !== "session" && (
                <>
                  <label className={labelClass} htmlFor="sqlite-worker-path">
                    Worker path
                  </label>
                  <input
                    id="sqlite-worker-path"
                    value={remoteSqlite.workerPath || ""}
                    onChange={(event) =>
                      updateRemoteSqlite({ workerPath: event.target.value })
                    }
                    className={cn(fieldClass, "font-mono text-[11px]")}
                    placeholder="/opt/oxide/oxide-sqlite-worker"
                    autoComplete="off"
                  />
                </>
              )}

              {remoteSqlite.placement !== "preplaced" && (
                <>
                  <span className={labelClass}>Worker upload</span>
                  <div className="flex min-h-7 items-center gap-2">
                    <Switch
                      checked={remoteSqlite.allowWorkerUpload}
                      onCheckedChange={(allowWorkerUpload) =>
                        updateRemoteSqlite({
                          allowWorkerUpload,
                          ...(allowWorkerUpload
                            ? {}
                            : { approvedWorkerDigest: undefined }),
                        })
                      }
                      className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                      aria-label="Allow signed SQLite worker upload"
                    />
                    <span className="text-[11px] wb-muted">
                      {remoteSqlite.approvedWorkerDigest
                        ? `Approved SHA-256 ${remoteSqlite.approvedWorkerDigest.slice(0, 12)}…`
                        : "Prepare the exact signed worker before upload"}
                    </span>
                  </div>
                </>
              )}

              <label className={labelClass} htmlFor="sqlite-worker-source">
                Worker source
              </label>
              <div className="flex min-w-0 gap-2">
                <input
                  id="sqlite-worker-source"
                  value={sqliteWorkerBaseUrlInput}
                  onChange={(event) =>
                    setSqliteWorkerBaseUrlInput(event.target.value)
                  }
                  onBlur={() => void saveSqliteWorkerBaseUrl()}
                  className={cn(fieldClass, "min-w-0 font-mono text-[11px]")}
                  placeholder="Official release source (leave blank)"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="wb-text-button h-7 shrink-0 border border-[hsl(var(--wb-border))] px-2 text-[11px]"
                  disabled={
                    isPreparingSqliteWorker ||
                    (remoteSqlite.placement !== "preplaced" &&
                      !remoteSqlite.allowWorkerUpload)
                  }
                  onClick={() => void handlePrepareSqliteWorker()}
                >
                  {isPreparingSqliteWorker ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} />
                  )}
                  {isPreparingSqliteWorker ? "Preparing…" : "Prepare"}
                </button>
              </div>
              <div />
              <p className="text-[10px] leading-4 wb-muted">
                Leave blank to use the signed source embedded in official
                OxideStudio builds. Custom sources must be credential-free
                HTTPS.
              </p>

              <div className="col-start-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2.5 py-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                OxideStudio detects Linux x64 or ARM64, verifies the signed
                manifest and binary digest locally, then checks the same digest
                on the SSH host before starting the worker over stdio. Database
                credentials are never sent to the download source.
              </div>
    </>
  );
}
