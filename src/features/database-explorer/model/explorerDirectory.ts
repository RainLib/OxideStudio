import type { SchemaObjectInfo } from "@/services/tauri/types";
import type { ExplorerObjectIconKind } from "./explorerObjectPresentation";
import type { ExplorerNodeKind } from "./explorerTreeNode";

export type ExplorerDirectoryGroupKind =
  | "tables"
  | "views"
  | "materialized-views"
  | "procedures"
  | "functions"
  | "triggers"
  | "events"
  | "sequences"
  | "synonyms"
  | "jobs"
  | "packages"
  | "types";

export interface ExplorerDirectoryGroupDefinition {
  kind: ExplorerDirectoryGroupKind;
  label: string;
  iconKind: ExplorerObjectIconKind;
  objectTypes: readonly string[];
}

/**
 * DBX-compatible relational object order. Keep this as the single directory
 * contract used by rendering, filtering, counts, and context-menu routing.
 */
export const EXPLORER_DIRECTORY_GROUPS: readonly ExplorerDirectoryGroupDefinition[] =
  [
    {
      kind: "tables",
      label: "Tables",
      iconKind: "table",
      objectTypes: ["TABLE"],
    },
    {
      kind: "views",
      label: "Views",
      iconKind: "view",
      objectTypes: ["VIEW"],
    },
    {
      kind: "materialized-views",
      label: "Materialized Views",
      iconKind: "materialized-view",
      objectTypes: ["MATERIALIZED_VIEW"],
    },
    {
      kind: "procedures",
      label: "Procedures",
      iconKind: "procedure",
      objectTypes: ["PROCEDURE"],
    },
    {
      kind: "functions",
      label: "Functions",
      iconKind: "function",
      objectTypes: ["FUNCTION"],
    },
    {
      kind: "triggers",
      label: "Triggers",
      iconKind: "trigger",
      objectTypes: ["TRIGGER"],
    },
    {
      kind: "events",
      label: "Events",
      iconKind: "event",
      objectTypes: ["EVENT"],
    },
    {
      kind: "sequences",
      label: "Sequences",
      iconKind: "sequence",
      objectTypes: ["SEQUENCE"],
    },
    {
      kind: "synonyms",
      label: "Synonyms",
      iconKind: "synonym",
      objectTypes: ["SYNONYM"],
    },
    {
      kind: "jobs",
      label: "Scheduler Jobs",
      iconKind: "job",
      objectTypes: ["JOB", "SCHEDULER_JOB"],
    },
    {
      kind: "packages",
      label: "Packages",
      iconKind: "package",
      objectTypes: ["PACKAGE", "PACKAGE_BODY"],
    },
    {
      kind: "types",
      label: "Types",
      iconKind: "type",
      objectTypes: ["TYPE", "TYPE_BODY"],
    },
  ];

export function normalizeExplorerObjectType(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function explorerDirectoryGroupForObjectType(
  value: string,
): ExplorerDirectoryGroupKind | null {
  const normalized = normalizeExplorerObjectType(value);
  if (normalized.includes("MATERIALIZED_VIEW")) return "materialized-views";
  if (normalized === "VIEW" || normalized.endsWith("_VIEW")) return "views";
  if (normalized.includes("PROCEDURE")) return "procedures";
  if (normalized.includes("FUNCTION")) return "functions";
  if (normalized.includes("TRIGGER")) return "triggers";
  if (normalized.includes("EVENT")) return "events";
  if (normalized.includes("SEQUENCE")) return "sequences";
  if (normalized.includes("SYNONYM")) return "synonyms";
  if (normalized.includes("JOB")) return "jobs";
  if (normalized.includes("PACKAGE")) return "packages";
  if (normalized.includes("TYPE")) return "types";
  if (normalized.includes("TABLE")) return "tables";
  return null;
}

export function groupSchemaObjectDescriptors(
  objects: readonly SchemaObjectInfo[],
) {
  const groups = new Map<ExplorerDirectoryGroupKind, SchemaObjectInfo[]>();
  for (const object of objects) {
    const kind = explorerDirectoryGroupForObjectType(object.objectType);
    if (!kind || kind === "tables" || kind === "views") continue;
    const group = groups.get(kind) || [];
    group.push(object);
    groups.set(kind, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.name.localeCompare(right.name));
  }
  return groups;
}

export function explorerDirectoryDefinition(kind: ExplorerDirectoryGroupKind) {
  return EXPLORER_DIRECTORY_GROUPS.find((group) => group.kind === kind)!;
}

const DIRECTORY_NODE_KINDS: Record<
  ExplorerDirectoryGroupKind,
  ExplorerNodeKind
> = {
  tables: "table",
  views: "view",
  "materialized-views": "materialized-view",
  procedures: "procedure",
  functions: "function",
  triggers: "trigger",
  events: "event",
  sequences: "sequence",
  synonyms: "synonym",
  jobs: "job",
  packages: "package",
  types: "type",
};

export function explorerDirectoryNodeKind(kind: ExplorerDirectoryGroupKind) {
  return DIRECTORY_NODE_KINDS[kind];
}
