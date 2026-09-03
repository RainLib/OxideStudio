import {
  createExplorerActionTarget,
  type ExplorerActionTarget,
} from "./explorerActionTarget";
import type {
  ExplorerNodeKind,
  ExplorerTreeNode,
} from "./explorerTreeNode";

export type ExplorerMenuActionId = `${ExplorerNodeKind}:${string}`;

export interface ExplorerMenuContext {
  readonly target: ExplorerActionTarget;
  readonly selectedNodeIds: readonly string[];
  readonly driver?: string;
}

export interface ExplorerMenuItemInput {
  readonly action: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly separator?: boolean;
  readonly destructive?: boolean;
  readonly shortcut?: string;
  readonly children?: readonly ExplorerMenuItemInput[];
}

export interface ExplorerMenuDescriptor {
  readonly id: ExplorerMenuActionId;
  readonly action: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly separator: boolean;
  readonly variant: "default" | "destructive";
  readonly shortcut?: string;
  readonly children: readonly ExplorerMenuDescriptor[];
}

export function createExplorerMenuContext(
  node: ExplorerTreeNode,
  selectedNodeIds: readonly string[],
  driver?: string,
): ExplorerMenuContext {
  return Object.freeze({
    target: createExplorerActionTarget(node),
    selectedNodeIds: Object.freeze([...selectedNodeIds]),
    driver,
  });
}

/** Stable descriptors let every row share one menu host instead of mounting a
 * complete Radix menu tree for every database object. */
export function normalizeExplorerMenuDescriptors(
  context: ExplorerMenuContext,
  items: readonly ExplorerMenuItemInput[],
): readonly ExplorerMenuDescriptor[] {
  const normalize = (
    entries: readonly ExplorerMenuItemInput[],
    parentPath: string,
  ): ExplorerMenuDescriptor[] =>
    entries.map((item, index) => {
      const path = parentPath ? `${parentPath}.${index}` : String(index);
      return Object.freeze({
        id: `${context.target.kind}:${path}` as ExplorerMenuActionId,
        action: item.action,
        label: item.label,
        disabled: item.disabled === true,
        separator: item.separator === true,
        variant: item.destructive ? "destructive" : "default",
        shortcut: item.shortcut,
        children: Object.freeze(normalize(item.children ?? [], path)),
      });
    });
  return Object.freeze(normalize(items, ""));
}
