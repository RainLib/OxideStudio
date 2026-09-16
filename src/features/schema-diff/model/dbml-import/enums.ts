import {
  readIdentifier,
  unquote,
} from "@/features/schema-diff/model/dbml-import/lexical";
import { removeTrailingSettings } from "@/features/schema-diff/model/dbml-import/settings";

export const MAX_DBML_ENUM_VALUES = 4_096;

export const MAX_DBML_ENUM_VALUE_LENGTH = 4_096;

export function parseEnumValues(
  body: string,
  enumName: string,
  warnings: Set<string>,
) {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split(/\r?\n/u)) {
    const source = line.trim();
    if (!source || /^Note\s*:/iu.test(source)) continue;
    const valueSource = removeTrailingSettings(source);
    if (valueSource !== source) {
      warnings.add(
        `${enumName}: enum value settings and notes are review-only and were omitted.`,
      );
    }
    const token = readEnumValue(valueSource);
    if (!token || token.end !== valueSource.length) {
      warnings.add(
        `${enumName}: unsupported enum value ${enumValuePreview(valueSource)} was ignored.`,
      );
      continue;
    }
    if (token.value.length > MAX_DBML_ENUM_VALUE_LENGTH) {
      warnings.add(
        `${enumName}: an enum value exceeded ${MAX_DBML_ENUM_VALUE_LENGTH} characters and was ignored.`,
      );
      continue;
    }
    if (seen.has(token.value)) {
      warnings.add(
        `${enumName}.${enumValuePreview(token.value)}: duplicate enum value was ignored.`,
      );
      continue;
    }
    if (values.length >= MAX_DBML_ENUM_VALUES) {
      warnings.add(
        `${enumName}: enum values were limited to ${MAX_DBML_ENUM_VALUES} entries.`,
      );
      break;
    }
    seen.add(token.value);
    values.push(token.value);
  }
  if (values.length === 0) {
    warnings.add(
      `Enum ${enumName} has no supported values and remains descriptor-only.`,
    );
  }
  return values;
}

export function enumValuePreview(value: string) {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`;
}

export function readEnumValue(value: string) {
  const token = readIdentifier(value, 0);
  if (token) return token;
  if (!value.startsWith("'")) return null;
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "'" && value[index - 1] !== "\\") {
      return { value: unquote(value.slice(0, index + 1)), end: index + 1 };
    }
  }
  return null;
}
