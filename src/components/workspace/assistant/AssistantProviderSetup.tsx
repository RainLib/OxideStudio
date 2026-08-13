import { assistantProviderDefinition } from "@/ai/assistant/providerDefinitions";
import { cn } from "@/lib/utils";
import type { AiCliProviderConfig } from "@/services/tauri/ai.service";
import type {
  AssistantCliSetupPhase,
  AssistantCliSetupState,
} from "@/store/useAssistantCliSetupStore";
import {
  Check,
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
  const definition = assistantProviderDefinition(provider);
  const installComplete = !["checking", "missing", "installing"].includes(
    state.phase,
  );
  const authComplete = state.phase === "ready";
  const busy =
    state.phase === "checking" ||
    state.phase === "installing" ||
    state.refreshing === true;

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
              Set up {definition.label}
            </h2>
            <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
              {definition.setupDescription}
            </p>
          </div>
        </div>

        <ol className="mt-4 border-y border-[hsl(var(--wb-border-subtle))]">
          <SetupStep
            index={1}
            label="Install agent"
            detail={
              state.executablePath
                ? compactPath(state.executablePath)
                : "Stored under OxideStudio application data; no global install required."
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
            label="Authorize account"
            detail="OxideStudio opens the provider's secure browser flow and waits for the CLI to confirm the returned account. Credentials are never copied into the app."
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
            label="Start provider session"
            detail={`Uses ${definition.transport} with an independent conversation and Oxide approval scope.`}
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
          {state.message}
          {state.version && (
            <span className="ml-1 font-mono text-[9px]">{state.version}</span>
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
              Install for OxideStudio
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
                {state.authMethodsLoading ? "Loading sign-in options" : "Open sign-in"}
              </button>
            ))}
          {state.phase === "authorizing" && (
            <button
              type="button"
              className="wb-text-button h-7 px-2 text-[10px]"
              onClick={onCancelAuthentication}
            >
              <Circle size={11} aria-hidden="true" />
              Cancel sign-in
            </button>
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
              Check again
            </button>
          )}
          <button
            type="button"
            className="wb-text-button h-7 px-2 text-[10px]"
            onClick={onOpenSettings}
            disabled={busy}
          >
            <Settings2 size={11} aria-hidden="true" />
            Use existing installation
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          <ShieldCheck size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            Chat and Plan remain read-only. Agent mutations still require the
            current Oxide approval and are blocked for production or unclassified targets.
          </p>
        </div>
      </div>
    </div>
  );
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
