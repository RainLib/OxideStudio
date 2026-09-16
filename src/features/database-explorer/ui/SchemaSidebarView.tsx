import type { SchemaSidebarController } from "@/features/database-explorer/hooks/useSchemaSidebarController";
import { ExplorerSidebarPresentation } from "@/features/database-explorer/ui/ExplorerSidebarPresentation";
import { useExplorerHistoryMenu } from "@/features/database-explorer/ui/useExplorerHistoryMenu";

interface SchemaSidebarViewProps {
  controller: SchemaSidebarController;
}

export function SchemaSidebarView({ controller }: SchemaSidebarViewProps) {
  const { presentationProps } = controller;
  const { renderSqlHistorySubmenu } = useExplorerHistoryMenu({
    createTab: presentationProps.createTab,
    queryHistory: presentationProps.queryHistory,
  });

  return (
    <ExplorerSidebarPresentation
      {...presentationProps}
      renderSqlHistorySubmenu={renderSqlHistorySubmenu}
    />
  );
}
