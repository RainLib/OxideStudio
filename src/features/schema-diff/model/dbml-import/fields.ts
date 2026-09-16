import {
  matchingPair,
  parseIdentifierPath,
  readIdentifier,
  splitTopLevel,
} from "@/features/schema-diff/model/dbml-import/lexical";
import {
  findSettingsStart,
  parseSettings,
  settingText,
} from "@/features/schema-diff/model/dbml-import/settings";
import type { ColumnInfo, IndexInfo } from "@/services/tauri/types";

export function parseColumn(
  line: string,
  warnings: Set<string>,
  tableName: string,
): {
  column: ColumnInfo;
  reference?: string;
  referenceDelete?: string;
  referenceUpdate?: string;
} | null {
  const token = readIdentifier(line, 0);
  if (!token) {
    warnings.add(`${tableName}: an unsupported column definition was ignored.`);
    return null;
  }
  const rest = line.slice(token.end).trim();
  const settingsStart = findSettingsStart(rest);
  const dataType = (
    settingsStart >= 0 ? rest.slice(0, settingsStart) : rest
  ).trim();
  if (!dataType) {
    warnings.add(`${tableName}.${token.value}: column type is required.`);
    return null;
  }
  const settings =
    settingsStart >= 0
      ? parseSettings(rest.slice(settingsStart), warnings)
      : new Map<string, string | true>();
  return {
    column: {
      name: token.value,
      data_type: dataType,
      is_nullable: !settings.has("not null") && !settings.has("pk"),
      is_primary_key: settings.has("pk"),
      is_unique: settings.has("unique") || settings.has("pk"),
      is_indexed: settings.has("pk") || settings.has("unique"),
      is_auto_increment: settings.has("increment"),
      default_value: settingText(settings.get("default")),
      comment: settingText(settings.get("note")),
    },
    reference: settingText(settings.get("ref")),
    referenceDelete: settingText(settings.get("delete")),
    referenceUpdate: settingText(settings.get("update")),
  };
}

export function parseIndex(
  line: string,
  tableName: string,
  warnings: Set<string>,
): IndexInfo | null {
  if (!line || /^(?:Note)\s*:/iu.test(line)) return null;
  const opening = line.indexOf("(");
  const settingsStart = findSettingsStart(line);
  const closing = opening >= 0 ? matchingPair(line, opening, "(", ")") : -1;
  if (opening >= 0 && closing < 0) {
    warnings.add(`${tableName}: unbalanced DBML index definition was ignored.`);
    return null;
  }
  const columnSource =
    opening >= 0
      ? line.slice(opening + 1, closing)
      : settingsStart >= 0
        ? line.slice(0, settingsStart)
        : line;
  const columns = splitTopLevel(columnSource, ",")
    .map((value) => {
      const candidate = value.trim();
      if (candidate.includes("(") || candidate.includes(")")) {
        warnings.add(
          `${tableName}: expression index ${candidate} requires manual review and was ignored.`,
        );
        return "";
      }
      const path = parseIdentifierPath(candidate);
      return path[path.length - 1] || "";
    })
    .filter(Boolean);
  if (columns.length === 0) {
    warnings.add(`${tableName}: an index without columns was ignored.`);
    return null;
  }
  const settings = parseSettings(
    opening >= 0
      ? line.slice(closing + 1)
      : settingsStart >= 0
        ? line.slice(settingsStart)
        : "",
    warnings,
  );
  const explicitName = settingText(settings.get("name"));
  return {
    name: explicitName || `${tableName}_${columns.join("_")}_idx`,
    columns,
    is_unique: settings.has("unique") || settings.has("pk"),
    is_primary: settings.has("pk"),
    index_type: settingText(settings.get("type")),
    comment: settingText(settings.get("note")),
  };
}
