import type { SchemaObjectInfo } from "@/services/tauri/types";
import { useRef, useState } from "react";
import { createConnectionTreeRenderer } from "./createConnectionTreeRenderer";
import { createExplorerSchemaMenus } from "./createExplorerSchemaMenus";
import { createSchemaObjectsRenderer } from "./createSchemaObjectsRenderer";
import { ExplorerSidebarView } from "./ExplorerSidebarView";
import type { ExplorerSidebarViewContext } from "./explorerSidebarViewTypes";

type OwnedPresentationKey =
  | "expandedSchemaObjectMemberKeys"
  | "setExpandedSchemaObjectMemberKeys"
  | "schemaObjectMemberStates"
  | "setSchemaObjectMemberStates"
  | "isTablesHovered"
  | "setIsTablesHovered"
  | "schemaPickerOpen"
  | "setSchemaPickerOpen"
  | "suppressTableReferenceClickRef"
  | "highlightMatch"
  | "renderObjectActions"
  | "renderSchemaObjects"
  | "renderConnection"
  | "renderSchemaVisibilityPicker";
type SchemaMenuContext = Parameters<typeof createExplorerSchemaMenus>[0];
type SchemaObjectsContext = Parameters<typeof createSchemaObjectsRenderer>[0];
type ConnectionTreeContext = Parameters<typeof createConnectionTreeRenderer>[0];

// Keep one source type per field. Each renderer still checks the assembled
// context at its call site without intersecting duplicate callback signatures.
type ExplorerSidebarPresentationProps = Omit<
  ExplorerSidebarViewContext &
    Omit<SchemaMenuContext, keyof ExplorerSidebarViewContext> &
    Omit<
      SchemaObjectsContext,
      keyof ExplorerSidebarViewContext | keyof SchemaMenuContext
    > &
    Omit<
      ConnectionTreeContext,
      | keyof ExplorerSidebarViewContext
      | keyof SchemaMenuContext
      | keyof SchemaObjectsContext
    >,
  OwnedPresentationKey
>;

export function ExplorerSidebarPresentation(
  props: ExplorerSidebarPresentationProps,
) {
  const [expandedSchemaObjectMemberKeys, setExpandedSchemaObjectMemberKeys] =
    useState<string[]>([]);
  const [schemaObjectMemberStates, setSchemaObjectMemberStates] = useState<
    Record<
      string,
      { loading: boolean; error: boolean; members: SchemaObjectInfo[] }
    >
  >({});
  const [isTablesHovered, setIsTablesHovered] = useState(false);
  const [schemaPickerOpen, setSchemaPickerOpen] = useState(false);
  const suppressTableReferenceClickRef = useRef(false);
  const highlightMatch = (text: string, filter: string) => {
    if (!filter) return <span>{text}</span>;

    const index = text.toLowerCase().indexOf(filter.toLowerCase());
    if (index === -1) return <span>{text}</span>;

    const before = text.slice(0, index);
    const match = text.slice(index, index + filter.length);
    const after = text.slice(index + filter.length);

    return (
      <span>
        {before}
        <span className="bg-primary text-primary-foreground font-bold">
          {match}
        </span>
        {after}
      </span>
    );
  };
  const context = {
    ...props,
    expandedSchemaObjectMemberKeys,
    setExpandedSchemaObjectMemberKeys,
    schemaObjectMemberStates,
    setSchemaObjectMemberStates,
    isTablesHovered,
    setIsTablesHovered,
    schemaPickerOpen,
    setSchemaPickerOpen,
    suppressTableReferenceClickRef,
    highlightMatch,
  };
  const { renderSchemaVisibilityPicker, renderObjectActions } =
    createExplorerSchemaMenus(context);
  const { renderSchemaObjects } = createSchemaObjectsRenderer({
    ...context,
    renderObjectActions,
  });
  const { renderConnection } = createConnectionTreeRenderer({
    ...context,
    renderSchemaVisibilityPicker,
    renderSchemaObjects,
  });
  return (
    <ExplorerSidebarView {...context} renderConnection={renderConnection} />
  );
}
