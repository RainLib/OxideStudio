import { useSchemaSidebarController } from "@/features/database-explorer/hooks/useSchemaSidebarController";
import { SchemaSidebarView } from "@/features/database-explorer/ui/SchemaSidebarView";

export function SchemaSidebar() {
  const controller = useSchemaSidebarController();
  return <SchemaSidebarView controller={controller} />;
}
