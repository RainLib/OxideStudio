import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export function OptionMenu({
  ariaLabel,
  options,
  selected,
  disabled,
  onSelect,
}: {
  ariaLabel: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const checked = option.id === selected;
        return (
          <label
            key={option.id}
            className={cn(
              "flex min-h-10 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[10px] outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-within:ring-1 focus-within:ring-[hsl(var(--wb-accent))]",
              checked && "bg-[hsl(var(--wb-active))]",
              (disabled || option.disabled) && "cursor-default opacity-45",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={ariaLabel}
              value={option.id}
              checked={checked}
              disabled={disabled || option.disabled}
              onChange={() => onSelect(option.id)}
              aria-label={option.label}
            />
            <span className="min-w-0 flex-1">
              <span className="block">{option.label}</span>
              {option.description && (
                <span className="block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  {option.description}
                </span>
              )}
            </span>
            {checked && (
              <Check
                size={12}
                className="shrink-0 text-[hsl(var(--wb-text-muted))]"
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
