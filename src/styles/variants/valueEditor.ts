import { cva, type VariantProps } from "class-variance-authority";

export const valueEditorStateButtonVariants = cva(
  "group flex w-full items-start gap-2 rounded-[4px] border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      selected: {
        true: "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
        false:
          "border-transparent text-[hsl(var(--wb-text-muted))] hover:border-[hsl(var(--wb-border))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
      },
    },
    defaultVariants: {
      selected: false,
    },
  },
);

export type ValueEditorStateButtonVariants = VariantProps<
  typeof valueEditorStateButtonVariants
>;
