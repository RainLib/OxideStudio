import type {
  AssistantContextPreview,
  AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import type { AssistantDatabaseTableMention } from "@/ai/assistant/databaseTableContext";
import type { AssistantModeOption } from "@/ai/assistant/modes";
import { type AssistantMode } from "@/ai/assistant/modes";
import {
  type AssistantModelCatalogStatus,
  type AssistantModelStatus,
} from "@/features/assistant-composer/model/modelTypes";
import type {
  AiCliCommandInfo,
  AiCliModelInfo,
} from "@/services/tauri/ai.service";

export interface AssistantPromptBoxProps {
  message: string;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  activeContextLabel: string;
  selectedNamespace: string | null;
  namespaceOptions: readonly string[];
  onNamespaceChange: (namespace: string | null) => void;
  onRequestNamespaceOptions: () => void;
  contextPreview: AssistantContextPreview;
  contextSettings: AssistantContextSettings;
  onContextSettingChange: (
    key: keyof AssistantContextSettings,
    checked: boolean,
  ) => void;
  isSubmitting: boolean;
  isToolRunning: boolean;
  isCancelling: boolean;
  model: string;
  modelEndpoint: string;
  modelStatus: AssistantModelStatus;
  modelOptions?: readonly AiCliModelInfo[];
  modelCatalogStatus?: AssistantModelCatalogStatus;
  modelCatalogWarning?: string;
  modelCatalogRefreshing?: boolean;
  reasoningEffort?: string;
  serviceTier?: "default" | "priority";
  accessMode?: "restricted" | "full";
  commandOptions?: readonly AiCliCommandInfo[];
  onModelChange: (model: string) => void;
  onReasoningEffortChange?: (effort: string) => void;
  onServiceTierChange?: (tier: "default" | "priority") => void;
  onAccessModeChange?: (mode: "restricted" | "full") => void;
  onRetryModel: () => void;
  submissionBlockReason: string | null;
  modeOptions?: readonly AssistantModeOption[];
  attachments: Array<{ id: string; fileName: string; byteCount: number }>;
  databaseMentions: readonly AssistantDatabaseTableMention[];
  attachmentError: string | null;
  isAddingAttachment: boolean;
  onAddAttachment: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveDatabaseMention: (mention: AssistantDatabaseTableMention) => void;
}
