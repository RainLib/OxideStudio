import { Columns3 } from "lucide-react";
import { type ReactNode } from "react";

export function InspectorSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Columns3;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[hsl(var(--wb-border-subtle))]">
      <div className="flex h-8 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[9px] font-medium">
        <Icon size={10} className="wb-muted" /> {title}
      </div>
      {children}
    </section>
  );
}
