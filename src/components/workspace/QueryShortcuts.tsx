const shortcuts = [
  { label: "Manage Data Sources", keys: "⌘;" },
  { label: "Files View", keys: "⌘2" },
  { label: "Recent Files", keys: "⌘E" },
  { label: "Navigation Bar", keys: "⌘↑" },
  { label: "Go to File", keys: "⇧⌘O" },
  { label: "Search Everywhere", keys: "Double ⇧" },
];

export function QueryShortcuts() {
  return (
    <div className="h-full w-full overflow-hidden bg-[hsl(var(--wb-editor))]">
      <div className="flex h-full items-center justify-center">
        <div className="w-[360px] max-w-[calc(100vw-96px)] translate-y-[-18px] text-[13px] leading-7 text-[hsl(var(--wb-text-muted))]">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.label}
              className="grid grid-cols-[1fr_auto] items-center gap-6"
            >
              <span className="truncate">{shortcut.label}</span>
              <span className="select-none text-[12px] font-semibold text-[hsl(var(--wb-text-muted))] opacity-85">
                {shortcut.keys}
              </span>
            </div>
          ))}
          <div className="mt-1 text-[13px] text-[hsl(var(--wb-text-muted))] opacity-80">
            Drop files here to open them
          </div>
        </div>
      </div>
    </div>
  );
}
