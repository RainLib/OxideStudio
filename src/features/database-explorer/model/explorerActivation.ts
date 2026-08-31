export type ExplorerActivationMode = "single" | "double";

export type ExplorerPointerActivationPhase = "click" | "double-click";

/**
 * Keep pointer activation deterministic across React's click/double-click
 * sequence. A physical double click dispatches two click events before the
 * double-click event, so single-click mode accepts only the first click and
 * double-click mode accepts only the final phase.
 */
export function shouldActivateExplorerObject(
  mode: ExplorerActivationMode,
  phase: ExplorerPointerActivationPhase,
  clickDetail = 1,
) {
  if (phase === "double-click") return mode === "double";
  // Keyboard/programmatic HTMLElement.click() dispatches detail=0. Treat it
  // as one activation while still ignoring the second pointer click (detail=2).
  return mode === "single" && clickDetail <= 1;
}

export function explorerActivationLabel(mode: ExplorerActivationMode) {
  return mode === "single" ? "Click" : "Double-click";
}
