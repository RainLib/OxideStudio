import { cva } from "class-variance-authority";

/** Shared appearance for body portals as well as inline workbench overlays. */
export const popupVariants = cva("wb-popup border border-border bg-popover text-popover-foreground outline-none", {
  variants: {
    kind: {
      dialog: "wb-dialog rounded-lg shadow-[var(--wb-popup-dialog-shadow)]",
      menu: "wb-floating rounded-md shadow-[var(--wb-popup-menu-shadow)]",
      tooltip: "wb-tooltip rounded-md shadow-[var(--wb-popup-menu-shadow)]",
    },
  },
  defaultVariants: { kind: "menu" },
});
