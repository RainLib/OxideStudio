import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";
import {
  iconButtonVariants,
  tabButtonVariants,
  toolbarButtonVariants,
} from "@/styles/variants/button";

const SHARED_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

describe("desktop button press feedback", () => {
  it.each(SHARED_VARIANTS)(
    "provides immediate, stationary feedback for %s buttons",
    (variant) => {
      const classes = buttonVariants({ variant });
      expect(classes).toMatch(/(?:^|\s)active:/u);
      expect(classes).not.toMatch(/active:(?:scale|translate|-translate)-/u);
    },
  );

  it("keeps specialized button variants responsive without moving targets", () => {
    const classes = [
      iconButtonVariants({ variant: "ghost" }),
      iconButtonVariants({ variant: "danger" }),
      iconButtonVariants({ variant: "active" }),
      iconButtonVariants({ variant: "orange" }),
      toolbarButtonVariants({ variant: "default" }),
      toolbarButtonVariants({ variant: "primary" }),
      toolbarButtonVariants({ variant: "secondary" }),
      toolbarButtonVariants({ variant: "outline" }),
      tabButtonVariants({ active: false }),
    ];
    for (const value of classes) {
      expect(value).toMatch(/(?:^|\s)active:/u);
      expect(value).not.toMatch(/active:(?:scale|translate|-translate)-/u);
    }
  });
});
