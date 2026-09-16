export function dispatchWorkbenchActionEvent(eventName: string): void {
  window.dispatchEvent(new CustomEvent(eventName));
}
