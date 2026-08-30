import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DATABASE_ADMIN_AUTO_REFRESH_MS,
  supportsDatabaseAdminAutoRefresh,
  type DatabaseAdminView,
} from "@/features/database-admin/model/databaseAdminRefresh";
import {
  databaseAdminErrorPresentation,
  type DatabaseAdminErrorPresentation,
} from "@/features/database-admin/model/databaseAdminErrors";
import { databaseService } from "@/services/tauri";
import type {
  DatabaseAdminLockWait,
  DatabaseAdminMetric,
  DatabaseAdminRoleMembership,
  DatabaseAdminServerIdentity,
  DatabaseAdminTablePrivilege,
  DatabaseAdminSession,
  DatabaseAdminUser,
  DatabaseDriver,
} from "@/services/tauri/types";
import { Activity, BarChart3, Clock3, GitFork, Lock, RefreshCw, Server, Shield, Trash2, Unlock, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AccountForm = "create" | "password" | null;

interface DatabaseAdministrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  driver: DatabaseDriver;
  connectionName?: string;
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 1) return "–";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function accountLabel(user: DatabaseAdminUser) {
  return user.host ? `${user.name}@${user.host}` : user.name;
}

function isMysqlFamily(driver: DatabaseDriver) {
  return driver === "mysql" || driver === "mariadb";
}

