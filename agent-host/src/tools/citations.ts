import {
  type AgentCitation,
  type BoundedObservation,
} from "@oxide/agent-contract";
import { createHash } from "node:crypto";
import { stableJson } from "./identity.js";
import { isRecord } from "./value.js";

export type CitationWorkspace = {
  projectId: string;
  connectionId: string | null;
  database: string | null;
  namespace: string | null;
  activeTabId: string | null;
};

export function citationCandidatesFromObservation(
  toolName: string,
  input: unknown,
  observation: BoundedObservation,
  workspace: CitationWorkspace,
): AgentCitation[] {
  if (
    toolName !== "metadata.listObjects" &&
    toolName !== "metadata.listCollections" &&
    toolName !== "metadata.describeObject" &&
    toolName !== "query.explain" &&
    toolName !== "workspace.getActiveTab"
  ) {
    return [];
  }

  const payload = isRecord(input) ? input : {};
  if (toolName === "query.explain" || toolName === "workspace.getActiveTab") {
    const observed = isRecord(observation.data) ? observation.data : null;
    const plan =
      toolName === "workspace.getActiveTab" && isRecord(observed?.explainPlan)
        ? observed.explainPlan
        : observed;
    const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
    const root = isRecord(plan?.root)
      ? plan.root
      : nodes.find(
          (candidate) =>
            isRecord(candidate) && candidate.id === plan?.rootNodeId,
        );
    const planId = boundedCitationText(plan?.id, 240);
    const nodeId =
      boundedCitationText(root?.id, 240) ||
      boundedCitationText(plan?.rootNodeId, 240);
    const tabId =
      (toolName === "workspace.getActiveTab"
        ? boundedCitationText(observed?.id, 240)
        : undefined) || boundedCitationText(workspace.activeTabId, 240);
    if (!planId || !nodeId || !tabId) return [];
    const nodeType = boundedCitationText(root?.nodeType, 120) || "Plan root";
    const mode = boundedCitationText(plan?.mode, 120);
    const executionTime = boundedCitationMetric(plan?.executionTimeMs);
    const detail = [
      boundedCitationText(plan?.driver, 120),
      mode,
      mode === "analyze" && executionTime !== undefined
        ? `${executionTime.toLocaleString()} ms actual`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return [
      {
        id: stableCitationId("plan", [
          workspace.projectId,
          tabId,
          planId,
          nodeId,
        ]),
        kind: "planNode",
        label: `${mode === "analyze" ? "Analyzed plan" : "Explain Plan"} · ${nodeType}`,
        ...(detail ? { detail } : {}),
        toolName,
        projectId: workspace.projectId,
        tabId,
        planId,
        nodeId,
      },
    ];
  }

  const fallbackConnectionId =
    boundedCitationText(payload.connectionId, 240) ||
    boundedCitationText(workspace.connectionId, 240);
  const databaseName = boundedCitationText(workspace.database, 240);
  const candidates =
    toolName === "metadata.describeObject"
      ? [observation.data]
      : citationCollectionItems(observation.data);
  const observedSchemas = new Set(
    candidates
      .map((candidate) =>
        boundedCitationText(
          isRecord(candidate) ? candidate.namespace : undefined,
          240,
        ),
      )
      .filter((value): value is string => Boolean(value)),
  );
  const fallbackSchema =
    boundedCitationText(payload.namespace, 240) ||
    boundedCitationText(workspace.namespace, 240) ||
    (observedSchemas.size === 1 ? [...observedSchemas][0] : undefined);

  const objectCitations = candidates
    .slice(0, 8)
    .flatMap((value): AgentCitation[] => {
      const object = isRecord(value) ? value : null;
      const connectionId =
        boundedCitationText(object?.connectionId, 240) || fallbackConnectionId;
      const schemaName =
        boundedCitationText(object?.namespace, 240) || fallbackSchema;
      const objectName =
        boundedCitationText(object?.name, 240) ||
        (toolName === "metadata.describeObject"
          ? boundedCitationText(payload.name, 240)
          : undefined);
      if (!connectionId || !schemaName || !objectName) return [];
      const objectType =
        boundedCitationText(object?.type, 120) ||
        boundedCitationText(object?.kind, 120);
      const qualifiedName = [databaseName, schemaName, objectName]
        .filter(Boolean)
        .join(".");
      return [
        {
          id: stableCitationId("object", [
            workspace.projectId,
            connectionId,
            databaseName,
            schemaName,
            objectName,
            objectType,
          ]),
          kind: "databaseObject",
          label: objectName,
          detail: qualifiedName,
          toolName,
          projectId: workspace.projectId,
          connectionId,
          ...(databaseName ? { databaseName } : {}),
          schemaName,
          objectName,
          ...(objectType ? { objectType } : {}),
        },
      ];
    });
  if (
    toolName !== "metadata.describeObject" &&
    fallbackConnectionId &&
    fallbackSchema
  ) {
    const qualifiedSchema = [databaseName, fallbackSchema]
      .filter(Boolean)
      .join(".");
    const schemaCitation: AgentCitation = {
      id: stableCitationId("schema", [
        workspace.projectId,
        fallbackConnectionId,
        databaseName,
        fallbackSchema,
      ]),
      kind: "databaseSchema",
      label: fallbackSchema,
      detail: qualifiedSchema,
      toolName,
      projectId: workspace.projectId,
      connectionId: fallbackConnectionId,
      ...(databaseName ? { databaseName } : {}),
      schemaName: fallbackSchema,
    };
    return [schemaCitation, ...objectCitations].slice(0, 8);
  }
  return objectCitations.slice(0, 8);
}

export function citationCollectionItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["items", "objects", "rows", "collections"] as const) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

export function stableCitationId(kind: string, identity: unknown[]) {
  return `cite-${kind}-${createHash("sha256")
    .update(stableJson(identity))
    .digest("hex")
    .slice(0, 20)}`;
}

export function boundedCitationText(value: unknown, limit: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/gu, " ");
  if (!normalized) return undefined;
  return Array.from(normalized).slice(0, limit).join("");
}

export function boundedCitationMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
