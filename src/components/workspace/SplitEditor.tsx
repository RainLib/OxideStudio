import type { ReactNode } from "react";
import type { EditorLayoutNode } from "@/store/useEditorGroupStore";
import { EditorGroupPane } from "./split-editor/EditorGroupPane";
import { ResizableSplitNode } from "./split-editor/ResizableSplitNode";
import { useSplitEditorController } from "./split-editor/useSplitEditorController";

/** Stable composition entry point for the multi-pane query editor. */
export function SplitEditor() {
  const controller = useSplitEditorController();

  const renderNode = (node: EditorLayoutNode): ReactNode =>
    node.type === "group" ? (
      <EditorGroupPane group={node} {...controller} />
    ) : (
      <ResizableSplitNode key={node.id} node={node} renderNode={renderNode} />
    );

  return <>{renderNode(controller.root)}</>;
}
