"use client";

import * as React from "react";
import * as TooltipPrimitives from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";
import { popupVariants } from "@/styles/variants/popup";

const TooltipProvider = TooltipPrimitives.Provider;

const Tooltip = TooltipPrimitives.Root;

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitives.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitives.Trigger>
>((props, ref) => <TooltipPrimitives.Trigger ref={ref} data-wb-tooltip-trigger="" {...props}/>);
TooltipTrigger.displayName = TooltipPrimitives.Trigger.displayName;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitives.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitives.Portal>
    <TooltipPrimitives.Content
      ref={ref}
      collisionPadding={8}
      sideOffset={sideOffset}
      className={cn(
        popupVariants({ kind: "tooltip" }),
        "z-50 overflow-hidden px-3 py-1.5 text-sm",
        className
      )}
      {...props}
    />
  </TooltipPrimitives.Portal>
));
TooltipContent.displayName = TooltipPrimitives.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
