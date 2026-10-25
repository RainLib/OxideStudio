import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { LockKeyhole, ShieldCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";

/** Keeps execution permission independent from the model-and-reasoning selector. */
export function AssistantAccessControl({
  accessMode,
  disabled,
  onAccessModeChange,
}: {
  accessMode: "restricted" | "full";
  disabled: boolean;
  onAccessModeChange: (mode: "restricted" | "full") => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const fullAccess = accessMode === "full";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-assistant-access-trigger="true"
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none",
              fullAccess && "text-amber-400",
            )}
            disabled={disabled}
            aria-label={t("assistant.access.aria", {
              mode: fullAccess
                ? t("assistant.access.full")
                : t("assistant.access.restricted"),
            })}
            title={
              fullAccess
                ? t("assistant.access.fullDescription")
                : t("assistant.access.restrictedDescription")
            }
          >
            {fullAccess ? (
              <ShieldAlert size={13} aria-hidden="true" />
            ) : (
              <LockKeyhole size={13} aria-hidden="true" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={7}
          className="w-[220px] p-1.5"
        >
          <p className="px-1.5 pb-1 pt-0.5 text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
            {t("assistant.access.title")}
          </p>
          <button
            type="button"
            className={cn(
              "flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
              !fullAccess && "bg-[hsl(var(--wb-active))]",
            )}
            onClick={() => {
              onAccessModeChange("restricted");
              setOpen(false);
            }}
          >
            <LockKeyhole size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block text-[10px] font-medium">
                {t("assistant.access.restricted")}
              </span>
              <span className="block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {t("assistant.access.restrictedDescription")}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={cn(
              "flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
              fullAccess && "bg-[hsl(var(--wb-active))]",
            )}
            onClick={() => {
              setOpen(false);
              setConfirmationOpen(true);
            }}
          >
            <ShieldCheck size={12} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              <span className="block text-[10px] font-medium">
                {t("assistant.access.full")}
              </span>
              <span className="block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {t("assistant.access.fullDescription")}
              </span>
            </span>
          </button>
        </PopoverContent>
      </Popover>

      <Dialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <DialogContent layout="custom" className="w-[420px] max-w-[calc(100vw-24px)] gap-0 p-0">
          <DialogHeader className="space-y-2 px-5 pb-4 pt-5 text-left">
            <DialogTitle className="text-[15px] font-semibold leading-5 tracking-normal">
              {t("assistant.access.confirmTitle")}
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
              {t("assistant.access.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 px-5 pb-5 sm:space-x-0">
            <button
              type="button"
              className="wb-text-button h-9 flex-1 px-4 text-[11px]"
              onClick={() => setConfirmationOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-amber-400/15 px-4 text-[11px] font-medium text-amber-400 outline-none transition-colors hover:bg-amber-400/22 focus-visible:ring-1 focus-visible:ring-amber-400"
              onClick={() => {
                onAccessModeChange("full");
                setConfirmationOpen(false);
              }}
            >
              <ShieldAlert size={13} aria-hidden="true" />
              {t("assistant.access.full")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
