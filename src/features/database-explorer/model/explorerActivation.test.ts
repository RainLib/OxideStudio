import { describe, expect, it } from "vitest";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "./explorerActivation";

describe("Database Explorer object activation", () => {
  it("runs a single-click action only for the first click event", () => {
    expect(shouldActivateExplorerObject("single", "click", 1)).toBe(true);
    expect(shouldActivateExplorerObject("single", "click", 0)).toBe(true);
    expect(shouldActivateExplorerObject("single", "click", 2)).toBe(false);
    expect(shouldActivateExplorerObject("single", "double-click", 2)).toBe(false);
  });

  it("runs a double-click action only in the double-click phase", () => {
    expect(shouldActivateExplorerObject("double", "click", 1)).toBe(false);
    expect(shouldActivateExplorerObject("double", "click", 2)).toBe(false);
    expect(shouldActivateExplorerObject("double", "double-click", 2)).toBe(true);
  });

  it("provides concise interaction copy", () => {
    expect(explorerActivationLabel("single")).toBe("Click");
    expect(explorerActivationLabel("double")).toBe("Double-click");
  });
});
