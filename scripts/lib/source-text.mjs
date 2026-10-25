import { readFileSync } from "node:fs";

/** Keep source assertions independent of the checkout's line-ending policy. */
export function readSourceText(file) {
  return readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}
