import type {
  ExplorerNodeIdentity,
  ExplorerTreeNode,
} from "./explorerTreeNode";

export type ExplorerActionTarget = Readonly<
  ExplorerNodeIdentity & {
    readonly parentId?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }
>;

export interface ExplorerActionRequest<TPayload = undefined> {
  readonly target: ExplorerActionTarget;
  readonly selectedNodeIds: readonly string[];
  readonly payload: TPayload;
}

function freezeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
) {
  return metadata ? Object.freeze({ ...metadata }) : undefined;
}

/**
 * Virtual rows are recycled and metadata trees are refreshed in-place. Actions
 * therefore retain only a small immutable identity snapshot, never a row or
 * its child collection.
 */
export function createExplorerActionTarget(
  node: ExplorerTreeNode,
): ExplorerActionTarget {
  return Object.freeze({
    id: node.id,
    kind: node.kind,
    label: node.label,
    parentId: node.parentId,
    connectionId: node.connectionId,
    database: node.database,
    catalog: node.catalog,
    schema: node.schema,
    objectName: node.objectName,
    signature: node.signature,
    metadata: freezeMetadata(node.metadata),
  });
}

export function matchesExplorerActionTarget(
  node: ExplorerTreeNode,
  target: ExplorerActionTarget,
) {
  return (
    node.id === target.id &&
    node.kind === target.kind &&
    node.connectionId === target.connectionId &&
    node.database === target.database &&
    node.catalog === target.catalog &&
    node.schema === target.schema &&
    node.objectName === target.objectName &&
    node.signature === target.signature
  );
}

export function findExplorerActionTarget(
  roots: readonly ExplorerTreeNode[],
  target: ExplorerActionTarget,
): ExplorerTreeNode | null {
  const visit = (nodes: readonly ExplorerTreeNode[]): ExplorerTreeNode | null => {
    for (const node of nodes) {
      if (matchesExplorerActionTarget(node, target)) return node;
      const child = node.children ? visit(node.children) : null;
      if (child) return child;
    }
    return null;
  };
  return visit(roots);
}

export function createExplorerActionRequest<TPayload>(
  node: ExplorerTreeNode,
  selectedNodeIds: readonly string[],
  payload: TPayload,
): ExplorerActionRequest<TPayload> {
  return Object.freeze({
    target: createExplorerActionTarget(node),
    selectedNodeIds: Object.freeze([...selectedNodeIds]),
    payload,
  });
}
