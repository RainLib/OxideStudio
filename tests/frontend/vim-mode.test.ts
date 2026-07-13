import { describe, expect, it } from "vitest";
import {
  expandVimLeader,
  parseVimMappings,
  serializeVimMappings,
} from "@/lib/vimMappings";

describe("Vim mode configuration", () => {
  it("parses recursive and non-recursive mappings by mode", () => {
    const result = parseVimMappings([
      "nnoremap <leader>f /FROM<Enter>",
      "imap jj <Esc>",
      "vmap <leader>y \"+y",
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.mappings).toEqual([
      {
        mode: "normal",
        lhs: "<leader>f",
        rhs: "/FROM<Enter>",
        recursive: false,
      },
      { mode: "insert", lhs: "jj", rhs: "<Esc>", recursive: true },
      {
        mode: "visual",
        lhs: "<leader>y",
        rhs: '"+y',
        recursive: true,
      },
    ]);
    expect(parseVimMappings(serializeVimMappings(result.mappings))).toEqual(
      result
    );
  });

  it("reports invalid and duplicate mappings", () => {
    const result = parseVimMappings("bad mapping\nnmap x dd\nnmap x yy");
    expect(result.mappings).toHaveLength(1);
    expect(result.errors).toEqual([
      "Line 1: expected a Vim map command",
      "Line 3: duplicate mapping for x",
    ]);
  });

  it("expands leader tokens case-insensitively", () => {
    expect(expandVimLeader("<Leader>f<leader>b", "<Space>")).toBe(
      "<Space>f<Space>b"
    );
  });
});
