import { useEffect, useState, type FormEvent } from "react";
import {
  Building2,
  Check,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  ServerCog,
  UserRound,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEnterpriseAccountStore } from "@/store/useEnterpriseAccountStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useI18n } from "@/i18n";
import { enterpriseService } from "@/services/tauri/enterprise.service";

export function EnterpriseAccountMenu() {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [controlPlaneUrl, setControlPlaneUrl] = useState("");
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("oxide-studio-desktop");
  const [gatewayCaCertificatePath, setGatewayCaCertificatePath] = useState("");
  const [gatewayClientCertificatePath, setGatewayClientCertificatePath] =
    useState("");
  const [gatewayClientPrivateKeyPath, setGatewayClientPrivateKeyPath] =
    useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const {
    status,
    isRestoring,
    isSigningIn,
    isSyncing,
    error,
    restore,
    configure,
    signIn,
    sync,
    signOut,
  } = useEnterpriseAccountStore();
  const reconcileManagedProjects = useProjectStore(
    (state) => state.reconcileManagedProjects,
  );
  const busy = isRestoring || isSigningIn || isSyncing;
  const authenticated = status.state === "authenticated";

  useEffect(() => {
    let disposed = false;
    const restoreAccount = () => {
      if (disposed) return;
      void restore()
        .then(() => reconcileManagedProjects())
        .catch(() => {
          // Account/network failures remain isolated from the local workspace.
        });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(restoreAccount, {
        timeout: 4_000,
      });
      return () => {
        disposed = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    const handle = window.setTimeout(restoreAccount, 2_000);
    return () => {
      disposed = true;
      window.clearTimeout(handle);
    };
  }, [reconcileManagedProjects, restore]);

  const runAccountAction = async (
    action: () => Promise<unknown>,
    close = false,
  ) => {
    try {
      await action();
      reconcileManagedProjects();
      if (close) completeAccountChoice();
    } catch {
      // The store owns the user-facing error.
    }
  };

  const completeAccountChoice = () => {
    setMenuOpen(false);
  };

  const saveConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await configure({
        controlPlaneUrl,
        oidcIssuer,
        oidcClientId,
        gatewayCaCertificatePath: gatewayCaCertificatePath || null,
        gatewayClientCertificatePath: gatewayClientCertificatePath || null,
        gatewayClientPrivateKeyPath: gatewayClientPrivateKeyPath || null,
      });
      setConfigurationOpen(false);
      await runAccountAction(signIn, true);
    } catch (configurationError) {
      setFormError(
        configurationError instanceof Error
          ? configurationError.message
          : String(configurationError),
      );
    }
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="wb-icon-button relative"
            title={
              authenticated
                ? status.user?.displayName || "Oxide account"
                : t("account.title")
            }
            aria-label={
              authenticated
                ? `Account: ${status.user?.displayName || "signed in"}`
                : t("account.title")
            }
          >
            {busy ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <UserRound size={14} />
            )}
            {authenticated && (
              <span
                aria-hidden="true"
                className="absolute right-[2px] top-[2px] h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_1px_hsl(var(--wb-titlebar))]"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[286px] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_18px_44px_rgba(0,0,0,0.46)]"
        >
          <div className="px-2 py-2">
            <div className="truncate text-[12px] font-semibold">
              {authenticated
                ? status.user?.displayName || "Oxide account"
                : t("account.localMode")}
            </div>
            <div className="mt-0.5 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
              {authenticated
                ? t("account.managedProjectCount", {
                    count: status.managedProjects.length,
                  })
                : t("account.localModeHint")}
            </div>
            {authenticated && (
              <div className="mt-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                Managed sources use the policy-enforcing Gateway; database
                credentials never enter this client.
              </div>
            )}
          </div>

          {authenticated && status.memberships.length > 0 && (
            <>
              <div className="h-px bg-[hsl(var(--wb-border-subtle))]" />
              <div className="px-2 py-1.5">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                  {t("account.organizations")}
                </div>
                {status.memberships.map((membership) => (
                  <div
                    key={membership.organization.id}
                    className="flex min-h-6 items-center gap-2"
                  >
                    <Building2
                      size={12}
                      className="shrink-0 text-[hsl(var(--wb-text-muted))]"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {membership.organization.displayName}
                    </span>
                    <span className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                      {membership.organizationRole}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {(error || status.syncError) && (
            <div className="mx-1 mb-1 border-l-2 border-[hsl(var(--destructive))] px-2 py-1.5 text-[10px] leading-4 text-[hsl(var(--destructive))]">
              {error || status.syncError}
            </div>
          )}

          <div className="h-px bg-[hsl(var(--wb-border-subtle))]" />
          {authenticated ? (
            <>
              <AccountMenuAction
                icon={RefreshCw}
                label={isSyncing ? t("account.syncing") : t("account.sync")}
                disabled={busy}
                spinning={isSyncing}
                onClick={() => void runAccountAction(sync)}
              />
              <AccountMenuAction
                icon={LogOut}
                label={t("account.signOut")}
                disabled={busy}
                onClick={() => void runAccountAction(signOut, true)}
              />
            </>
          ) : (
            <>
              {status.configured && (
                <AccountMenuAction
                  icon={LogIn}
                  label={
                    isSigningIn
                      ? t("account.openingBrowser")
                      : t("account.signIn")
                  }
                  disabled={busy}
                  spinning={isSigningIn}
                  onClick={() => void runAccountAction(signIn, true)}
                />
              )}
              <AccountMenuAction
                icon={ServerCog}
                label={
                  status.configured
                    ? t("account.changeService")
                    : t("account.configure")
                }
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  void enterpriseService
                    .getPublicConfig()
                    .then((config) => {
                      if (!config) return;
                      setControlPlaneUrl(config.controlPlaneUrl);
                      setOidcIssuer(config.oidcIssuer);
                      setOidcClientId(config.oidcClientId);
                      setGatewayCaCertificatePath(
                        config.gatewayCaCertificatePath || "",
                      );
                      setGatewayClientCertificatePath(
                        config.gatewayClientCertificatePath || "",
                      );
                      setGatewayClientPrivateKeyPath(
                        config.gatewayClientPrivateKeyPath || "",
                      );
                    })
                    .catch(() => {
                      // The existing account error remains visible in the menu.
                    });
                  setConfigurationOpen(true);
                }}
              />
            </>
          )}
        </PopoverContent>
      </Popover>

      <Dialog
        open={configurationOpen}
        onOpenChange={setConfigurationOpen}
      >
        <DialogContent className="w-[520px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
          <form onSubmit={saveConfiguration}>
            <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3 text-left">
              <DialogTitle className="text-[13px]">
                {t("account.dialogTitle")}
              </DialogTitle>
              <DialogDescription className="text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {t("account.dialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-4 py-4">
              <AccountField
                label={t("account.controlPlaneUrl")}
                value={controlPlaneUrl}
                placeholder="https://oxide.example.com"
                onChange={setControlPlaneUrl}
              />
              <AccountField
                label={t("account.oidcIssuer")}
                value={oidcIssuer}
                placeholder="https://identity.example.com/realms/company"
                onChange={setOidcIssuer}
              />
              <AccountField
                label={t("account.oidcClientId")}
                value={oidcClientId}
                placeholder="oxide-studio-desktop"
                onChange={setOidcClientId}
              />
              <details className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))]">
                <summary className="cursor-pointer px-2 py-1.5 text-[11px] text-[hsl(var(--wb-text-muted))]">
                  {t("account.gatewayEnrollment")}
                </summary>
                <div className="space-y-3 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-3">
                  <p className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                    {t("account.gatewayEnrollmentHint")}
                  </p>
                  <AccountField
                    label={t("account.gatewayCa")}
                    value={gatewayCaCertificatePath}
                    placeholder="/managed/oxide/gateway-ca.pem"
                    onChange={setGatewayCaCertificatePath}
                  />
                  <AccountField
                    label={t("account.gatewayCertificate")}
                    value={gatewayClientCertificatePath}
                    placeholder="/managed/oxide/device.crt"
                    onChange={setGatewayClientCertificatePath}
                  />
                  <AccountField
                    label={t("account.gatewayPrivateKey")}
                    value={gatewayClientPrivateKeyPath}
                    placeholder="/managed/oxide/device.key"
                    onChange={setGatewayClientPrivateKeyPath}
                  />
                </div>
              </details>
              {formError && (
                <div className="border-l-2 border-[hsl(var(--destructive))] px-2 text-[11px] leading-4 text-[hsl(var(--destructive))]">
                  {formError}
                </div>
              )}
            </div>
            <DialogFooter className="flex-row justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:space-x-0">
              <button
                type="button"
                className="wb-text-button h-7 px-3"
                disabled={isSigningIn}
                onClick={() => setConfigurationOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-[hsl(var(--wb-accent))] px-3 text-[12px] font-medium text-[hsl(var(--wb-accent-foreground))] disabled:opacity-55"
                disabled={
                  isSigningIn ||
                  !controlPlaneUrl.trim() ||
                  !oidcIssuer.trim() ||
                  !oidcClientId.trim()
                }
              >
                {isSigningIn ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                {t("account.saveAndSignIn")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AccountMenuAction({
  icon: Icon,
  label,
  disabled,
  spinning,
  onClick,
}: {
  icon: typeof LogIn;
  label: string;
  disabled?: boolean;
  spinning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon
        size={13}
        className={`text-[hsl(var(--wb-text-muted))] ${spinning ? "animate-spin" : ""}`}
      />
      <span>{label}</span>
    </button>
  );
}

function AccountField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = `enterprise-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="text-[11px] font-medium text-[hsl(var(--wb-text-muted))]">
        {label}
      </span>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] outline-none focus:border-[hsl(var(--wb-accent))] focus:ring-1 focus:ring-[hsl(var(--wb-accent)/0.35)]"
      />
    </label>
  );
}
