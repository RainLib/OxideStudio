import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[820px] pb-8">{children}</div>;
}

export function SettingsDivider({
  title,
  first = false,
}: {
  title: string;
  first?: boolean;
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-2", !first && "mt-6")}>
      <span className="text-[12px] text-[hsl(var(--wb-text-muted))]">
        {title}
      </span>
      <span className="h-px flex-1 bg-[hsl(var(--wb-border-subtle))]" />
    </div>
  );
}

export function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 grid grid-cols-[150px_1fr] items-center gap-3">
      <label className="text-right text-[12px] text-[hsl(var(--wb-text))]">
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-3">{children}</div>
    </div>
  );
}

export function CheckboxLabel({
  label,
  checked,
  detail,
  onChange,
  readOnly,
}: {
  label: string;
  checked?: boolean;
  detail?: string;
  onChange?: () => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex min-h-7 items-center gap-2 text-[12px] text-[hsl(var(--wb-text))]">
      <input
        type="checkbox"
        checked={checked || false}
        onChange={onChange}
        readOnly={readOnly || !onChange}
        className="h-4 w-4 rounded-[3px] border border-[hsl(var(--wb-border))] accent-[hsl(var(--wb-accent))]"
      />
      <span>{label}</span>
      {detail && (
        <span className="text-[12px] text-[hsl(var(--wb-text-muted))]">
          {detail}
        </span>
      )}
    </label>
  );
}

export function SettingsInput({
  value,
  onChange,
  placeholder,
  type = "text",
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={inputClass}
    />
  );
}

export function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value) || min)}
      className={cn(inputClass, "w-[120px]")}
    />
  );
}

export function SettingsIconButton({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
    >
      {children}
    </button>
  );
}

export function SettingsButton({
  children,
  intent = "secondary",
  disabled,
  onClick,
}: {
  children: ReactNode;
  intent?: "primary" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 min-w-[72px] items-center justify-center rounded-[4px] border px-3 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
        intent === "primary"
          ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] hover:brightness-110"
          : "border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]",
      )}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "h-7 w-[360px] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";

export const selectClass =
  "h-7 w-[194px] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]";
