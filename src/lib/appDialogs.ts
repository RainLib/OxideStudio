import { popupReturnFocus } from "./popupFocus";

export type AppDialogKind = "confirm" | "prompt" | "message";
export interface AppDialogOptions {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  signal?: AbortSignal;
}
export interface AppDialogRequest extends AppDialogOptions {
  id: number;
  kind: AppDialogKind;
  message: string;
  initialValue: string;
  closing: boolean;
  returnFocus: HTMLElement | null;
}
type Result = boolean | string | null;
type Pending = { request: AppDialogRequest; resolve: (value: Result) => void; cleanup: () => void; result: Result };
const listeners = new Set<() => void>();
let active: Pending | null = null;
let queue: Pending[] = [];
let nextId = 0;
let hosts = 0;
const emit = () => listeners.forEach((listener) => listener());
const cancelled = (kind: AppDialogKind) => kind === "confirm" ? false : null;

function request(kind: AppDialogKind, message: string, initialValue: string, options: AppDialogOptions): Promise<Result> {
  if (typeof document === "undefined" || !hosts || options.signal?.aborted) return Promise.resolve(cancelled(kind));
  return new Promise((resolve) => {
    const entry: Pending = {
      request: { ...options, id: ++nextId, kind, message, initialValue, closing: false, returnFocus: active?.request.returnFocus ?? popupReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null) },
      resolve, result: cancelled(kind), cleanup: () => options.signal?.removeEventListener("abort", abort),
    };
    function abort() {
      if (active === entry) decideAppDialog(entry.request.id, cancelled(kind));
      else { queue = queue.filter((pending) => pending !== entry); entry.cleanup(); resolve(cancelled(kind)); }
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (active) queue.push(entry);
    else { active = entry; emit(); }
  });
}

/** Confirms are destructive by default; Escape/close always resolves false. */
export function confirmAction(message: string, options: AppDialogOptions = {}): Promise<boolean> {
  return request("confirm", message, "", { destructive: true, ...options }) as Promise<boolean>;
}
export function promptValue(message: string, initialValue = "", options: AppDialogOptions = {}): Promise<string | null> {
  return request("prompt", message, initialValue, options) as Promise<string | null>;
}
export async function showMessage(message: string, options: AppDialogOptions = {}): Promise<void> {
  await request("message", message, "", options);
}
export const getAppDialogSnapshot = () => active?.request ?? null;
export function subscribeAppDialogs(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function attachAppDialogHost() {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts) return;
    const pending = [...(active ? [active] : []), ...queue];
    active = null; queue = [];
    pending.forEach((entry) => { entry.cleanup(); entry.resolve(cancelled(entry.request.kind)); });
    emit();
  };
}
export function decideAppDialog(id: number, result: Result) {
  if (!active || active.request.id !== id || active.request.closing) return;
  active.result = result;
  active.request = { ...active.request, closing: true };
  emit();
}
/** Resolve after Radix finishes its exit and focus restoration, then show the queue. */
export function finishAppDialog(id: number) {
  if (!active || active.request.id !== id || !active.request.closing) return;
  const finished = active;
  active = null;
  finished.cleanup();
  emit();
  finished.resolve(finished.result);
  queueMicrotask(() => {
    if (!hosts || active) return;
    active = queue.shift() ?? null;
    emit();
  });
}
