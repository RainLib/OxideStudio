import type { AssistantMode } from "@/ai/assistant/modes";
import {
  Bot,
  ListTree,
  MessageSquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
export const MODE_ICONS: Record<AssistantMode, LucideIcon> = {
  o2: Sparkles,
  plan: ListTree,
  agent: Bot,
  chat: MessageSquare,
};
