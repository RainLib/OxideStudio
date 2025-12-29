import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PanelProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  rounded?: boolean;
  border?: boolean;
}

/**
 * Panel component - a basic container with optional padding, border, and rounded corners
 * Uses theme colors for consistent styling
 */
export function Panel({
  children,
  className,
  padding = "md",
  rounded = true,
  border = true,
}: PanelProps) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground",
        border && "border border-border",
        rounded && "rounded-lg",
        {
          "p-0": padding === "none",
          "p-2": padding === "sm",
          "p-4": padding === "md",
          "p-6": padding === "lg",
        },
        className
      )}
    >
      {children}
    </div>
  );
}
