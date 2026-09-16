import type { ConstraintInfo } from "@/services/tauri/types";

export function uniqueConstraintName(
  constraints: ConstraintInfo[],
  preferred: string,
) {
  if (!constraints.some((constraint) => constraint.name === preferred))
    return preferred;
  let suffix = 2;
  while (
    constraints.some(
      (constraint) => constraint.name === `${preferred}_${suffix}`,
    )
  ) {
    suffix += 1;
  }
  return `${preferred}_${suffix}`;
}

export function uniqueName(names: Set<string>, preferred: string) {
  if (!names.has(preferred)) return preferred;
  let suffix = 2;
  while (names.has(`${preferred}_${suffix}`)) suffix += 1;
  return `${preferred}_${suffix}`;
}
