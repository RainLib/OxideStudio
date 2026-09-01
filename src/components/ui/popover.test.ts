import { describe, expect, it } from "vitest";
import {
  POPOVER_VIEWPORT_CLASSES,
  POPOVER_VIEWPORT_COLLISION_PADDING,
} from "./popover";

describe("popover viewport constraints", () => {
  it("keeps floating content away from every viewport edge", () => {
    expect(POPOVER_VIEWPORT_COLLISION_PADDING).toBe(8);
  });

  it("uses Radix available height and scrolls overflow without horizontal spill", () => {
    expect(POPOVER_VIEWPORT_CLASSES).toContain(
      "max-h-[var(--radix-popover-content-available-height)]",
    );
    expect(POPOVER_VIEWPORT_CLASSES).toContain("max-w-[calc(100vw-1rem)]");
    expect(POPOVER_VIEWPORT_CLASSES).toContain("overflow-x-hidden");
    expect(POPOVER_VIEWPORT_CLASSES).toContain("overflow-y-auto");
  });
});
