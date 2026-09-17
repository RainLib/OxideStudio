import {
  effortRank,
  formatEffort,
} from "@/features/assistant-composer/model/reasoningEffort";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const PARTICLE_COUNT = 9;

export function ReasoningTrack({
  name,
  options,
  selected,
  disabled,
  onSelect,
  accelerated = false,
  compact = false,
}: {
  name: string;
  options: readonly string[];
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
  accelerated?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const values = ["default", ...options];
  const selectedIndex = Math.max(0, values.indexOf(selected));
  const fill =
    values.length > 1 ? (selectedIndex / (values.length - 1)) * 100 : 0;
  const selectedRank = effortRank(values[selectedIndex] ?? "default");
  const highestKnownRank = Math.max(
    0,
    ...options.map(effortRank).filter((rank) => rank < 50),
  );
  const maximumSelected =
    selectedIndex > 0 && selectedRank < 50 && selectedRank === highestKnownRank;
  const animated = selectedIndex > 0;
  const particleDuration = accelerated ? "760ms" : "1680ms";

  return (
    <div className={cn(compact ? "mt-1" : "mt-2")}>
      {!compact && (
        <div className="mb-1 flex items-center justify-between text-[9px] text-[hsl(var(--wb-text-muted))]">
          <span>{t("assistant.model.reasoningEffort")}</span>
          <span>{formatEffort(selected, t("assistant.model.default"))}</span>
        </div>
      )}
      <div className="group relative h-10 px-1">
        <div
          data-assistant-speed-tier={accelerated ? "priority" : "default"}
          data-assistant-reasoning-animation={
            animated ? (accelerated ? "fast" : "standard") : "none"
          }
          className="pointer-events-none absolute left-1 right-1 top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-full bg-[hsl(var(--wb-hover))]"
        >
          <div
            className={cn(
              "wb-assistant-energy-track relative h-full overflow-hidden rounded-full transition-[width,filter] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              accelerated && "wb-assistant-energy-track-fast",
            )}
            style={{ width: `${Math.max(fill, 8)}%` }}
          >
            {animated && (
              <div
                data-assistant-fast-particles="true"
                data-assistant-animation-speed={accelerated ? "2.2x" : "standard"}
                className="absolute inset-0 motion-reduce:hidden"
                aria-hidden="true"
              >
                {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
                  <span
                    key={index}
                    className="wb-assistant-fast-particle"
                    style={{
                      top: `${18 + ((index * 29) % 62)}%`,
                      animationDelay: `${index * -187}ms`,
                      animationDuration: particleDuration,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {!maximumSelected && (
          <div
            className="pointer-events-none absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between"
            aria-hidden="true"
          >
            {values.map((value, index) => (
              <span
                key={`${value}-${index}`}
                data-assistant-reasoning-stop="true"
                className={cn(
                  "h-1 w-1 rounded-full",
                  index <= selectedIndex ? "bg-white/75" : "bg-white/30",
                )}
              />
            ))}
          </div>
        )}
        <input
          type="range"
          data-assistant-reasoning-track="true"
          name={name}
          min={0}
          max={Math.max(0, values.length - 1)}
          step={1}
          value={selectedIndex}
          disabled={disabled}
          onChange={(event) =>
            onSelect(values[Number(event.target.value)] ?? "default")
          }
          aria-label={t("assistant.model.reasoningEffort")}
          aria-valuetext={formatEffort(
            values[selectedIndex] ?? "default",
            t("assistant.model.default"),
          )}
          className="absolute inset-x-1 top-1/2 z-20 h-8 w-[calc(100%-0.5rem)] -translate-y-1/2 cursor-ew-resize opacity-0 disabled:cursor-default"
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[hsl(var(--wb-text))] shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-[left,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            !disabled && "group-hover:scale-105",
          )}
          style={{ left: `calc(0.25rem + ${fill}% - ${fill / 200}rem)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
