interface ShortcutItemProps {
  label: string;
  keys: string[];
}

function ShortcutItem({ label, keys }: ShortcutItemProps) {
  return (
    <div className="flex items-center justify-between w-full max-w-[320px] py-1.5 px-4 text-muted-foreground hover:text-foreground group">
      <span className="text-[13px]">{label}</span>
      <div className="flex gap-1.5">
        {keys.map((key) => (
          <kbd
            key={key}
            className="flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-background-elevated border border-border rounded text-[10px] font-mono text-muted-foreground/60 group-hover:bg-background-tertiary group-hover:border-border-divider group-hover:text-foreground transition-colors shadow-sm"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

export function QueryShortcuts() {
  const shortcuts = [
    { label: "Quick Search", keys: ["Ctrl", "P"] },
    { label: "Autocomplete", keys: ["Ctrl", "Space"] },
    { label: "Run", keys: ["Ctrl", "Enter"] },
    { label: "Run Current", keys: ["Ctrl", "Shift", "Enter"] },
    { label: "New Window", keys: ["Ctrl", "Shift", "N"] },
    { label: "New Tab", keys: ["Ctrl", "T"] },
    { label: "Reopen Closed Tabs", keys: ["Ctrl", "Shift", "T"] },
    { label: "Close Tab", keys: ["Ctrl", "W"] },
    { label: "Find", keys: ["Ctrl", "F"] },
    { label: "Find and Replace", keys: ["Ctrl", "R"] },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-background-tertiary select-none">
      <div className="flex flex-col items-center gap-2 mb-8 opacity-40">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
          OxideStudio
        </div>
      </div>

      <div className="flex flex-col gap-0.5 w-full items-center">
        {shortcuts.map((s) => (
          <ShortcutItem key={s.label} label={s.label} keys={s.keys} />
        ))}
      </div>
    </div>
  );
}
