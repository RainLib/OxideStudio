import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ConnectionSshDraft } from "@/features/connections/model/connectionFormTypes";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import { cn } from "@/lib/utils";
import type { SshJumpHostConfig } from "@/services/tauri/types/connections";

interface SshJumpHostFieldsProps {
  sshTunnel: ConnectionSshDraft;
  addSshJumpHost: () => void;
  updateSshJumpHost: (
    index: number,
    updates: Partial<SshJumpHostConfig>,
  ) => void;
  removeSshJumpHost: (index: number) => void;
}

/** Ordered jump-host route with independent credentials and host-key policy per hop. */
export function SshJumpHostFields({
  sshTunnel,
  addSshJumpHost,
  updateSshJumpHost,
  removeSshJumpHost,
}: SshJumpHostFieldsProps) {
  return (
    <>
          <span className={labelClass}>Route</span>
          <div className="min-w-0 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] wb-muted">
                {sshTunnel.jumpHosts?.length
                  ? `Primary SSH host + ${sshTunnel.jumpHosts.length} jump ${sshTunnel.jumpHosts.length === 1 ? "host" : "hosts"}`
                  : "Directly through the primary SSH host"}
              </span>
              <button
                type="button"
                className="wb-text-button h-6 px-2 text-[10px]"
                onClick={addSshJumpHost}
                disabled={(sshTunnel.jumpHosts?.length || 0) >= 3}
              >
                Add jump host
              </button>
            </div>
            {sshTunnel.jumpHosts && sshTunnel.jumpHosts.length > 0 && (
              <div className="mt-2 space-y-2 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                {sshTunnel.jumpHosts.map((hop, index) => (
                  <details
                    key={`${index}-${hop.host}`}
                    className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]"
                    open
                  >
                    <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] text-[hsl(var(--wb-text))]">
                      <span className="min-w-0 flex-1 truncate">
                        Hop {index + 2} · {hop.username || "user"}@
                        {hop.host || "host"}:{hop.port || 22}
                      </span>
                    </summary>
                    <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-2">
                      <label
                        className="text-right text-[10px] wb-muted"
                        htmlFor={`ssh-hop-host-${index}`}
                      >
                        Host
                      </label>
                      <div className="grid grid-cols-[minmax(0,1fr)_74px] gap-1">
                        <input
                          id={`ssh-hop-host-${index}`}
                          value={hop.host}
                          onChange={(event) =>
                            updateSshJumpHost(index, {
                              host: event.target.value,
                            })
                          }
                          className={fieldClass}
                          placeholder="bastion.internal"
                          autoComplete="off"
                        />
                        <input
                          type="number"
                          value={hop.port || ""}
                          onChange={(event) =>
                            updateSshJumpHost(index, {
                              port: event.target.value
                                ? Number(event.target.value)
                                : 22,
                            })
                          }
                          className={fieldClass}
                          min={1}
                          max={65535}
                          aria-label={`SSH hop ${index + 2} port`}
                        />
                      </div>
                      <label
                        className="text-right text-[10px] wb-muted"
                        htmlFor={`ssh-hop-user-${index}`}
                      >
                        Username
                      </label>
                      <input
                        id={`ssh-hop-user-${index}`}
                        value={hop.username}
                        onChange={(event) =>
                          updateSshJumpHost(index, {
                            username: event.target.value,
                          })
                        }
                        className={fieldClass}
                        autoComplete="off"
                      />
                      <label className="text-right text-[10px] wb-muted">
                        Authentication
                      </label>
                      <Select
                        value={hop.authMethod}
                        onValueChange={(value) =>
                          updateSshJumpHost(index, {
                            authMethod: value as "password" | "privateKey",
                          })
                        }
                      >
                        <SelectTrigger
                          className={fieldClass}
                          aria-label={`SSH hop ${index + 2} authentication method`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="">
                          <SelectItem value="password">Password</SelectItem>
                          <SelectItem value="privateKey">
                            Private key
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {hop.authMethod === "password" ? (
                        <>
                          <label
                            className="text-right text-[10px] wb-muted"
                            htmlFor={`ssh-hop-password-${index}`}
                          >
                            Password
                          </label>
                          <input
                            id={`ssh-hop-password-${index}`}
                            type="password"
                            value={hop.password || ""}
                            onChange={(event) =>
                              updateSshJumpHost(index, {
                                password: event.target.value,
                              })
                            }
                            className={fieldClass}
                            autoComplete="off"
                          />
                        </>
                      ) : (
                        <>
                          <label
                            className="text-right text-[10px] wb-muted"
                            htmlFor={`ssh-hop-key-${index}`}
                          >
                            Private key
                          </label>
                          <input
                            id={`ssh-hop-key-${index}`}
                            value={hop.privateKeyPath || ""}
                            onChange={(event) =>
                              updateSshJumpHost(index, {
                                privateKeyPath: event.target.value,
                              })
                            }
                            className={cn(fieldClass, "font-mono text-[11px]")}
                            placeholder="~/.ssh/id_ed25519"
                            autoComplete="off"
                          />
                          <label
                            className="text-right text-[10px] wb-muted"
                            htmlFor={`ssh-hop-passphrase-${index}`}
                          >
                            Passphrase
                          </label>
                          <input
                            id={`ssh-hop-passphrase-${index}`}
                            type="password"
                            value={hop.privateKeyPassphrase || ""}
                            onChange={(event) =>
                              updateSshJumpHost(index, {
                                privateKeyPassphrase: event.target.value,
                              })
                            }
                            className={fieldClass}
                            autoComplete="off"
                          />
                        </>
                      )}
                      <label className="text-right text-[10px] wb-muted">
                        Host key
                      </label>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={hop.strictHostKeyChecking}
                          onCheckedChange={(strictHostKeyChecking) =>
                            updateSshJumpHost(index, { strictHostKeyChecking })
                          }
                          className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                          aria-label={`Verify SSH host key for hop ${index + 2}`}
                        />
                        <span
                          className={cn(
                            "text-[10px]",
                            hop.strictHostKeyChecking
                              ? "wb-muted"
                              : "text-amber-400",
                          )}
                        >
                          {hop.strictHostKeyChecking
                            ? "Verify known_hosts"
                            : "Host identity unverified"}
                        </span>
                      </div>
                      <span />
                      <div>
                        <button
                          type="button"
                          className="wb-text-button h-6 px-2 text-[10px] text-red-300"
                          onClick={() => removeSshJumpHost(index)}
                        >
                          Remove hop
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
    </>
  );
}
