import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Pencil, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SchemaDiagramNote,
  SchemaDiagramNoteColor,
} from "@/services/schemaDiagramCanvasStore";

export function SchemaDiagramNoteNode({
  note,
  zoom,
  onEdit,
  onMove,
}: {
  note: SchemaDiagramNote;
  zoom: number;
  onEdit: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const [position, setPosition] = useState({ x: note.x, y: note.y });
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  useEffect(() => {
    if (!dragRef.current) setPosition({ x: note.x, y: note.y });
  }, [note.x, note.y]);

  const movePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      x: Math.max(0, drag.originX + (event.clientX - drag.clientX) / zoom),
      y: Math.max(0, drag.originY + (event.clientY - drag.clientY) / zoom),
    };
    drag.currentX = next.x;
    drag.currentY = next.y;
    setPosition(next);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onMove(drag.currentX, drag.currentY);
  };

  return (
    <div
      className={cn(
        "absolute z-20 overflow-hidden rounded-[6px] border shadow-[0_7px_18px_rgba(0,0,0,0.24)]",
        diagramNoteColorClass(note.color),
      )}
      style={{
        left: position.x,
        top: position.y,
        width: note.width,
        height: note.height,
      }}
    >
      <div className="flex h-7 items-center border-b border-black/10 bg-black/10">
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 cursor-grab items-center gap-1.5 px-2 text-left active:cursor-grabbing"
          aria-label="Move diagram note"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              originX: position.x,
              originY: position.y,
              currentX: position.x,
              currentY: position.y,
            };
          }}
          onPointerMove={movePointer}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 20 : 5;
            const delta = event.key === "ArrowLeft"
              ? { x: -step, y: 0 }
              : event.key === "ArrowRight"
                ? { x: step, y: 0 }
                : event.key === "ArrowUp"
                  ? { x: 0, y: -step }
                  : event.key === "ArrowDown"
                    ? { x: 0, y: step }
                    : null;
            if (!delta) return;
            event.preventDefault();
            const next = {
              x: Math.max(0, position.x + delta.x),
              y: Math.max(0, position.y + delta.y),
            };
            setPosition(next);
            onMove(next.x, next.y);
          }}
        >
          <StickyNote size={10} className="shrink-0 opacity-75" />
          <span className="truncate text-[8px] font-medium uppercase tracking-wide opacity-75">
            Project note
          </span>
        </button>
        <button
          type="button"
          className="mr-1 flex h-5 w-5 items-center justify-center rounded opacity-60 hover:bg-black/10 hover:opacity-100 focus-visible:ring-1 focus-visible:ring-current"
          onClick={onEdit}
          aria-label="Edit diagram note"
        >
          <Pencil size={9} />
        </button>
      </div>
      <button
        type="button"
        className="block h-[calc(100%-28px)] w-full overflow-hidden whitespace-pre-wrap p-2.5 text-left text-[9px] leading-4"
        onDoubleClick={onEdit}
        title="Double-click to edit"
      >
        {note.content}
      </button>
    </div>
  );
}

function diagramNoteColorClass(color: SchemaDiagramNoteColor) {
  if (color === "violet") {
    return "border-violet-300/40 bg-violet-200/95 text-violet-950";
  }
  if (color === "blue") {
    return "border-sky-300/40 bg-sky-200/95 text-sky-950";
  }
  if (color === "green") {
    return "border-emerald-300/40 bg-emerald-200/95 text-emerald-950";
  }
  if (color === "slate") {
    return "border-slate-300/40 bg-slate-200/95 text-slate-950";
  }
  return "border-amber-300/40 bg-amber-200/95 text-amber-950";
}
