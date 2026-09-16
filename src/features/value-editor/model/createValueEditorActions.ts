import type { ValueEditorTarget } from "@/features/value-editor/model/valueEditorTypes";
import {
  tableCellExpression,
  validateTableCellExpression,
} from "@/lib/tableCellExpression";
import type { ValueEditorKind, ValueEditorState } from "@/lib/valueEditor";
import { formatJsonDraft, parseValueEditorDraft } from "@/lib/valueEditor";

interface ValueEditorActionsOptions {
  canUseEmpty: boolean;
  target: ValueEditorTarget;
  setEditMode: React.Dispatch<React.SetStateAction<"value" | "expression">>;
  setSemanticState: React.Dispatch<React.SetStateAction<ValueEditorState>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  semanticState: ValueEditorState;
  draft: string;
  setCopied: React.Dispatch<React.SetStateAction<boolean>>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  editMode: "value" | "expression";
  onStageValue: (value: unknown) => void;
  onOpenChange: (open: boolean) => void;
  kind: ValueEditorKind;
}

export function createValueEditorActions({
  canUseEmpty,
  target,
  setEditMode,
  setSemanticState,
  setError,
  semanticState,
  draft,
  setCopied,
  setDraft,
  editMode,
  onStageValue,
  onOpenChange,
  kind,
}: ValueEditorActionsOptions) {
  const selectState = (next: ValueEditorState) => {
    if (next === "empty" && !canUseEmpty) return;
    if (next === "null" && !target.nullable) return;
    if (next !== "value") setEditMode("value");
    setSemanticState(next);
    setError(null);
  };

  const copyValue = async () => {
    const text =
      semanticState === "null"
        ? "NULL"
        : semanticState === "unloaded"
          ? ""
          : semanticState === "empty"
            ? ""
            : draft;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  const formatJson = (compact: boolean) => {
    const result = formatJsonDraft(draft, compact);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(String(result.value));
    setError(null);
  };

  const stageValue = () => {
    if (editMode === "expression") {
      const result = validateTableCellExpression(draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onStageValue(tableCellExpression(result.value));
      onOpenChange(false);
      return;
    }
    const result = parseValueEditorDraft({
      state: semanticState,
      draft,
      kind,
      columnType: target.columnType,
      nullable: target.nullable,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onStageValue(result.value);
    onOpenChange(false);
  };

  return { stageValue, selectState, formatJson, copyValue };
}
