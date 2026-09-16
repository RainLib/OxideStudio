export function normalizeEffortOptions(values?: readonly string[]) {
  if (!values?.length) return [];
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => Boolean(value) && value.toLowerCase() !== "enabled"),
    ),
  ];
}

export function effortRank(value: string) {
  const rank: Record<string, number> = {
    none: 0,
    minimal: 0,
    low: 1,
    medium: 2,
    high: 3,
    xhigh: 4,
    max: 5,
    ultra: 6,
  };
  return rank[value.toLowerCase()] ?? 50;
}

export function effortToneClass(value: string) {
  const rank = effortRank(value);
  if (rank >= 4 && rank < 50) return "text-[hsl(var(--wb-brand))]";
  if (rank >= 3 && rank < 50) return "text-[hsl(var(--wb-accent))]";
  return "text-[hsl(var(--wb-text-muted))]";
}

export function formatEffort(value: string, defaultLabel = "Default") {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "default") return defaultLabel;
  if (normalized === "xhigh") return "Extra high";
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character: string) => character.toUpperCase());
}
