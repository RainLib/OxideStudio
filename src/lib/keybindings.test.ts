import { describe, expect, it } from "vitest";
import { isExplorerRefreshShortcut } from "./keybindings";

const event = (
  overrides: Partial<Parameters<typeof isExplorerRefreshShortcut>[0]> = {},
) => ({
  key: "r",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("Database Explorer refresh shortcut", () => {
  it("accepts the platform primary modifier for R", () => {
    expect(
      isExplorerRefreshShortcut(event({ metaKey: true }), "MacIntel"),
    ).toBe(true);
    expect(
      isExplorerRefreshShortcut(event({ ctrlKey: true }), "Win32"),
    ).toBe(true);
    expect(
      isExplorerRefreshShortcut(event({ ctrlKey: true }), "Linux x86_64"),
    ).toBe(true);
  });

  it("keeps Ctrl+R distinct from Command+R on Apple platforms", () => {
    expect(
      isExplorerRefreshShortcut(event({ ctrlKey: true }), "MacIntel"),
    ).toBe(false);
  });

  it("accepts only an unmodified F5 fallback", () => {
    expect(isExplorerRefreshShortcut(event({ key: "F5" }), "Win32")).toBe(
      true,
    );
    expect(
      isExplorerRefreshShortcut(
        event({ key: "F5", ctrlKey: true }),
        "Win32",
      ),
    ).toBe(false);
  });

  it("rejects composition, alternate modifiers, and unrelated keys", () => {
    expect(
      isExplorerRefreshShortcut(
        event({ ctrlKey: true, isComposing: true }),
        "Win32",
      ),
    ).toBe(false);
    expect(
      isExplorerRefreshShortcut(
        event({ ctrlKey: true, shiftKey: true }),
        "Win32",
      ),
    ).toBe(false);
    expect(
      isExplorerRefreshShortcut(event({ key: "x", ctrlKey: true }), "Win32"),
    ).toBe(false);
  });
});
