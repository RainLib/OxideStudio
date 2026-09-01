export type ExplorerObjectIconKind = "schema" | "table" | "view";

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
      return "text-sky-400/85";
  }
}
