type JsonFrame = {
  kind: "object" | "array";
  ownerKey?: string;
  lastKey?: string;
  expectingKey: boolean;
};

export function clampOffset(source: string, offset: number) {
  return Math.max(0, Math.min(source.length, offset));
}

/** Tolerant scanner that remains useful while a JSON command is incomplete. */
export function scanJsonBeforeCursor(source: string, offset: number) {
  const before = source.slice(0, clampOffset(source, offset));
  const frames: JsonFrame[] = [];
  let inString = false;
  let stringStart = -1;
  let escaping = false;
  let pendingString: string | undefined;

  for (let index = 0; index < before.length; index += 1) {
    const character = before[index]!;
    if (inString) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') {
        inString = false;
        pendingString = before
          .slice(stringStart + 1, index)
          .replace(/\\"/gu, '"');
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      stringStart = index;
      escaping = false;
      continue;
    }
    if (/\s/u.test(character)) continue;
    if (character === ":") {
      const frame = frames[frames.length - 1];
      if (frame?.kind === "object" && pendingString !== undefined) {
        frame.lastKey = pendingString;
        frame.expectingKey = false;
      }
      pendingString = undefined;
    } else if (character === "{") {
      const parent = frames[frames.length - 1];
      frames.push({
        kind: "object",
        ownerKey: parent?.kind === "array" ? parent.ownerKey : parent?.lastKey,
        expectingKey: true,
      });
      pendingString = undefined;
    } else if (character === "[") {
      const parent = frames[frames.length - 1];
      frames.push({
        kind: "array",
        ownerKey: parent?.lastKey,
        expectingKey: false,
      });
      pendingString = undefined;
    } else if (character === "}" || character === "]") {
      frames.pop();
      pendingString = undefined;
    } else if (character === ",") {
      const frame = frames[frames.length - 1];
      if (frame?.kind === "object") frame.expectingKey = true;
      pendingString = undefined;
    }
  }
  return { before, frames, inString, stringStart };
}

export function activeCollection(source: string, offset: number) {
  const before = source.slice(0, clampOffset(source, offset));
  const matches = [
    ...before.matchAll(
      /"(?:collection|find|aggregate|count)"\s*:\s*"([^"\\]*)/gu,
    ),
  ];
  return matches[matches.length - 1]?.[1]?.trim() || undefined;
}
