export type ExplorerObjectIconKind =
  | "schema"
  | "table"
  | "view"
  | "materialized-view"
  | "function"
  | "procedure"
  | "sequence"
  | "trigger"
  | "event"
  | "synonym"
  | "job"
  | "collection"
  | "search-index"
  | "key"
  | "package"
  | "type";

/**
 * Shared semantic palette for relation trees. Connection colors remain source
 * identity accents; these colors communicate the database object's role.
 */
export function explorerObjectIconClass(kind: ExplorerObjectIconKind): string {
  switch (kind) {
    case "schema":
      return "text-amber-400/90";
    case "table":
      return "text-emerald-400/85";
    case "view":
      return "text-violet-400/85";
    case "materialized-view":
      return "text-indigo-400/85";
    case "function":
      return "text-amber-400/85";
    case "procedure":
      return "text-sky-400/85";
    case "sequence":
      return "text-emerald-400/80";
    case "trigger":
      return "text-orange-400/85";
    case "event":
      return "text-orange-300/85";
    case "synonym":
      return "text-sky-400/85";
    case "job":
      return "text-orange-400/85";
    case "collection":
      return "text-emerald-400/85";
    case "search-index":
      return "text-emerald-300/90";
    case "key":
      return "text-red-400/85";
    case "package":
      return "text-cyan-400/85";
    case "type":
      return "text-violet-400/85";
  }
}
