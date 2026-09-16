import {
  findTopLevel,
  matchingPair,
} from "@/features/schema-diff/model/dbml-import/lexical";

export type ExtractedBlock = {
  header: string;
  body: string;
  start: number;
  end: number;
};

export function extractBlocks(
  source: string,
  keyword: string,
  warnings: Set<string>,
): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  // Keep indentation separate from the keyword position. `\\s*` is not safe
  // here because it also consumes newlines and can make the calculated block
  // start point land in the preceding blank line.
  const pattern = new RegExp(`(^|\\n)([\\t ]*)${keyword}\\b`, "giu");
  for (const match of source.matchAll(pattern)) {
    const start =
      (match.index || 0) + (match[1]?.length || 0) + (match[2]?.length || 0);
    const opening = findTopLevel(source, "{", start + keyword.length);
    if (opening < 0) {
      warnings.add(`${keyword} block is missing an opening brace.`);
      continue;
    }
    const closing = matchingPair(source, opening, "{", "}");
    if (closing < 0) {
      warnings.add(`${keyword} block is missing a closing brace.`);
      continue;
    }
    blocks.push({
      header: source.slice(start + keyword.length, opening).trim(),
      body: source.slice(opening + 1, closing),
      start,
      end: closing + 1,
    });
  }
  const topLevel: ExtractedBlock[] = [];
  let activeParent: ExtractedBlock | undefined;
  for (const block of blocks) {
    if (activeParent && block.start >= activeParent.end)
      activeParent = undefined;
    if (
      activeParent &&
      block.start > activeParent.start &&
      block.end < activeParent.end
    )
      continue;
    topLevel.push(block);
    activeParent = block;
  }
  return topLevel;
}

export function replaceRangesWithWhitespace(
  source: string,
  ranges: Array<[number, number]>,
) {
  if (ranges.length === 0) return source;
  // Block offsets are UTF-16 string indices. Keep code units here so an emoji
  // before an indexes block cannot shift the replacement range.
  const characters = source.split("");
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  }
  return characters.join("");
}

export function stripComments(source: string, warnings: Set<string>) {
  return source
    .replace(/^\s*\/\/\s*WARNING:\s*(.+)$/gimu, (_match, warning: string) => {
      warnings.add(`Source warning: ${warning.trim()}`);
      return "";
    })
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/\/\/[^\r\n]*/gu, "");
}
