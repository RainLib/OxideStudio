/**
 * Replaces Console comments with spaces while preserving offsets and strings.
 * Elasticsearch receives JSON rather than JSONC, so the same representation
 * can be used for local validation and transport preparation.
 */
export function maskElasticsearchConsoleComments(source: string) {
  const output = source.split("");
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let lineHasOnlyWhitespace = true;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === "\n") {
      inLineComment = false;
      lineHasOnlyWhitespace = true;
      continue;
    }

    if (inLineComment) {
      output[index] = " ";
      continue;
    }

    if (inBlockComment) {
      output[index] = " ";
      if (character === "*" && next === "/") {
        output[index + 1] = " ";
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      lineHasOnlyWhitespace = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      lineHasOnlyWhitespace = false;
      continue;
    }

    if (character === "/" && next === "/" && source[index - 1] !== ":") {
      output[index] = " ";
      output[index + 1] = " ";
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && lineHasOnlyWhitespace) {
      output[index] = " ";
      inLineComment = true;
      continue;
    }

    if (!/\s/.test(character)) lineHasOnlyWhitespace = false;
  }

  return output.join("");
}
