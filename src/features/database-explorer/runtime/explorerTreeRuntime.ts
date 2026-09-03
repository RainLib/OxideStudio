import {
  createExplorerActionTarget,
  type ExplorerActionTarget,
} from "../model/explorerActionTarget";
import type { ExplorerMenuDescriptor } from "../model/explorerMenuDescriptors";
import type { ExplorerTreeNode } from "../model/explorerTreeNode";

export interface ExplorerSelectionSnapshot {
  readonly ids: readonly string[];
  readonly targets: readonly ExplorerActionTarget[];
}

export interface ExplorerRuntimeGeneration {
  readonly runtimeId: symbol;
  readonly generation: number;
}

export interface ExplorerTreeRuntimeHost {
  buildContextMenu(node: ExplorerTreeNode): readonly ExplorerMenuDescriptor[];
  handleRowClick(node: ExplorerTreeNode, event: MouseEvent): void;
  handleRowDoubleClick(node: ExplorerTreeNode, event: MouseEvent): void;
  handleRowKeydown(node: ExplorerTreeNode, event: KeyboardEvent): void;
  toggleNode(node: ExplorerTreeNode, forceExpanded?: boolean): void;
}

export interface ExplorerTreeRuntime {
  readonly runtimeId: symbol;
  readonly diagnostics: Readonly<{
    hostBindings: number;
    menuBuilds: number;
  }>;
  bindHost(host: ExplorerTreeRuntimeHost | null): void;
  beginAction(): ExplorerRuntimeGeneration;
  isCurrent(token: ExplorerRuntimeGeneration): boolean;
  buildContextMenu(node: ExplorerTreeNode): readonly ExplorerMenuDescriptor[];
  handleRowClick(node: ExplorerTreeNode, event: MouseEvent): void;
  handleRowDoubleClick(node: ExplorerTreeNode, event: MouseEvent): void;
  handleRowKeydown(node: ExplorerTreeNode, event: KeyboardEvent): void;
  toggleNode(node: ExplorerTreeNode, forceExpanded?: boolean): void;
  dispose(): void;
}

export function createExplorerSelectionSnapshot(
  nodes: readonly ExplorerTreeNode[],
  selectedIds: readonly string[],
): ExplorerSelectionSnapshot {
  const selected = new Set(selectedIds);
  return Object.freeze({
    ids: Object.freeze([...selectedIds]),
    targets: Object.freeze(
      nodes.filter((node) => selected.has(node.id)).map(createExplorerActionTarget),
    ),
  });
}

export function createExplorerTreeRuntime(): ExplorerTreeRuntime {
  const runtimeId = Symbol("oxide-explorer-tree-runtime");
  let host: ExplorerTreeRuntimeHost | null = null;
  let generation = 0;
  let disposed = false;
  let hostBindings = 0;
  let menuBuilds = 0;

  const currentHost = () => (disposed ? null : host);

  return {
    runtimeId,
    get diagnostics() {
      return Object.freeze({ hostBindings, menuBuilds });
    },
    bindHost(nextHost) {
      if (disposed) return;
      host = nextHost;
      if (nextHost) hostBindings += 1;
    },
    beginAction() {
      generation += 1;
      return Object.freeze({ runtimeId, generation });
    },
    isCurrent(token) {
      return (
        !disposed &&
        token.runtimeId === runtimeId &&
        token.generation === generation
      );
    },
    buildContextMenu(node) {
      menuBuilds += 1;
      return currentHost()?.buildContextMenu(node) ?? [];
    },
    handleRowClick(node, event) {
      currentHost()?.handleRowClick(node, event);
    },
    handleRowDoubleClick(node, event) {
      currentHost()?.handleRowDoubleClick(node, event);
    },
    handleRowKeydown(node, event) {
      currentHost()?.handleRowKeydown(node, event);
    },
    toggleNode(node, forceExpanded) {
      currentHost()?.toggleNode(node, forceExpanded);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      host = null;
    },
  };
}
