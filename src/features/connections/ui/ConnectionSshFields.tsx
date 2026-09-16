import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  ConnectionSshDraft,
  ConnectionStatus,
  RemoteSqliteDraft,
  UpdateConnectionField,
} from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { RemoteSqliteWorkerFields } from "@/features/connections/ui/RemoteSqliteWorkerFields";
import { SshJumpHostFields } from "@/features/connections/ui/SshJumpHostFields";
import {
  fieldClass,
  labelClass,
} from "@/features/connections/ui/connectionFormStyles";
import { cn } from "@/lib/utils";
import type {
  RemoteSqliteSshConfig,
  SshJumpHostConfig,
  SshTunnelConfig,
} from "@/services/tauri/types/connections";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

interface ConnectionSshFieldsProps {
  isRemoteSqlite: boolean;
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
  sshTunnel: ConnectionSshDraft;
  updateSshTunnel: (updates: Partial<SshTunnelConfig>) => void;
  remoteSqlite: RemoteSqliteDraft;
  showSshPassword: boolean;
  setShowSshPassword: React.Dispatch<React.SetStateAction<boolean>>;
  showSshPassphrase: boolean;
  setShowSshPassphrase: React.Dispatch<React.SetStateAction<boolean>>;
  addSshJumpHost: () => void;
  updateSshJumpHost: (
    index: number,
    updates: Partial<SshJumpHostConfig>,
  ) => void;
  removeSshJumpHost: (index: number) => void;
  handleTestSshTunnel: () => Promise<void>;
  status: ConnectionStatus;
  updateRemoteSqlite: (updates: Partial<RemoteSqliteSshConfig>) => void;
  sqliteWorkerBaseUrlInput: string;
  setSqliteWorkerBaseUrlInput: React.Dispatch<React.SetStateAction<string>>;
  saveSqliteWorkerBaseUrl: () => Promise<void>;
  isPreparingSqliteWorker: boolean;
  handlePrepareSqliteWorker: () => Promise<void>;
}

