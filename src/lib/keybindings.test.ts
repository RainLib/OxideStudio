import { describe, expect, it } from "vitest";
import {
  isExplorerRefreshShortcut,
  keybindingMatchesEvent,
} from "./keybindings";

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

describe("DataGrip-compatible workbench shortcuts", () => {
  it("maps Mod+1 to Command on macOS and Ctrl on Windows", () => {
    expect(
      keybindingMatchesEvent("mod+1", event({ key: "1", metaKey: true })),
    ).toBe(true);
    expect(
      keybindingMatchesEvent("mod+1", event({ key: "1", ctrlKey: true })),
    ).toBe(true);
  });

  it("recognizes function keys and modifier alternatives", () => {
    expect(keybindingMatchesEvent("f12", event({ key: "F12" }))).toBe(true);
    expect(
      keybindingMatchesEvent(
        "mod+shift+f12",
        event({ key: "F12", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      keybindingMatchesEvent(
        "alt+shift+b",
        event({ key: "b", altKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });
});
