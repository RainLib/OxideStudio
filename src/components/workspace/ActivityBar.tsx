import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Database, Clock, Settings, Code, Hexagon } from "lucide-react";
import { SidebarStatusBar } from "./SidebarStatusBar";

export type SidebarTab = "tables" | "history" | "saved" | "settings";

interface ActivityBarProps {
  activeTab: SidebarTab | null;
  onTabClick: (tab: SidebarTab) => void;
  isDrawerOpen: boolean;
}

export function ActivityBar({
  activeTab,
  onTabClick,
  isDrawerOpen,
}: ActivityBarProps) {
  return (
    <div className="z-50 flex w-[50px] shrink-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))]">
      <div className="flex-1 flex flex-col items-center py-4 gap-3">
        {/* App Logo */}
        <div className="mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] shadow-lg shadow-black/20">
            <Database size={20} strokeWidth={2.5} />
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex flex-col gap-2 w-full px-1">
          <ActivityBarButton
            active={activeTab === "tables" && isDrawerOpen}
            onClick={() => onTabClick("tables")}
            icon={Hexagon}
            title="Entities (Tables)"
          />
          <ActivityBarButton
            active={activeTab === "history" && isDrawerOpen}
            onClick={() => onTabClick("history")}
            icon={Clock}
            title="History"
          />
          <ActivityBarButton
            active={activeTab === "saved" && isDrawerOpen}
            onClick={() => onTabClick("saved")}
            icon={Code}
            title="Saved Queries"
          />
        </div>

        {/* Bottom Items */}
        <div className="mt-auto flex flex-col gap-2 w-full px-1">
          <ActivityBarButton
            active={activeTab === "settings" && isDrawerOpen}
            onClick={() => onTabClick("settings")}
            icon={Settings}
            title="Settings"
          />
        </div>
      </div>

      {/* Bottom Status Bar - only shows when sidebar is closed */}
      {!isDrawerOpen && <SidebarStatusBar isDrawerOpen={false} width={50} />}
    </div>
  );
}

function ActivityBarButton({
  active,
  onClick,
  icon: Icon,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  title: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative w-full h-10 transition-all rounded-md group",
        active
          ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
          : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
      )}
      onClick={onClick}
      title={title}
    >
      {active && (
        <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-md bg-[hsl(var(--wb-accent))] shadow-[0_0_8px_hsl(var(--wb-accent)/0.4)]" />
      )}
      <Icon
        size={20}
        strokeWidth={1.5}
        className={cn(
          "transition-transform group-hover:scale-105",
          active && "stroke-[2px]"
        )}
      />
    </Button>
  );
}