export function ConnectionSshFields({
  isRemoteSqlite,
  selectedConnection,
  updateField,
  sshTunnel,
  updateSshTunnel,
  remoteSqlite,
  showSshPassword,
  setShowSshPassword,
  showSshPassphrase,
  setShowSshPassphrase,
  addSshJumpHost,
  updateSshJumpHost,
  removeSshJumpHost,
  handleTestSshTunnel,
  status,
  updateRemoteSqlite,
  sqliteWorkerBaseUrlInput,
  setSqliteWorkerBaseUrlInput,
  saveSqliteWorkerBaseUrl,
  isPreparingSqliteWorker,
  handlePrepareSqliteWorker,
}: ConnectionSshFieldsProps) {
  return (
    <div className="mx-auto grid w-full max-w-[720px] grid-cols-[132px_minmax(0,1fr)] gap-y-2 px-6 py-5">
      {!isRemoteSqlite && (
        <>
          <span className={labelClass}>SSL mode</span>
          <Select
            value={selectedConnection.sslMode || "disable"}
            onValueChange={(value) => updateField("sslMode", value, true)}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
              <SelectItem value="disable">Disable</SelectItem>
              <SelectItem value="prefer">Prefer</SelectItem>
              <SelectItem value="require">Require</SelectItem>
              <SelectItem value="verify-ca">Verify CA</SelectItem>
              <SelectItem value="verify-full">Verify full</SelectItem>
            </SelectContent>
          </Select>

          <div className="col-span-2 my-2 border-t border-[hsl(var(--wb-border-subtle))]" />
        </>
      )}

      <span className={labelClass}>
        {isRemoteSqlite ? "Remote file" : "SSH tunnel"}
      </span>
      <div className="flex h-7 items-center gap-2">
        <Switch
          checked={sshTunnel.enabled}
          onCheckedChange={(enabled) =>
            updateSshTunnel({
              enabled,
              ...(isRemoteSqlite && enabled
                ? {
                    strictHostKeyChecking: true,
                    remoteSqlite,
                  }
                : {}),
            })
          }
          className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
          aria-label={
            isRemoteSqlite ? "Open SQLite through SSH" : "Enable SSH tunnel"
          }
        />
        <span className="text-[11px] wb-muted">
          {isRemoteSqlite
            ? "Open a SQLite file on a verified Linux SSH host"
            : "Forward the database connection through an SSH server"}
        </span>
      </div>

      {sshTunnel.enabled && (
        <>
          <label className={labelClass} htmlFor="ssh-host">
            SSH host
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
            <input
              id="ssh-host"
              value={sshTunnel.host}
              onChange={(event) =>
                updateSshTunnel({ host: event.target.value })
              }
              className={fieldClass}
              placeholder="bastion.example.com"
              autoComplete="off"
            />
            <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2">
              <span className="text-right text-[11px] wb-muted">Port</span>
              <input
                type="number"
                value={sshTunnel.port || ""}
                onChange={(event) =>
                  updateSshTunnel({
                    port: event.target.value ? Number(event.target.value) : 22,
                  })
                }
                className={fieldClass}
                min={1}
                max={65535}
                aria-label="SSH port"
              />
            </div>
          </div>

          <label className={labelClass} htmlFor="ssh-username">
            Username
          </label>
          <input
            id="ssh-username"
            value={sshTunnel.username}
            onChange={(event) =>
              updateSshTunnel({ username: event.target.value })
            }
            className={fieldClass}
            autoComplete="off"
          />

          <span className={labelClass}>Authentication</span>
          <Select
            value={sshTunnel.authMethod}
            onValueChange={(value) =>
              updateSshTunnel({
                authMethod: value as "password" | "privateKey",
              })
            }
          >
            <SelectTrigger
              className={fieldClass}
              aria-label="SSH authentication method"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
              <SelectItem value="password">Password</SelectItem>
              <SelectItem value="privateKey">Private key</SelectItem>
            </SelectContent>
          </Select>

          {sshTunnel.authMethod === "password" ? (
            <>
              <label className={labelClass} htmlFor="ssh-password">
                Password
              </label>
              <div className="relative">
                <input
                  id="ssh-password"
                  type={showSshPassword ? "text" : "password"}
                  value={sshTunnel.password || ""}
                  onChange={(event) =>
                    updateSshTunnel({ password: event.target.value })
                  }
                  className={cn(fieldClass, "pr-8")}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="wb-icon-button absolute right-0.5 top-0.5"
                  onClick={() => setShowSshPassword((visible) => !visible)}
                  title={
                    showSshPassword ? "Hide SSH password" : "Show SSH password"
                  }
                >
                  {showSshPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </>
          ) : (
            <>
              <label className={labelClass} htmlFor="ssh-private-key">
                Private key
              </label>
              <input
                id="ssh-private-key"
                value={sshTunnel.privateKeyPath || ""}
                onChange={(event) =>
                  updateSshTunnel({
                    privateKeyPath: event.target.value,
                  })
                }
                className={cn(fieldClass, "font-mono text-[11px]")}
                placeholder="~/.ssh/id_ed25519"
                autoComplete="off"
              />

              <label className={labelClass} htmlFor="ssh-passphrase">
                Passphrase
              </label>
              <div className="relative">
                <input
                  id="ssh-passphrase"
                  type={showSshPassphrase ? "text" : "password"}
                  value={sshTunnel.privateKeyPassphrase || ""}
                  onChange={(event) =>
                    updateSshTunnel({
                      privateKeyPassphrase: event.target.value,
                    })
                  }
                  className={cn(fieldClass, "pr-8")}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="wb-icon-button absolute right-0.5 top-0.5"
                  onClick={() => setShowSshPassphrase((visible) => !visible)}
                  title={
                    showSshPassphrase
                      ? "Hide key passphrase"
                      : "Show key passphrase"
                  }
                >
                  {showSshPassphrase ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </>
          )}

          <span className={labelClass}>Host key</span>
          <div className="flex min-h-7 items-center gap-2">
            <Switch
              checked={sshTunnel.strictHostKeyChecking}
              onCheckedChange={(strictHostKeyChecking) =>
                updateSshTunnel({ strictHostKeyChecking })
              }
              disabled={isRemoteSqlite}
              className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
              aria-label="Verify SSH host key"
            />
            <span
              className={cn(
                "text-[11px]",
                sshTunnel.strictHostKeyChecking ? "wb-muted" : "text-amber-400",
              )}
            >
              {sshTunnel.strictHostKeyChecking
                ? isRemoteSqlite
                  ? "Required · verify against ~/.ssh/known_hosts"
                  : "Verify against ~/.ssh/known_hosts"
                : "Warning: SSH host identity will not be verified"}
            </span>
          </div>

          <SshJumpHostFields
            sshTunnel={sshTunnel}
            addSshJumpHost={addSshJumpHost}
            updateSshJumpHost={updateSshJumpHost}
            removeSshJumpHost={removeSshJumpHost}
          />

          <span />
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="wb-text-button h-7 border border-[hsl(var(--wb-border))] px-3 text-[11px] text-[hsl(var(--wb-text))]"
              onClick={() => void handleTestSshTunnel()}
              disabled={status?.type === "loading"}
            >
              {status?.type === "loading" && status.scope === "ssh" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ShieldCheck size={12} />
              )}
              {status?.type === "loading" && status.scope === "ssh"
                ? "Testing SSH…"
                : "Test SSH Tunnel"}
            </button>
            <span className="text-[10px] wb-muted">
              Verifies host keys and every jump-host credential without
              contacting the database.
            </span>
          </div>

          <RemoteSqliteWorkerFields
            isRemoteSqlite={isRemoteSqlite}
            remoteSqlite={remoteSqlite}
            updateRemoteSqlite={updateRemoteSqlite}
            sqliteWorkerBaseUrlInput={sqliteWorkerBaseUrlInput}
            setSqliteWorkerBaseUrlInput={setSqliteWorkerBaseUrlInput}
            saveSqliteWorkerBaseUrl={saveSqliteWorkerBaseUrl}
            isPreparingSqliteWorker={isPreparingSqliteWorker}
            handlePrepareSqliteWorker={handlePrepareSqliteWorker}
          />
        </>
      )}
    </div>
  );
}
