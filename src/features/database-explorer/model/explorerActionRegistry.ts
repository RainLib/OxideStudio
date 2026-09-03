import type { ExplorerMenuItemInput } from "./explorerMenuDescriptors";
import type { ExplorerTreeNode } from "./explorerTreeNode";

export interface ExplorerActionCapabilities {
  readonly connected?: boolean;
  readonly connecting?: boolean;
  readonly supportsQuery?: boolean;
  readonly supportsBrowsing?: boolean;
  readonly supportsDdl?: boolean;
  readonly supportsTransfer?: boolean;
  readonly supportsCompare?: boolean;
  readonly supportsAdministration?: boolean;
  readonly supportsAiContext?: boolean;
  readonly readOnly?: boolean;
}

const separator = (action: string): ExplorerMenuItemInput => ({
  action,
  label: "",
  separator: true,
});

/**
 * Capability-driven baseline menu shared by every driver. Provider-specific
 * actions are appended by adapters, but unsupported placeholders are never
 * rendered. This matches DBX's menu-factory contract and keeps ordering stable.
 */
export function explorerActionsForNode(
  node: ExplorerTreeNode,
  capabilities: ExplorerActionCapabilities,
): readonly ExplorerMenuItemInput[] {
  if (node.kind === "folder") {
    return [
      { action: "group.new-connection", label: "New Data Source…" },
      { action: "group.new-subgroup", label: "New Subgroup…" },
      separator("group.edit-separator"),
      { action: "group.rename", label: "Rename Group…" },
      separator("group.delete-separator"),
      {
        action: "group.delete",
        label: "Delete Group…",
        destructive: true,
      },
    ];
  }

  if (node.kind === "connection") {
    const items: ExplorerMenuItemInput[] = [
      capabilities.connecting
        ? { action: "connection.cancel", label: "Cancel Connecting" }
        : capabilities.connected
          ? { action: "connection.disconnect", label: "Disconnect" }
          : { action: "connection.connect", label: "Connect" },
      separator("connection.open-separator"),
      { action: "copy.name", label: "Copy Name", shortcut: "⌘C" },
    ];
    if (capabilities.supportsQuery) {
      items.push(separator("connection.query-separator"));
      items.push({ action: "query.new", label: "New Query Console" });
    }
    if (capabilities.supportsBrowsing) {
      items.push({ action: "browser.open", label: "Open Database Browser" });
    }
    if (capabilities.supportsAdministration) {
      items.push({ action: "administration.open", label: "Database Administration…" });
    }
    items.push(separator("connection.manage-separator"));
    items.push({ action: "group.move", label: "Move to Group" });
    items.push({ action: "refresh.children", label: "Refresh Children", shortcut: "F5" });
    items.push({ action: "connection.properties", label: "Properties…" });
    items.push({ action: "connection.duplicate", label: "Duplicate Data Source…" });
    items.push(separator("connection.delete-separator"));
    items.push({
      action: "connection.delete",
      label: "Remove Data Source…",
      destructive: true,
    });
    return items;
  }

  if (node.kind === "database" || node.kind === "schema") {
    const items: ExplorerMenuItemInput[] = [
      { action: "copy.name", label: "Copy Name", shortcut: "⌘C" },
      separator("namespace.open-separator"),
    ];
    if (capabilities.supportsBrowsing) {
      items.push({ action: "browser.open-objects", label: "Open Object Browser" });
    }
    if (capabilities.supportsQuery) {
      items.push({ action: "query.new", label: "New Query Console" });
    }
    if (capabilities.supportsDdl && !capabilities.readOnly) {
      items.push({ action: "namespace.new-table", label: "Create Table…" });
    }
    items.push({ action: "refresh.children", label: "Refresh Children", shortcut: "F5" });
    if (capabilities.supportsTransfer || capabilities.supportsCompare) {
      items.push(separator("namespace.transfer-separator"));
      if (capabilities.supportsTransfer) {
        items.push({ action: "transfer.open", label: "Transfer Data…" });
      }
      if (capabilities.supportsCompare) {
        items.push({ action: "compare.open", label: "Compare Data…" });
      }
    }
    return items;
  }

  if (
    node.kind === "table" ||
    node.kind === "view" ||
    node.kind === "materialized-view" ||
    node.kind === "collection" ||
    node.kind === "search-index"
  ) {
    const items: ExplorerMenuItemInput[] = [
      { action: "copy.name", label: "Copy Name", shortcut: "⌘C" },
    ];
    if (capabilities.supportsQuery) {
      items.push({ action: "query.new", label: "New Query Console" });
    }
    items.push(separator("object.open-separator"));
    if (capabilities.supportsBrowsing) {
      items.push({ action: "data.open", label: "Open Data" });
      items.push({ action: "data.open-new-tab", label: "Open in New Data Tab" });
    }
    if (capabilities.supportsDdl) {
      items.push({ action: "ddl.open", label: "View DDL" });
    }
    items.push({ action: "refresh.children", label: "Refresh", shortcut: "F5" });
    if (capabilities.supportsTransfer) {
      items.push({ action: "transfer.open", label: "Transfer Data…" });
    }
    if (capabilities.supportsCompare && node.kind === "table") {
      items.push({ action: "compare.open", label: "Compare Data…" });
    }
    if (capabilities.supportsDdl && !capabilities.readOnly) {
      items.push(separator("object.delete-separator"));
      items.push({
        action: "object.more-destructive",
        label: "More Actions",
        children: [
          { action: "object.empty", label: "Empty…", destructive: true },
          { action: "object.drop", label: "Drop…", destructive: true },
        ],
      });
    }
    return items;
  }

  return [
    { action: "copy.name", label: "Copy Name", shortcut: "⌘C" },
    { action: "refresh.children", label: "Refresh", shortcut: "F5" },
  ];
}
