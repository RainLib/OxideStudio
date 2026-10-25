import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useI18n } from "@/i18n";
import { attachAppDialogHost, decideAppDialog, finishAppDialog, getAppDialogSnapshot, subscribeAppDialogs, type AppDialogRequest } from "@/lib/appDialogs";
import { Button } from "./button";
import { Input } from "./input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

export function AppDialogHost() {
  const request = useSyncExternalStore(subscribeAppDialogs, getAppDialogSnapshot, () => null);
  useLayoutEffect(attachAppDialogHost, []);
  return request ? <AppDialog key={request.id} request={request}/> : null;
}

function AppDialog({ request }: { request: AppDialogRequest }) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [value, setValue] = useState(request.initialValue);
  const cancel = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => decideAppDialog(request.id, request.kind === "confirm" ? false : null);
  const accept = () => decideAppDialog(request.id, request.kind === "prompt" ? value : true);
  const title = request.title ?? (request.kind === "confirm" ? zh ? "确认操作" : "Confirm action" : request.kind === "prompt" ? zh ? "输入内容" : "Enter a value" : zh ? "提示" : "Notice");
  return <Dialog open={!request.closing} onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent
      className="z-[90]"
      overlayClassName="z-[90]"
      onOpenAutoFocus={(event) => { event.preventDefault(); (request.kind === "prompt" ? input.current : cancel.current)?.focus(); input.current?.select(); }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (request.returnFocus?.isConnected) request.returnFocus.focus({ preventScroll: true });
        finishAppDialog(request.id);
      }}
      onPointerDownOutside={(event) => { if (request.kind === "confirm") event.preventDefault(); }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">{request.destructive ? <AlertTriangle size={16} data-popup-danger aria-hidden="true"/> : <Info size={16} aria-hidden="true"/>}{title}</DialogTitle>
        <DialogDescription className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words">{request.message}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); accept(); }} className="min-w-0">
        {request.kind === "prompt" && <Input ref={input} aria-label={title} value={value} onChange={(event) => setValue(event.target.value)} className="mb-5"/>}
        <DialogFooter>
          {request.kind !== "message" && <Button ref={cancel} type="button" variant="outline" onClick={close}>{zh ? "取消" : "Cancel"}</Button>}
          <Button ref={request.kind === "message" ? cancel : undefined} type="submit" variant={request.destructive ? "destructive" : "default"}>{request.confirmLabel ?? (zh ? "确定" : "Continue")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
