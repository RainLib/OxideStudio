import {
  COLLECTION_VALUE_KEYS,
  EXPRESSION_STAGES,
  FIELD_OBJECT_KEYS,
  PIPELINE_STAGES,
  PUSH_OPERATOR_KEYS,
  QUERY_DOCUMENT_KEYS,
  STAGE_FIELD_REFERENCE_VALUE_KEYS,
  STAGE_FIELD_VALUE_KEYS,
  STAGE_OPTION_KEYS,
  UPDATE_OBJECT_KEYS,
  UPDATE_OPERATOR_KEYS,
} from "@/features/query-languages/mongodb/jsonCatalog";
import {
  activeCollection,
  scanJsonBeforeCursor,
} from "@/features/query-languages/mongodb/jsonScanner";
import { type MongoDbCompletionContext } from "@/features/query-languages/mongodb/types";

export function mongodbJsonCompletionContext(
  source: string,
  cursorOffset: number,
): MongoDbCompletionContext {
  const scan = scanJsonBeforeCursor(source, cursorOffset);
  const frame = scan.frames[scan.frames.length - 1];
  const collection = activeCollection(source, cursorOffset);
  const typed = scan.inString
    ? scan.before.slice(scan.stringStart + 1)
    : scan.before.match(/[A-Za-z0-9_$.-]+$/u)?.[0] || "";
  const activeKey = frame?.lastKey;
  const ownerKey = frame?.ownerKey;
  const ownerKeys = scan.frames
    .map((candidate) => candidate.ownerKey)
    .filter((candidate): candidate is string => Boolean(candidate));
  const enclosingStage = [...ownerKeys]
    .reverse()
    .find((candidate) => PIPELINE_STAGES.includes(candidate));
  const withinQueryDocument = ownerKeys.some((candidate) =>
    QUERY_DOCUMENT_KEYS.has(candidate),
  );
  const withinUpdateDocument = ownerKeys.some(
    (candidate) =>
      UPDATE_OBJECT_KEYS.has(candidate) || UPDATE_OPERATOR_KEYS.has(candidate),
  );
  const withinPushDocument = ownerKeys.some((candidate) =>
    PUSH_OPERATOR_KEYS.has(candidate),
  );
  const isKeyPosition = Boolean(frame?.kind === "object" && frame.expectingKey);

  if (isKeyPosition) {
    if (ownerKey === "pipeline")
      return {
        area: "pipeline-stage",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    if (ownerKey && STAGE_OPTION_KEYS[ownerKey]) {
      return {
        area: "stage-option",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    }
    if (enclosingStage === "$group" && ownerKey !== "$group") {
      return {
        area: "accumulator",
        typed,
        activeKey,
        parentKey: enclosingStage,
        collection,
      };
    }
    if (
      enclosingStage &&
      EXPRESSION_STAGES.has(enclosingStage) &&
      ownerKey !== enclosingStage
    ) {
      return {
        area: "expression",
        typed,
        activeKey,
        parentKey: enclosingStage,
        collection,
      };
    }
    if (ownerKey === "$expr" || ownerKeys.includes("$expr")) {
      return {
        area: "expression",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    }
    if (UPDATE_OBJECT_KEYS.has(ownerKey || ""))
      return {
        area: "update-operator",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    if (
      withinPushDocument &&
      ownerKey !== "$push" &&
      ownerKey !== "$addToSet"
    ) {
      return {
        area: "push-modifier",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    }
    if (withinUpdateDocument && UPDATE_OPERATOR_KEYS.has(ownerKey || "")) {
      return {
        area: "field",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    }
    if (FIELD_OBJECT_KEYS.has(ownerKey || "")) {
      return typed.startsWith("$")
        ? {
            area: "query-operator",
            typed,
            activeKey,
            parentKey: ownerKey,
            collection,
          }
        : { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (withinQueryDocument) {
      const ownerIsFieldPredicate = Boolean(
        ownerKey &&
          !QUERY_DOCUMENT_KEYS.has(ownerKey) &&
          !ownerKey.startsWith("$"),
      );
      return ownerIsFieldPredicate || typed.startsWith("$")
        ? {
            area: "query-operator",
            typed,
            activeKey,
            parentKey: ownerKey,
            collection,
          }
        : { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (
      ownerKey === "insertOne" ||
      ownerKey === "insertMany" ||
      ownerKey === "replacement"
    ) {
      return {
        area: "field",
        typed,
        activeKey,
        parentKey: ownerKey,
        collection,
      };
    }
    if (!ownerKey && scan.frames.length <= 1)
      return { area: "root", typed, activeKey, collection };
    return { area: "key", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (scan.inString && COLLECTION_VALUE_KEYS.has(activeKey || "")) {
    return {
      area: "collection",
      typed,
      activeKey,
      parentKey: ownerKey,
      collection,
    };
  }
  if (
    scan.inString &&
    (["field"].includes(activeKey || "") ||
      (Boolean(ownerKey && STAGE_OPTION_KEYS[ownerKey]) &&
        STAGE_FIELD_VALUE_KEYS.has(activeKey || "")))
  ) {
    return { area: "field", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (
    scan.inString &&
    (STAGE_FIELD_REFERENCE_VALUE_KEYS.has(activeKey || "") ||
      (typed.startsWith("$") && Boolean(enclosingStage)))
  ) {
    return {
      area: "field-reference",
      typed,
      activeKey,
      parentKey: ownerKey,
      collection,
    };
  }
  if (
    scan.inString &&
    typed.startsWith("$") &&
    (enclosingStage || activeKey === "$expr")
  ) {
    return {
      area: "field-reference",
      typed,
      activeKey,
      parentKey: enclosingStage,
      collection,
    };
  }
  return {
    area: "value",
    typed,
    activeKey,
    parentKey: ownerKey,
    collection,
    quoted: scan.inString,
  };
}
