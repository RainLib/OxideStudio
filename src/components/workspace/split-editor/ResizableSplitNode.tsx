import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import type { EditorLayoutNode, EditorSplitNode } from "@/store/useEditorGroupStore";

export function ResizableSplitNode({
  node,
  renderNode,
}: {
  node: EditorSplitNode;
  renderNode: (node: EditorLayoutNode) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(50);
  const horizontal = node.direction === "left" || node.direction === "right";

  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const resize = (moveEvent: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const rawRatio = horizontal
        ? ((moveEvent.clientX - rect.left) / rect.width) * 100
        : ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setRatio(Math.max(15, Math.min(85, rawRatio)));
    };
    const stop = () => {
      document.removeEventListener("mousemove", resize);
      document.removeEventListener("mouseup", stop);
    };
    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stop);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1",
        horizontal ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="min-h-0 min-w-0"
        style={{ flexBasis: `calc(${ratio}% - 2px)` }}
      >
        {renderNode(node.children[0])}
      </div>
      <div
        className={cn(
          "shrink-0 bg-[hsl(var(--wb-border))]",
          horizontal
            ? "w-1 cursor-col-resize hover:bg-[hsl(var(--wb-accent)/0.65)]"
            : "h-1 cursor-row-resize hover:bg-[hsl(var(--wb-accent)/0.65)]",
        )}
        onMouseDown={startResize}
        aria-hidden="true"
      />
      <div
        className="min-h-0 min-w-0"
        style={{ flexBasis: `calc(${100 - ratio}% - 2px)` }}
      >
        {renderNode(node.children[1])}
      </div>
    </div>
  );
}
