import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ErrorDisplayProps {
  error: string | Error;
  className?: string;
  onRetry?: () => void;
}

/**
 * Error display component with optional retry button
 */
export function ErrorDisplay({ error, className, onRetry }: ErrorDisplayProps) {
  const message = error instanceof Error ? error.message : error;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-6 text-center",
        className
      )}
    >
      <AlertCircle className="w-12 h-12 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">Error</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
