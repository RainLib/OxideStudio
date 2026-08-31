import {
  explorerTableReferenceDropEvent,
  explorerTableReferenceHoverEvent,
  OXIDE_TABLE_REFERENCE_DRAG_END_EVENT,
  type ExplorerTableReferencePayload,
} from "./explorerTableReferenceDrop";

const DRAG_THRESHOLD_PX = 5;
const SQL_DROP_TARGET_SELECTOR = '[data-sql-table-drop-target="true"]';

type ExplorerTableReferenceDragOptions = {
  payload: ExplorerTableReferencePayload;
  label: string;
  onFinish?: (dragged: boolean) => void;
};

function createDragChip(label: string) {
  const chip = document.createElement("div");
  chip.dataset.oxideTableReferenceDrag = "true";
  chip.textContent = label;
  Object.assign(chip.style, {
    position: "fixed",
    zIndex: "2147483646",
    pointerEvents: "none",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "5px 8px",
    borderRadius: "6px",
    border: "1px solid hsl(var(--wb-accent) / 0.5)",
    background: "hsl(var(--wb-panel-raised))",
    color: "hsl(var(--wb-text))",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
    fontSize: "11px",
    lineHeight: "16px",
  });
  document.body.appendChild(chip);
  return chip;
}

function pointIsOverSqlDropTarget(clientX: number, clientY: number) {
  return Boolean(
    document
      .elementFromPoint(clientX, clientY)
      ?.closest(SQL_DROP_TARGET_SELECTOR),
  );
}

export function beginExplorerTableReferenceDrag(
  startEvent: MouseEvent,
  options: ExplorerTableReferenceDragOptions,
) {
  if (startEvent.button !== 0) return () => undefined;
  startEvent.preventDefault();
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  const previousCursor = document.body.style.cursor;
  let dragging = false;
  let chip: HTMLDivElement | null = null;
  let finished = false;

  const moveChip = (
    clientX: number,
    clientY: number,
    overTarget: boolean,
  ) => {
    if (!chip) return;
    chip.style.left = `${clientX + 12}px`;
    chip.style.top = `${clientY + 12}px`;
    chip.style.borderColor = overTarget
      ? "hsl(var(--wb-accent))"
      : "hsl(var(--wb-border))";
  };

  const cleanup = () => {
    if (finished) return;
    finished = true;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("blur", onWindowBlur);
    chip?.remove();
    document.body.style.cursor = previousCursor;
    window.dispatchEvent(new Event(OXIDE_TABLE_REFERENCE_DRAG_END_EVENT));
    options.onFinish?.(dragging);
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!dragging) {
      const distance = Math.hypot(
        event.clientX - startX,
        event.clientY - startY,
      );
      if (distance < DRAG_THRESHOLD_PX) return;
      dragging = true;
      chip = createDragChip(options.label);
      document.body.style.cursor = "copy";
      document.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    const overTarget = pointIsOverSqlDropTarget(
      event.clientX,
      event.clientY,
    );
    moveChip(event.clientX, event.clientY, overTarget);
    if (overTarget) {
      window.dispatchEvent(
        explorerTableReferenceHoverEvent({
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    }
  };

  const onMouseUp = (event: MouseEvent) => {
    if (
      dragging &&
      pointIsOverSqlDropTarget(event.clientX, event.clientY)
    ) {
      window.dispatchEvent(
        explorerTableReferenceDropEvent({
          payload: options.payload,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    }
    cleanup();
  };

  const onWindowBlur = () => cleanup();
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("blur", onWindowBlur);
  return cleanup;
}
