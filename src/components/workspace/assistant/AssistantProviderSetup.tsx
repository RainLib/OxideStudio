import { assistantProviderDefinition } from "@/ai/assistant/providerDefinitions";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { localizedCliSetupStatus } from "./assistantProviderCopy";
import type { AiCliProviderConfig } from "@/services/tauri/ai.service";
import type {
  AssistantCliSetupPhase,
  AssistantCliSetupState,
} from "@/store/useAssistantCliSetupStore";
import {
  Check,
  Copy,
  Circle,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

export type { AssistantCliSetupPhase, AssistantCliSetupState };

type AssistantProviderSetupProps = {
  provider: AiCliProviderConfig["kind"];
  state: AssistantCliSetupState;
  onInstall: () => void;
  onAuthenticate: (methodId?: string) => void;
  onCancelAuthentication: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
};

export function AssistantProviderSetup({
  provider,
  state,
  onInstall,
  onAuthenticate,
  onCancelAuthentication,
  onRetry,
  onOpenSettings,
}: AssistantProviderSetupProps) {
  const { t } = useI18n();
  const definition = assistantProviderDefinition(provider);
  const installComplete = !["checking", "missing", "installing"].includes(
    state.phase,
  );
  const authComplete = state.phase === "ready";
  const busy =
    state.phase === "checking" ||
    state.phase === "installing" ||
    state.refreshing === true;
  const primaryStatus = localizedCliSetupStatus(state, t);
  const browserUrl = safeAuthenticationUrl(state.browserUrl);
  const [linkAction, setLinkAction] = useState<"idle" | "copied" | "open-error" | "copy-error">("idle");
  useEffect(() => { setLinkAction("idle"); }, [state.browserUrl]);
  const openSignIn = () => {
    if (!browserUrl) return;
    void import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(browserUrl.href))
      .catch(() => setLinkAction("open-error"));
  };
  const copySignIn = async () => {
    if (!browserUrl) return;
    try {
      await navigator.clipboard.writeText(browserUrl.href);
      setLinkAction("copied");
    } catch { setLinkAction("copy-error"); }
  };

  return (
    <div
      className="flex min-h-full items-center justify-center px-4 py-6"
      data-assistant-cli-setup={state.phase}
    >
      <div className="w-full max-w-[350px]">
        <div className="flex items-start gap-2.5">
          <TerminalSquare
            size={18}
            className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
              {t("assistant.setup.title", { provider: definition.label })}
            </h2>
            <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
              {localizedProviderSetupDescription(provider, t)}
            </p>
          </div>
        </div>

        <ol className="mt-4 border-y border-[hsl(var(--wb-border-subtle))]">
          <SetupStep
            index={1}
            label={t("assistant.setup.installAgent")}
            detail={
              state.executablePath
                ? compactPath(state.executablePath)
                : t("assistant.setup.installDetail")
            }
            state={
              state.phase === "installing"
                ? "active"
                : installComplete
                  ? "complete"
                  : state.phase === "missing"
                    ? "action"
                    : "pending"
            }
          />
          <SetupStep
            index={2}
            label={t("assistant.setup.authorize")}
            detail={t("assistant.setup.authorizeDetail")}
            state={
              state.phase === "authorizing"
                ? "active"
                : authComplete
                  ? "complete"
                  : state.phase === "auth-required"
                    ? "action"
                    : "pending"
            }
          />
          <SetupStep
            index={3}
            label={t("assistant.setup.startSession")}
            detail={t("assistant.setup.startSessionDetail", {
              transport: definition.transport,
            })}
            state={authComplete ? "complete" : "pending"}
          />
        </ol>

        <div
          className={cn(
            "mt-3 border px-2.5 py-2 text-[10px] leading-4",
            state.phase === "error"
              ? "border-red-400/55 bg-red-500/5 text-red-300"
              : "border-[hsl(var(--wb-accent)/0.55)] bg-[hsl(var(--wb-accent)/0.05)] text-[hsl(var(--wb-text-muted))]",
          )}
          role={state.phase === "error" ? "alert" : "status"}
        >
          <p>{primaryStatus}</p>
          {state.version && (
            <span className="ml-1 font-mono text-[9px]">{state.version}</span>
          )}
          {state.message && state.message !== primaryStatus && (
            <details className="mt-1.5 text-[9px] text-current/80">
              <summary className="cursor-pointer select-none">
                {t("assistant.error.technicalDetails")}
              </summary>
              <p className="mt-1 break-words font-mono leading-4">
                {state.message}
              </p>
            </details>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {state.phase === "missing" && (
            <button
              type="button"
              className="wb-primary-button h-7 px-2.5 text-[10px]"
              onClick={onInstall}
              disabled={busy}
            >
              <PackageCheck size={11} aria-hidden="true" />
              {t("assistant.setup.install")}
            </button>
          )}
          {state.phase === "auth-required" &&
            (state.authenticationMethods?.length ? (
              <div className="grid w-full gap-1.5" role="group" aria-label="Sign-in method">
                {state.authenticationMethods.map((method, index) => (
                  <button
                    key={method.id}
                    type="button"
                    className={cn(
                      index === 0 ? "wb-primary-button" : "wb-text-button border border-[hsl(var(--wb-border-subtle))]",
                      "min-h-8 justify-start px-2.5 text-left text-[10px]",
                    )}
                    onClick={() => onAuthenticate(method.id)}
                    disabled={busy}
                    title={method.description}
                  >
                    <ExternalLink size={11} className="shrink-0" aria-hidden="true" />
                    <span>{method.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className="wb-primary-button h-7 px-2.5 text-[10px]"
                onClick={() => onAuthenticate()}
                disabled={busy || state.authMethodsLoading}
              >
                {state.authMethodsLoading ? (
                  <LoaderCircle size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <ExternalLink size={11} aria-hidden="true" />
                )}
                {state.authMethodsLoading
                  ? t("assistant.setup.loadingSignIn")
                  : t("assistant.setup.openSignIn")}
              </button>
            ))}
          {state.phase === "authorizing" && (
            <>
            {browserUrl && (
              <div className="flex w-full flex-wrap items-center gap-1.5">
                <button type="button" className="wb-primary-button h-7 px-2.5 text-[10px]" onClick={openSignIn}>
                  <ExternalLink size={11} aria-hidden="true" />
                  {t("assistant.setup.openSignIn")}
                </button>
                <button type="button" className="wb-text-button h-7 px-2 text-[10px]" onClick={() => void copySignIn()}>
                  {linkAction === "copied" ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                  {t(linkAction === "copied" ? "assistant.setup.signInLinkCopied" : "assistant.setup.copySignInLink")}
                </button>
                <span className="wb-muted text-[10px]">{browserUrl.host}</span>
                {(linkAction === "open-error" || linkAction === "copy-error") && (
                  <p className="w-full text-[10px] wb-muted" role="status">
                    {t(linkAction === "open-error" ? "assistant.setup.openSignInFailed" : "assistant.setup.copySignInFailed")}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              className="wb-text-button h-7 px-2 text-[10px]"
              onClick={onCancelAuthentication}
            >
              <Circle size={11} aria-hidden="true" />
              {t("assistant.setup.cancelSignIn")}
            </button>
            </>
          )}
          {state.phase === "error" && (
            <button
              type="button"
              className="wb-text-button h-7 px-2 text-[10px]"
              onClick={onRetry}
              disabled={busy}
            >
              <RefreshCw
                size={11}
                className={cn(
                  state.refreshing &&
                    "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden="true"
              />
              {t("assistant.setup.checkAgain")}
            </button>
          )}
          <button
            type="button"
            className="wb-text-button h-7 px-2 text-[10px]"
            onClick={onOpenSettings}
            disabled={busy}
          >
            <Settings2 size={11} aria-hidden="true" />
            {t("assistant.setup.useExisting")}
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          <ShieldCheck size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {t("assistant.setup.safety")}
          </p>
        </div>
      </div>
    </div>
  );
}

function safeAuthenticationUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function SetupStep({
  index,
  label,
  detail,
  state,
}: {
  index: number;
  label: string;
  detail: string;
  state: "pending" | "active" | "action" | "complete";
}) {
  const Icon = state === "complete" ? Check : state === "active" ? LoaderCircle : Circle;
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-2.5 last:border-b-0">
      <span className="relative flex justify-center pt-0.5">
        <Icon
          size={12}
          className={cn(
            state === "complete" || state === "action"
              ? "text-[hsl(var(--wb-accent))]"
              : "text-[hsl(var(--wb-text-muted))]",
            state === "active" && "animate-spin motion-reduce:animate-none",
          )}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--wb-text))]">
          <span className="font-mono text-[8px] text-[hsl(var(--wb-text-muted))]">
            {index.toString().padStart(2, "0")}
          </span>
          {label}
        </span>
        <span className="mt-0.5 block break-words text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {detail}
        </span>
      </span>
    </li>
  );
}

function compactPath(path: string) {
  if (path.length <= 62) return path;
  return `${path.slice(0, 24)}…${path.slice(-34)}`;
}

function localizedProviderSetupDescription(
  provider: AiCliProviderConfig["kind"],
  t: ReturnType<typeof useI18n>["t"],
) {
  return t(
    provider === "codex-cli"
      ? "assistant.setup.codexDescription"
      : "assistant.setup.codebuddyDescription",
  );
}
