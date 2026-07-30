export type DiffLine = {
  kind: "add" | "remove" | "context" | "hunk" | "meta";
  oldLine: number | null;
  newLine: number | null;
  hunkIndex: number | null;
  content: string;
};

export function unifiedDiffLines(patch: string): DiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let hunkIndex: number | null = null;
  return patch.split("\n").map((content) => {
    const hunk = content.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      hunkIndex = hunkIndex === null ? 0 : hunkIndex + 1;
      return { kind: "hunk", oldLine: null, newLine: null, hunkIndex, content };
    }
    if (content.startsWith("+") && !content.startsWith("+++")) {
      const line = {
        kind: "add" as const,
        oldLine: null,
        newLine,
        hunkIndex,
        content,
      };
      newLine += 1;
      return line;
    }
    if (content.startsWith("-") && !content.startsWith("---")) {
      const line = {
        kind: "remove" as const,
        oldLine,
        newLine: null,
        hunkIndex,
        content,
      };
      oldLine += 1;
      return line;
    }
    if (content.startsWith(" ")) {
      const line = {
        kind: "context" as const,
        oldLine,
        newLine,
        hunkIndex,
        content,
      };
      oldLine += 1;
      newLine += 1;
      return line;
    }
    return {
      kind: "meta" as const,
      oldLine: null,
      newLine: null,
      hunkIndex,
      content,
    };
  });
}

export function unifiedDiffHunkPatch(
  patch: string,
  requestedHunkIndex: number,
): string | null {
  if (!Number.isInteger(requestedHunkIndex) || requestedHunkIndex < 0) {
    return null;
  }
  const lines = patch.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk < 0) return null;
  const hunkStarts = lines
    .map((line, index) => (line.startsWith("@@ ") ? index : -1))
    .filter((index) => index >= 0);
  const start = hunkStarts[requestedHunkIndex];
  if (start === undefined) return null;
  const end = hunkStarts[requestedHunkIndex + 1] ?? lines.length;
  return [...lines.slice(0, firstHunk), ...lines.slice(start, end)].join("\n");
}
