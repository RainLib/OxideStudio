import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "src/components/workspace/assistant";
const facade = fs.readFileSync(path.join(root, `${base}/AssistantTurnProcess.tsx`), "utf8");

for (const required of [
  'from "./turn-process/approval"',
  'from "./turn-process/timeline"',
  'from "./turn-process/types"',
  "VISIBLE_STATUS_WITHOUT_PROCESS",
  "<LiveProcessTimeline",
  "<ProcessDisclosure",
  "<ApprovalPrompt",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Assistant turn-process facade must retain ${required}.`);
  }
}

if (/\buse(State|Memo)\b|function\s+(ApprovalPrompt|ProcessDetail|TurnStatusIcon)\b/.test(facade)) {
  throw new Error("Assistant turn-process facade must not regain component implementation ownership.");
}

const ownership = {
  "timeline.tsx": ["export function LiveProcessTimeline", "export function ProcessDisclosure", "ProcessDetail"],
  "process-details.tsx": ["export function ProcessDetail", "projectFilePathFromDetail", "ExpandableProcessDetail"],
  "presentation.tsx": ["export function TurnStatusIcon", "export function turnProcessHeadline", "export type ProjectFileOperation"],
  "approval.tsx": ["export function ApprovalPrompt", "onCompositionStart", "confirmationMatches"],
  "types.ts": ["export type ProjectFileNavigation", "export type AssistantTurnProcessProps"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = fs.readFileSync(path.join(root, `${base}/turn-process/${module}`), "utf8");
  if (symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${module} must retain its Assistant turn-process ownership.`);
  }
}

console.log("Assistant turn-process boundaries verified: facade, timeline, details, presentation, and approval are explicit.");
