import type { ValueEditorTarget } from "@/features/value-editor/model/valueEditorTypes";
import {
  inferValueEditorKind,
  parseArrayPreview,
  parseGeometryPreview,
  parseImagePreview,
  parseJsonPreview,
  parseMapPreview,
  parseXmlPreview,
  valueEditorDraft,
  valueEditorState,
  valueEditorSupportsEmpty,
  type ValueEditorState,
} from "@/lib/valueEditor";
import { useEffect, useMemo, useState } from "react";

interface ValueEditorDraftOptions {
  target: ValueEditorTarget | null;
  open: boolean;
}

export function useValueEditorDraft({ target, open }: ValueEditorDraftOptions) {
  const kind = useMemo(
    () => inferValueEditorKind(target?.columnType, target?.value),
    [target?.columnType, target?.value],
  );
  const [semanticState, setSemanticState] =
    useState<ValueEditorState>("unloaded");
  const [draft, setDraft] = useState("");
  const [editMode, setEditMode] = useState<"value" | "expression">("value");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [jsonPresentation, setJsonPresentation] = useState<"text" | "tree">(
    "text",
  );

  useEffect(() => {
    if (!open || !target) return;
    const isExpression = Boolean(target.expression);
    setSemanticState(isExpression ? "value" : valueEditorState(target.value));
    setDraft(
      isExpression
        ? target.expression || ""
        : valueEditorDraft(target.value, kind),
    );
    setEditMode(isExpression ? "expression" : "value");
    setError(null);
    setCopied(false);
    setJsonPresentation("text");
  }, [kind, open, target]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const binaryBytes = useMemo(() => {
    if (
      kind !== "binary" ||
      (!draft.startsWith("\\x") && !draft.startsWith("0x")) ||
      (draft.length - 2) % 2 !== 0
    ) {
      return null;
    }
    return (draft.length - 2) / 2;
  }, [draft, kind]);
  const textBytes = useMemo(
    () =>
      draft.length <= 1_000_000 ? new TextEncoder().encode(draft).length : null,
    [draft],
  );
  const canUseEmpty = valueEditorSupportsEmpty(kind);
  const editorLanguage =
    kind === "json" ? "json" : kind === "xml" ? "xml" : "plaintext";
  const jsonPreview = useMemo(
    () =>
      kind === "json" && semanticState === "value"
        ? parseJsonPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const arrayPreview = useMemo(
    () =>
      kind === "array" && semanticState === "value"
        ? parseArrayPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const mapPreview = useMemo(
    () =>
      kind === "map" && semanticState === "value"
        ? parseMapPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const xmlPreview = useMemo(
    () =>
      kind === "xml" && semanticState === "value"
        ? parseXmlPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const geometryPreview = useMemo(
    () =>
      kind === "geometry" && semanticState === "value"
        ? parseGeometryPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const imagePreview = useMemo(
    () =>
      kind === "image" && semanticState === "value"
        ? parseImagePreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const structuredPreview =
    kind === "array"
      ? arrayPreview
      : kind === "map"
        ? mapPreview
        : kind === "xml"
          ? xmlPreview
          : kind === "geometry"
            ? geometryPreview
            : jsonPreview;
  const canShowStructuredTree = structuredPreview?.ok === true;
  const canShowPreview =
    kind === "image" ? imagePreview?.ok === true : canShowStructuredTree;
  const previewError =
    kind === "image"
      ? imagePreview && !imagePreview.ok
        ? imagePreview.error
        : undefined
      : structuredPreview && !structuredPreview.ok
        ? structuredPreview.error
        : undefined;

  return {
    canUseEmpty,
    setEditMode,
    setSemanticState,
    setError,
    semanticState,
    draft,
    setCopied,
    setDraft,
    editMode,
    kind,
    binaryBytes,
    textBytes,
    jsonPresentation,
    canShowPreview,
    previewError,
    setJsonPresentation,
    copied,
    imagePreview,
    structuredPreview,
    editorLanguage,
    error,
  };
}
