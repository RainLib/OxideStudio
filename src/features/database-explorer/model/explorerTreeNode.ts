export type ExplorerNodeKind =
  | "workspace"
  | "folder"
  | "connection"
  | "database"
  | "catalog"
  | "schema"
  | "group"
  | "table"
  | "view"
  | "materialized-view"
  | "column"
  | "primary-key"
  | "foreign-key"
  | "constraint"
  | "index"
  | "procedure"
  | "function"
  | "trigger"
  | "event"
  | "sequence"
  | "synonym"
  | "job"
  | "package"
  | "type"
  | "collection"
  | "search-index"
  | "key";

export type ExplorerNodeLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "stale"
  | "error";

export interface ExplorerNodeIdentity {
  readonly id: string;
  readonly kind: ExplorerNodeKind;
  readonly label: string;
  readonly connectionId?: string;
  readonly database?: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly objectName?: string;
  readonly signature?: string;
}

export interface ExplorerTreeNode extends ExplorerNodeIdentity {
  readonly parentId?: string;
  readonly description?: string;
  readonly expandable?: boolean;
  readonly loadState?: ExplorerNodeLoadState;
  readonly childCount?: number;
  readonly children?: readonly ExplorerTreeNode[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function encodeNodePart(value: string) {
  return encodeURIComponent(value).replace(/%/g, "~");
}

/**
 * Produces a stable, collision-resistant key for expansion, selection and
 * async work. Labels are intentionally excluded because users can rename a
 * connection while a row is mounted.
 */
export function explorerNodeId(
  kind: ExplorerNodeKind,
  ...identityParts: readonly (string | null | undefined)[]
) {
  return [kind, ...identityParts.map((part) => encodeNodePart(part ?? ""))].join(
    ":",
  );
}

export function flattenVisibleExplorerNodes(
  roots: readonly ExplorerTreeNode[],
  expandedIds: ReadonlySet<string>,
) {
  const visible: ExplorerTreeNode[] = [];
  const visit = (nodes: readonly ExplorerTreeNode[]) => {
    for (const node of nodes) {
      visible.push(node);
      if (expandedIds.has(node.id) && node.children?.length) {
        visit(node.children);
      }
    }
  };
  visit(roots);
  return visible;
}
