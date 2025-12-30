import { Play, Search, Terminal, Layout } from "lucide-react";

interface ShortcutCardProps {
  icon: any;
  title: string;
  shortcuts: { lab: string; keys: string[] }[];
}

function ShortcutCard({ icon: Icon, title, shortcuts }: ShortcutCardProps) {
  return (
    <div className="flex flex-col p-5 rounded-2xl bg-white/5 border border-white/10 shadow-sm hover:shadow-md hover:bg-white/10 transition-all duration-300 group">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
          <Icon size={18} strokeWidth={2.5} />
        </div>
        <h3 className="font-semibold text-sm tracking-wide text-foreground/90">
          {title}
        </h3>
      </div>
      <div className="flex flex-col gap-3">
        {shortcuts.map((s) => (
          <div
            key={s.lab}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-muted-foreground group-hover:text-muted-foreground/80 transition-colors">
              {s.lab}
            </span>
            <div className="flex gap-1.5">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="h-5 px-1.5 flex items-center justify-center bg-muted/50 border border-border rounded-[4px] font-mono text-[10px] text-muted-foreground min-w-[20px]"
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
    <div className="h-full w-full bg-[#09090b] flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
      <div className="mb-12 flex flex-col items-center gap-3">
        <div className="h-12 w-12 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20 mb-2">
          <Terminal
            className="text-primary-foreground"
            size={24}
            strokeWidth={2.5}
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Oxide Studio
        </h1>
        <p className="text-muted-foreground text-sm">
          Keyboard shortcuts to supercharge your workflow
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl">
        {categories.map((cat) => (
          <ShortcutCard key={cat.title} {...cat} />
        ))}
      </div>

      <div className="mt-12 text-center">
        <p className="text-xs text-muted-foreground/40 font-mono">
          v0.1.0 • Built with Rust & Tauri
        </p>
      </div>
    </div>
  );
}
