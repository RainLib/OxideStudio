import { Play, Search, Layout } from "lucide-react";

interface ShortcutCardProps {
  icon: any;
  title: string;
  shortcuts: { lab: string; keys: string[] }[];
}

function ShortcutCard({ icon: Icon, title, shortcuts }: ShortcutCardProps) {
  return (
    <div className="flex flex-col p-4 sm:p-5 rounded-2xl bg-white/3 border border-white/5 shadow-inner hover:bg-white/5 hover:border-white/10 transition-all duration-300 group">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl bg-primary/10 text-primary group-hover:scale-110 transition-transform duration-500 shadow-sm border border-primary/5">
          <Icon size={16} strokeWidth={2.5} />
        </div>
        <h3 className="font-bold text-xs tracking-wider uppercase text-foreground/70 group-hover:text-foreground transition-colors">
          {title}
        </h3>
      </div>
      <div className="flex flex-col gap-2.5">
        {shortcuts.map((s) => (
          <div
            key={s.lab}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
              {s.lab}
            </span>
            <div className="flex gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="h-5 px-1.5 flex items-center justify-center bg-muted/30 border border-white/5 rounded-md font-mono text-[9px] text-muted-foreground/50 min-w-[18px] shadow-sm select-none"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QueryShortcuts() {
  const categories = [
    {
      title: "Navigation",
      icon: Search,
      shortcuts: [
        { lab: "Quick Search", keys: ["⌘", "P"] },
        { lab: "New Tab", keys: ["⌘", "T"] },
        { lab: "Find", keys: ["⌘", "F"] },
      ],
    },
    {
      title: "Execution",
      icon: Play,
      shortcuts: [
        { lab: "Run Query", keys: ["⌘", "Enter"] },
        { lab: "Run Current", keys: ["⇧", "⌘", "Enter"] },
        { lab: "Autocomplete", keys: ["^", "Space"] },
      ],
    },
    {
      title: "Window",
      icon: Layout,
      shortcuts: [
        { lab: "New Window", keys: ["⇧", "⌘", "N"] },
        { lab: "Close Tab", keys: ["⌘", "W"] },
        { lab: "Reopen Tab", keys: ["⇧", "⌘", "T"] },
      ],
    },
  ];

  return (
    <div className="h-full w-full bg-[#09090b] overflow-y-auto custom-scrollbar">
      <div className="min-h-full flex flex-col items-center justify-center p-6 sm:p-10 py-16 animate-in fade-in zoom-in-95 duration-700 text-center">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full max-w-5xl px-4 text-left">
          {categories.map((cat) => (
            <ShortcutCard key={cat.title} {...cat} />
          ))}
        </div>
      </div>
    </div>
  );
}
