import { quoteIdentifier } from "@/features/database-drivers/model/sqlIdentifiers";
import type { DatabaseDriver } from "@/services/tauri/types";
import type { SqlCompletionIdentifierFragment } from "../sqlCompletionTriggerPolicy";

/** Return the whole member suffix, retaining path punctuation and SQL text. */
export function cachedIdentifierRange(monaco: any, model: any, position: any, fragment: SqlCompletionIdentifierFragment) {
  const word = model.getWordUntilPosition(position),
    line: string = model.getLineContent?.(position.lineNumber) || "";
  let end = position.column - 1;
  if (fragment.closingQuote) {
    while (end < line.length) {
      if (line[end] === fragment.closingQuote) {
        if (line[end + 1] === fragment.closingQuote) {
          end += 2;
          continue;
        }
        end++;
        break;
      }
      end++;
    }
  } else {
    for (const character of line.slice(end)) {
      if (!/[$@#_\u200c\u200d\p{ID_Continue}]/u.test(character)) break;
      end += character.length;
    }
  }
  return new monaco.Range(position.lineNumber, fragment.replacementLength ? position.column - fragment.replacementLength : word.startColumn, position.lineNumber, Math.max(position.column, end + 1));
}
export function cachedIdentifierInsertion(value: string, fragment: SqlCompletionIdentifierFragment, driver?: DatabaseDriver) {
  if (fragment.openingQuote && fragment.closingQuote) {
    return fragment.openingQuote + value.split(fragment.closingQuote).join(fragment.closingQuote + fragment.closingQuote) + fragment.closingQuote;
  }
  // Metadata names are atoms: an embedded dot must never become a path.
  const caseNeedsQuote = driver && (["postgres", "postgresql", "cockroachdb", "yugabytedb", "neon", "supabase", "timescaledb"].includes(driver) && /[A-Z]/u.test(value) || driver === "oracle" && /[a-z]/u.test(value));
  if (driver && (caseNeedsQuote || !/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(value) || /^(?:select|from|where|join|order|group|by|table|with|union|user|values|limit|key|index|window|over|qualify|returning)$/iu.test(value))) return quoteIdentifier(driver, value);
  return value;
}
