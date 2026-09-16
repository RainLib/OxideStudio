import { Switch } from "@/components/ui/switch";
import { type LucideIcon } from "lucide-react";

export function ContextFact({
  icon: Icon,
  label,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-[5px] px-1 py-1.5">
      <Icon size={12} className="mt-0.5 shrink-0 wb-muted" />
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        <div
          className="mt-0.5 truncate text-[9px] text-[hsl(var(--wb-text-muted))]"
          title={detail}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

export function ContextToggle({
  icon: Icon,
  label,
  detail,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const controlId = `assistant-context-${label
    .toLowerCase()
    .replace(/\s+/gu, "-")}`;
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-[5px] px-1 py-1.5 hover:bg-[hsl(var(--wb-hover)/0.45)]">
      <Icon size={12} className="mt-0.5 shrink-0 wb-muted" />
      <label className="min-w-0 flex-1 cursor-pointer" htmlFor={controlId}>
        <span className="block">{label}</span>
        <span className="mt-0.5 block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {detail}
        </span>
      </label>
      <Switch
        id={controlId}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 h-4 w-7 border-0 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border-strong))] [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
      />
    </div>
  );
}

export function ContextSample({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
        {label}
      </div>
      <div className="max-h-12 overflow-hidden rounded-[4px] bg-[hsl(var(--wb-editor))] px-2 py-1.5 font-mono text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        {value}
      </div>
    </div>
  );
}