function formatMetricValue(metric: DatabaseAdminMetric) {
  if (!metric.available || !metric.value) return "Unavailable";
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return metric.value;
  if (metric.unit === "bytes") {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = value;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[unitIndex]}`;
  }
  if (metric.unit === "%") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return value.toLocaleString();
}

export function DatabaseAdministrationDialog({
  open,
  onOpenChange,
  connectionId,
  driver,
  connectionName,
}: DatabaseAdministrationDialogProps) {
  const [view, setView] = useState<DatabaseAdminView>("sessions");
  const [sessions, setSessions] = useState<DatabaseAdminSession[]>([]);
  const [metrics, setMetrics] = useState<DatabaseAdminMetric[]>([]);
  const [lockWaits, setLockWaits] = useState<DatabaseAdminLockWait[]>([]);
  const [users, setUsers] = useState<DatabaseAdminUser[]>([]);
  const [roleMemberships, setRoleMemberships] = useState<DatabaseAdminRoleMembership[]>([]);
  const [tablePrivileges, setTablePrivileges] = useState<DatabaseAdminTablePrivilege[]>([]);
  const [serverIdentity, setServerIdentity] = useState<DatabaseAdminServerIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isIdentityLoading, setIsIdentityLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<DatabaseAdminErrorPresentation | null>(null);
  const [identityError, setIdentityError] = useState<DatabaseAdminErrorPresentation | null>(null);
  const [form, setForm] = useState<AccountForm>(null);
  const [targetUser, setTargetUser] = useState<DatabaseAdminUser | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("%");
  const [password, setPassword] = useState("");
  const [canLogin, setCanLogin] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const loadInFlightKeysRef = useRef(new Set<string>());
  const loadGenerationRef = useRef(0);
  const identityGenerationRef = useRef(0);

  const supportsAccounts = driver === "postgres" || isMysqlFamily(driver);
  const supportsLockWaits = driver === "postgres" || isMysqlFamily(driver);
  const titleSuffix = connectionName ? ` — ${connectionName}` : "";

  const resetForm = useCallback(() => {
    setForm(null);
    setTargetUser(null);
    setName("");
    setHost("%");
    setPassword("");
    setCanLogin(true);
  }, []);

  const load = useCallback(async (options: { background?: boolean } = {}) => {
    if (!connectionId || !supportsAccounts) return;
    const requestKey = `${connectionId}:${driver}:${view}`;
    if (loadInFlightKeysRef.current.has(requestKey)) return;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    loadInFlightKeysRef.current.add(requestKey);
    if (!options.background) setIsLoading(true);
    setError(null);
    try {
      if (view === "sessions") {
        const value = await databaseService.listDatabaseAdminSessions(connectionId, driver);
        if (loadGenerationRef.current === generation) setSessions(value);
      } else if (view === "metrics") {
        const value = await databaseService.listDatabaseAdminMetrics(connectionId, driver);
        if (loadGenerationRef.current === generation) setMetrics(value);
      } else if (view === "locks") {
        const value = await databaseService.listDatabaseAdminLockWaits(connectionId, driver);
        if (loadGenerationRef.current === generation) setLockWaits(value);
      } else if (view === "roles") {
        const value = await databaseService.listDatabaseAdminRoleMemberships(connectionId, driver);
        if (loadGenerationRef.current === generation) setRoleMemberships(value);
      } else if (view === "privileges") {
        const value = await databaseService.listDatabaseAdminTablePrivileges(connectionId, driver);
        if (loadGenerationRef.current === generation) setTablePrivileges(value);
      } else {
        const value = await databaseService.listDatabaseAdminUsers(connectionId, driver);
        if (loadGenerationRef.current === generation) setUsers(value);
      }
    } catch (reason) {
      if (loadGenerationRef.current === generation) {
        setError(databaseAdminErrorPresentation(reason));
      }
    } finally {
      loadInFlightKeysRef.current.delete(requestKey);
      if (!options.background && loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [connectionId, driver, supportsAccounts, view]);

  const loadServerIdentity = useCallback(async () => {
    const generation = identityGenerationRef.current + 1;
    identityGenerationRef.current = generation;
    setServerIdentity(null);
    setIdentityError(null);
    const canLoadIdentity = Boolean(connectionId && supportsAccounts);
    setIsIdentityLoading(canLoadIdentity);
    if (!connectionId || !canLoadIdentity) return;
    try {
      const identity = await databaseService.getDatabaseAdminServerIdentity(
        connectionId,
        driver,
      );
      if (identityGenerationRef.current === generation) {
        setServerIdentity(identity);
      }
    } catch (reason) {
      if (identityGenerationRef.current === generation) {
        setIdentityError(databaseAdminErrorPresentation(reason));
      }
    } finally {
      if (identityGenerationRef.current === generation) {
        setIsIdentityLoading(false);
      }
    }
  }, [connectionId, driver, supportsAccounts]);

  useEffect(() => {
    if (!supportsLockWaits && view === "locks") setView("sessions");
  }, [supportsLockWaits, view]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  useEffect(() => {
    if (open) void loadServerIdentity();
    return () => {
      identityGenerationRef.current += 1;
    };
  }, [loadServerIdentity, open]);

  useEffect(() => {
    if (
      !open ||
      !autoRefresh ||
      isMutating ||
      !supportsDatabaseAdminAutoRefresh(view)
    ) {
      return;
    }
    const refreshVisibleView = () => {
      if (document.visibilityState === "visible") {
        void load({ background: true });
      }
    };
    const interval = window.setInterval(
      refreshVisibleView,
      DATABASE_ADMIN_AUTO_REFRESH_MS,
    );
    document.addEventListener("visibilitychange", refreshVisibleView);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisibleView);
    };
  }, [autoRefresh, isMutating, load, open, view]);

  const selectedTargetLabel = useMemo(
    () => (targetUser ? accountLabel(targetUser) : ""),
    [targetUser],
  );

  const runMutation = useCallback(
    async (task: () => Promise<string>, reload: DatabaseAdminView) => {
      setIsMutating(true);
      setError(null);
      try {
        await task();
        resetForm();
        if (view !== reload) setView(reload);
        else await load();
      } catch (reason) {
        setError(databaseAdminErrorPresentation(reason));
      } finally {
        setIsMutating(false);
      }
    },
    [load, resetForm, view],
  );

  const openCreate = () => {
    resetForm();
    setForm("create");
  };

  const openPassword = (user: DatabaseAdminUser) => {
    resetForm();
    setTargetUser(user);
    setName(user.name);
    setHost(user.host || "%");
    setForm("password");
  };

  const handleTerminate = (session: DatabaseAdminSession) => {
    if (!connectionId) return;
    if (!window.confirm(`Terminate session ${session.id}? This cannot be undone.`)) return;
    void runMutation(
      () => databaseService.terminateDatabaseAdminSession(connectionId, driver, session.id, true),
      "sessions",
    );
  };

  const handleDeleteUser = (user: DatabaseAdminUser) => {
    if (!connectionId) return;
    const label = accountLabel(user);
    if (!window.confirm(`Delete database account ${label}? This cannot be undone.`)) return;
    void runMutation(
      () => databaseService.deleteDatabaseAdminUser(connectionId, driver, {
        name: user.name,
        host: user.host || undefined,
        confirmed: true,
      }),
      "users",
    );
  };

  const handleLogin = (user: DatabaseAdminUser, nextCanLogin: boolean) => {
    if (!connectionId) return;
    const actionLabel = nextCanLogin ? "Unlock" : "Lock";
    if (!window.confirm(`${actionLabel} ${accountLabel(user)}?`)) return;
    void runMutation(
      () => databaseService.setDatabaseAdminUserLogin(connectionId, driver, {
        name: user.name,
        host: user.host || undefined,
        canLogin: nextCanLogin,
        confirmed: true,
      }),
      "users",
    );
  };

  const submitAccountForm = () => {
    if (!connectionId || !form) return;
    if (form === "create") {
      void runMutation(
        () => databaseService.createDatabaseAdminUser(connectionId, driver, {
          name,
          host: isMysqlFamily(driver) ? host : undefined,
          password: password || undefined,
          canLogin,
          confirmed: true,
        }),
        "users",
      );
      return;
    }
    void runMutation(
      () => databaseService.updateDatabaseAdminUserPassword(connectionId, driver, {
        name,
        host: isMysqlFamily(driver) ? host : undefined,
        password,
        confirmed: true,
      }),
      "users",
    );
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) resetForm();
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="flex h-[min(720px,80vh)] max-w-[780px] flex-col overflow-hidden border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <DialogTitle className="text-[13px]">Database Administration{titleSuffix}</DialogTitle>
          <DialogDescription className="text-[11px] wb-muted">
            Metrics, sessions and accounts use fixed, driver-aware actions. Password values are never stored by this panel.
          </DialogDescription>
          {isIdentityLoading ? (
            <div className="flex items-center gap-1.5 pt-1 text-[10px] wb-muted">
              <RefreshCw size={11} className="animate-spin" /> Confirming live server identity…
            </div>
          ) : serverIdentity ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] wb-muted">
              <span className="flex items-center gap-1 text-[hsl(var(--wb-text))]">
                <Server size={11} /> {serverIdentity.driver}
              </span>
              {serverIdentity.database && <span>Database: {serverIdentity.database}</span>}
              {serverIdentity.account && <span>Account: {serverIdentity.account}</span>}
              {serverIdentity.serverVersion && <span>Server: {serverIdentity.serverVersion}</span>}
            </div>
          ) : identityError ? (
            <button
              type="button"
              className="flex items-center gap-1.5 pt-1 text-left text-[10px] text-amber-300"
              onClick={() => void loadServerIdentity()}
            >
              <Server size={11} /> {identityError.title}. Select to check again.
            </button>
          ) : null}
        </DialogHeader>

        {!supportsAccounts || !connectionId ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[12px] wb-muted">
            Connect to a PostgreSQL or MySQL/MariaDB data source to manage sessions and database accounts.
          </div>
        ) : form ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              submitAccountForm();
            }}
          >
            <div className="flex items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1.5 text-[11px] wb-muted">
              <Users size={13} />
              {form === "create" ? "Create database account" : `Change password for ${selectedTargetLabel}`}
            </div>
            <div className="grid gap-3 overflow-auto px-4 py-4 text-[12px] sm:grid-cols-[110px_minmax(0,1fr)]">
              <label className="sm:pt-1.5">User name</label>
              <input
                autoFocus
                className="wb-input h-8 min-w-0"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={form === "password" || isMutating}
              />
              {isMysqlFamily(driver) && (
                <>
                  <label className="sm:pt-1.5">Host</label>
                  <input
                    className="wb-input h-8 min-w-0"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                    disabled={form === "password" || isMutating}
                  />
                </>
              )}
              <label className="sm:pt-1.5">Password</label>
              <input
                className="wb-input h-8 min-w-0"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isMutating}
              />
              {form === "create" && (
                <>
                  <label className="sm:pt-1.5">Login</label>
                  <label className="flex h-8 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={canLogin}
                      onChange={(event) => setCanLogin(event.target.checked)}
                      disabled={isMutating}
                    />
                    <span className="wb-muted">Allow this account to sign in</span>
                  </label>
                </>
              )}
            </div>
            <DialogFooter className="mt-auto border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={resetForm} disabled={isMutating}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!name.trim() || !password || isMutating}>
                {isMutating ? "Applying…" : form === "create" ? "Create account" : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-2">
              <button
                type="button"
                className={cn("wb-toolbar-button h-7 gap-1.5 px-2 text-[11px]", view === "sessions" && "wb-toolbar-button-active")}
                onClick={() => setView("sessions")}
              >
                <Activity size={13} /> Sessions
              </button>
              <button
                type="button"
                className={cn("wb-toolbar-button h-7 gap-1.5 px-2 text-[11px]", view === "metrics" && "wb-toolbar-button-active")}
                onClick={() => setView("metrics")}
              >
                <BarChart3 size={13} /> Metrics
              </button>
              {supportsLockWaits && (
                <button
                  type="button"
                  className={cn("wb-toolbar-button h-7 gap-1.5 px-2 text-[11px]", view === "locks" && "wb-toolbar-button-active")}
                  onClick={() => setView("locks")}
                >
                  <GitFork size={13} /> Locks
                </button>
              )}
              <button
                type="button"
                className={cn("wb-toolbar-button h-7 gap-1.5 px-2 text-[11px]", view === "users" && "wb-toolbar-button-active")}
                onClick={() => setView("users")}
              >
                <Users size={13} /> Users
              </button>
              <button
                type="button"
                className={cn("wb-toolbar-button h-7 gap-1.5 px-2 text-[11px]", view === "roles" && "wb-toolbar-button-active")}
                onClick={() => setView("roles")}
              >
                <GitFork size={13} /> Roles
              </button>
              <button
                type="button"
                className={cn("wb-toolbar-button h-7 gap-1.5 px-2 text-[11px]", view === "privileges" && "wb-toolbar-button-active")}
                onClick={() => setView("privileges")}
              >
                <Shield size={13} /> Privileges
              </button>
              <div className="flex-1" />
              {view === "users" && (
                <button type="button" className="wb-icon-button h-6 w-6" title="Create account" onClick={openCreate}>
                  <UserPlus size={13} />
                </button>
              )}
              {supportsDatabaseAdminAutoRefresh(view) && (
                <button
                  type="button"
                  className={cn(
                    "wb-toolbar-button h-6 gap-1 px-1.5 text-[10px]",
                    autoRefresh && "wb-toolbar-button-active",
                  )}
                  title="Refresh this live view every 10 seconds while the window is visible"
                  aria-pressed={autoRefresh}
                  onClick={() => setAutoRefresh((current) => !current)}
                  disabled={isMutating}
                >
                  <Clock3 size={11} /> Auto
                </button>
              )}
              <button type="button" className="wb-icon-button h-6 w-6" title="Refresh" onClick={() => void load()} disabled={isLoading || isMutating}>
                <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
              </button>
            </div>
            {error && (
              <div className="flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{error.title}</div>
                  <div className="mt-0.5 text-red-200/80">{error.message}</div>
                  {error.guidance && <div className="mt-0.5 text-red-200/70">{error.guidance}</div>}
                </div>
                {error.retryable && (
                  <button
                    type="button"
                    className="wb-toolbar-button h-6 shrink-0 px-2 text-[10px]"
                    onClick={() => void load()}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {isLoading ? (
                <div className="px-3 py-3 text-[11px] wb-muted">Loading…</div>
              ) : view === "sessions" ? (
                sessions.length === 0 ? <EmptyState label="No other active sessions" /> : <SessionRows sessions={sessions} onTerminate={handleTerminate} disabled={isMutating} />
              ) : view === "metrics" ? (
                metrics.length === 0 ? <EmptyState label="No read-only server metrics returned" /> : <MetricCards metrics={metrics} />
              ) : view === "locks" ? (
                lockWaits.length === 0 ? <EmptyState label="No visible blocking lock waits" /> : <LockWaitRows waits={lockWaits} />
              ) : view === "roles" ? (
                roleMemberships.length === 0 ? <EmptyState label="No visible role memberships" /> : <RoleMembershipRows memberships={roleMemberships} />
              ) : view === "privileges" ? (
                tablePrivileges.length === 0 ? <EmptyState label="No visible table privileges" /> : <TablePrivilegeRows privileges={tablePrivileges} />
              ) : (
                users.length === 0 ? <EmptyState label="No database accounts returned" /> : <UserRows users={users} onPassword={openPassword} onLogin={handleLogin} onDelete={handleDeleteUser} disabled={isMutating} />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LockWaitRows({ waits }: { waits: DatabaseAdminLockWait[] }) {
  return (
    <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
      {waits.map((wait) => (
        <div key={`${wait.waitingSessionId}:${wait.blockingSessionId}`} className="flex min-w-0 items-start gap-2 px-3 py-2 text-[11px]">
          <GitFork size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[hsl(var(--wb-text))]">
              {wait.waitingSessionId} waiting for {wait.blockingSessionId}
            </div>
            <div className="mt-0.5 truncate text-[10px] wb-muted">
              {[wait.waitingUser && `waiting: ${wait.waitingUser}`, wait.blockingUser && `blocking: ${wait.blockingUser}`, wait.database, wait.wait].filter(Boolean).join(" · ") || "Visible database blocking edge"}
            </div>
          </div>
          <span className="shrink-0 wb-muted">{formatDuration(wait.durationSeconds)}</span>
        </div>
      ))}
    </div>
  );
}

function RoleMembershipRows({ memberships }: { memberships: DatabaseAdminRoleMembership[] }) {
  return (
    <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
      {memberships.map((membership) => (
        <div key={`${membership.role}:${membership.member}`} className="flex min-w-0 items-center gap-2 px-3 py-2 text-[11px]">
          <GitFork size={13} className="shrink-0 text-[hsl(var(--wb-accent))]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[hsl(var(--wb-text))]">{membership.role}</span>
          <span className="wb-muted">member</span>
          <span className="min-w-0 flex-1 truncate text-right wb-muted">{membership.member}</span>
        </div>
      ))}
    </div>
  );
}

function TablePrivilegeRows({ privileges }: { privileges: DatabaseAdminTablePrivilege[] }) {
  return (
    <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
      {privileges.map((privilege) => (
        <div key={`${privilege.grantee}:${privilege.schema}:${privilege.table}:${privilege.privilege}`} className="flex min-w-0 items-center gap-2 px-3 py-2 text-[11px]">
          <Shield size={13} className="shrink-0 text-emerald-400/80" />
          <div className="min-w-0 flex-1"><div className="truncate font-medium text-[hsl(var(--wb-text))]">{privilege.schema}.{privilege.table}</div><div className="truncate text-[10px] wb-muted">{privilege.grantee}</div></div>
          <span className="shrink-0 rounded border border-[hsl(var(--wb-border-subtle))] px-1.5 py-0.5 text-[10px] wb-muted">{privilege.privilege}</span>
        </div>
      ))}
    </div>
  );
}

function MetricCards({ metrics }: { metrics: DatabaseAdminMetric[] }) {
  return (
    <div className="grid gap-px bg-[hsl(var(--wb-border-subtle))] sm:grid-cols-2">
      {metrics.map((metric) => (
        <div key={metric.key} className="min-w-0 bg-[hsl(var(--wb-panel))] px-3 py-3">
          <div className="text-[10px] wb-muted">{metric.label}</div>
          <div className={cn("mt-1 truncate text-[16px] font-medium", !metric.available && "wb-muted")} title={metric.value || "Unavailable"}>
            {formatMetricValue(metric)}
          </div>
          {metric.description && <div className="mt-1 text-[10px] leading-4 wb-muted">{metric.description}</div>}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="px-3 py-4 text-[11px] italic wb-muted">{label}</div>;
}

function SessionRows({ sessions, onTerminate, disabled }: { sessions: DatabaseAdminSession[]; onTerminate: (session: DatabaseAdminSession) => void; disabled: boolean }) {
  return (
    <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
      {sessions.map((session) => (
        <div key={session.id} className="group flex min-w-0 items-start gap-2 px-3 py-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
          <Activity size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2"><span className="font-medium text-[hsl(var(--wb-text))]">{session.id}</span><span className="truncate wb-muted">{[session.user, session.database, session.state].filter(Boolean).join(" · ") || "Unknown session"}</span></div>
            {session.statement && <div className="mt-0.5 truncate font-mono text-[10px] wb-muted" title={session.statement}>{session.statement}</div>}
          </div>
          <span className="shrink-0 wb-muted">{formatDuration(session.durationSeconds)}</span>
          <button type="button" className="wb-icon-button h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" title="Terminate session" onClick={() => onTerminate(session)} disabled={disabled}><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function UserRows({ users, onPassword, onLogin, onDelete, disabled }: { users: DatabaseAdminUser[]; onPassword: (user: DatabaseAdminUser) => void; onLogin: (user: DatabaseAdminUser, enabled: boolean) => void; onDelete: (user: DatabaseAdminUser) => void; disabled: boolean }) {
  return (
    <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
      {users.map((user) => {
        const enabled = user.canLogin !== false;
        return <div key={accountLabel(user)} className="group flex min-w-0 items-center gap-2 px-3 py-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
          <Shield size={13} className={cn("shrink-0", user.isSuperuser ? "text-amber-400" : "wb-muted")} />
          <div className="min-w-0 flex-1"><div className="truncate font-medium text-[hsl(var(--wb-text))]">{accountLabel(user)}</div><div className="truncate text-[10px] wb-muted">{user.isSuperuser ? "Superuser" : enabled ? "Login enabled" : "Login disabled"}{user.authenticationPlugin ? ` · ${user.authenticationPlugin}` : ""}</div></div>
          <button type="button" className="wb-icon-button h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" title="Change password" onClick={() => onPassword(user)} disabled={disabled}><Lock size={11} /></button>
          <button type="button" className="wb-icon-button h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" title={enabled ? "Disable login" : "Enable login"} onClick={() => onLogin(user, !enabled)} disabled={disabled}>{enabled ? <Lock size={11} /> : <Unlock size={11} />}</button>
          <button type="button" className="wb-icon-button h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" title="Delete account" onClick={() => onDelete(user)} disabled={disabled}><Trash2 size={11} /></button>
        </div>;
      })}
    </div>
  );
}
