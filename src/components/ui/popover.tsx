"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { popupVariants } from "@/styles/variants/popup";

const Popover = PopoverPrimitive.Root;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverTrigger = PopoverPrimitive.Trigger;

export const POPOVER_VIEWPORT_COLLISION_PADDING = 8;
export const POPOVER_VIEWPORT_CLASSES =
  "max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto";

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      collisionPadding = POPOVER_VIEWPORT_COLLISION_PADDING,
      ...props
    },
    ref,
  ) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        popupVariants({ kind: "menu" }),
        "z-50 w-72 p-4 outline-none",
        POPOVER_VIEWPORT_CLASSES,
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverTrigger, PopoverContent };
