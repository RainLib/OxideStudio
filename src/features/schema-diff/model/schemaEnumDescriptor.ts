const ENUM_VALUES_PREFIX = "Enum values: ";
const LEGACY_ENUM_VALUES_PREFIX = "Values: ";
const MAX_ENUM_VALUES = 4_096;
const MAX_ENUM_VALUE_LENGTH = 4_096;
const MAX_ENUM_DESCRIPTION_LENGTH = 256 * 1_024;

export function enumDescriptorDescription(values: readonly string[]) {
  const bounded = values
    .slice(0, MAX_ENUM_VALUES)
    .map((value) => value.slice(0, MAX_ENUM_VALUE_LENGTH));
  return `${ENUM_VALUES_PREFIX}${JSON.stringify(bounded)}`;
}

export function enumDescriptorValues(description: string | null | undefined) {
  if (!description || description.length > MAX_ENUM_DESCRIPTION_LENGTH) return null;
  if (description.startsWith(ENUM_VALUES_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(description.slice(ENUM_VALUES_PREFIX.length));
      if (
        !Array.isArray(parsed) ||
        parsed.length > MAX_ENUM_VALUES ||
        parsed.some((value) =>
          typeof value !== "string" || value.length > MAX_ENUM_VALUE_LENGTH
        )
      ) {
        return null;
      }
      return parsed as string[];
    } catch {
      return null;
    }
  }
  if (description.startsWith(LEGACY_ENUM_VALUES_PREFIX)) {
    return parseSqlEnumValues(description.slice(LEGACY_ENUM_VALUES_PREFIX.length));
  }
  return null;
}

function parseSqlEnumValues(source: string) {
  const values: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index] || "";
    if (quoted && character === "'" && source[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === "'") {
      quoted = !quoted;
      continue;
    }
    if ((character === "," && !quoted) || index === source.length) {
      const value = source.slice(start, index).trim();
      if (!/^'(?:[^']|'')*'$/u.test(value)) return null;
      values.push(value.slice(1, -1).replace(/''/gu, "'"));
      if (values.length > MAX_ENUM_VALUES) return null;
      start = index + 1;
    }
  }
  return values.every((value) => value.length <= MAX_ENUM_VALUE_LENGTH)
    ? values
    : null;
}
