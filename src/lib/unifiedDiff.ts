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
