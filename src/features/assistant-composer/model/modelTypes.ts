import type { AiCliModelInfo } from "@/services/tauri/ai.service";
import { type RefObject } from "react";

export type AssistantModelStatusKind =
  | "configured"
  | "checking"
  | "missing"
  | "unavailable"
  | "authentication-error"
  | "incompatible";

export type AssistantModelStatus = {
  kind: AssistantModelStatusKind;
  label: string;
  detail: string;
};

export type AssistantModelCatalogStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export interface AssistantModelControlProps {
  model: string;
  endpoint: string;
  status: AssistantModelStatus;
  disabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  panelId: string;
  modelOptions?: readonly AiCliModelInfo[];
  catalogStatus?: AssistantModelCatalogStatus;
  catalogWarning?: string;
  catalogRefreshing?: boolean;
  reasoningEffort?: string;
  serviceTier?: "default" | "priority";
  onOpenChange: (open: boolean) => void;
  onReasoningEffortChange?: (effort: string) => void;
  onServiceTierChange?: (tier: "default" | "priority") => void;
  onModelChange: (model: string) => void;
  onRetry: () => void;
}

export interface AssistantModelPanelProps {
  model: string;
  status: AssistantModelStatus;
  disabled: boolean;
  modelOptions?: readonly AiCliModelInfo[];
  catalogStatus?: AssistantModelCatalogStatus;
  catalogWarning?: string;
  catalogRefreshing?: boolean;
  reasoningEffort?: string;
  serviceTier?: "default" | "priority";
  onReasoningEffortChange?: (effort: string) => void;
  onServiceTierChange?: (tier: "default" | "priority") => void;
  onModelChange: (model: string) => void;
  onRetry: () => void;
}
