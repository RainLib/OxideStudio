import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExplorerTreeStateRowProps {
  state: "loading" | "error" | "empty" | "notice";
  children: ReactNode;
  title?: string;
  ariaLabel?: string;
  onRetry?: () => void;
  retryAriaLabel?: string;
  className?: string;
}

/**
 * A single compact status treatment for every Database Explorer subtree.
 * Keeping the height and retry affordance stable prevents async metadata
 * transitions from visually shifting the rest of the tree.
 */
export function ExplorerTreeStateRow({
  state,
  children,
  title,
  ariaLabel,
  onRetry,
  retryAriaLabel,
  className,
}: ExplorerTreeStateRowProps) {
  const isLoading = state === "loading";
  const isError = state === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "flex min-h-7 min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-[10px]",
        isError ? "text-destructive" : "wb-muted",
        className,
      )}
    >
      {isLoading && (
        <RefreshCw
          size={10}
          className="shrink-0 motion-safe:animate-spin"
          aria-hidden="true"
        />
      )}
      {isError && (
        <AlertCircle size={11} className="shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {isError && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={retryAriaLabel}
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[3px] px-1 font-medium hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
        >
          <RefreshCw size={10} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
