export const DEFAULT_PROJECT_FILE_FILTER = "*";

function isGlobFilter(filter: string) {
  const characters = [...filter];
  if (!characters.some((character) => character === "*" || character === "?")) {
    return false;
  }
  return characters.every((character, index) => {
    if (/^[\\()[\]{}^$|+]$/.test(character)) return false;
    return !(
      (character === "*" || character === "?") &&
      index > 0 &&
      characters[index - 1] === "."
    );
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileProjectFileFilter(rawFilter: string): RegExp {
  const filter = rawFilter.trim() || DEFAULT_PROJECT_FILE_FILTER;
  if (!isGlobFilter(filter)) return new RegExp(filter, "i");
  const pattern = [...filter]
    .map((character) =>
      character === "*" ? ".*" : character === "?" ? "." : escapeRegex(character),
    )
    .join("");
  return new RegExp(`^${pattern}$`, "i");
}
