import { useTabStore } from "@/store/useTabStore";

export function useExplorerTabActions() {
  const findOrCreateTableTab = useTabStore(
    (state) => state.findOrCreateTableTab,
  );
  const findOrCreateObjectDataTab = useTabStore(
    (state) => state.findOrCreateObjectDataTab,
  );
  const loadTablePage = useTabStore((state) => state.loadTablePage);
  const loadDocumentPage = useTabStore((state) => state.loadDocumentPage);
  const createTableTab = useTabStore((state) => state.createTableTab);
  const openDatabaseBrowser = useTabStore((state) => state.openDatabaseBrowser);
  const openObjectBrowser = useTabStore((state) => state.openObjectBrowser);
  const openRocketMqWorkspace = useTabStore(
    (state) => state.openRocketMqWorkspace,
  );
  const createTab = useTabStore((state) => state.createTab);
  const openSchemaDiagramTab = useTabStore(
    (state) => state.openSchemaDiagramTab,
  );
  const runTabQuery = useTabStore((state) => state.runTabQuery);
  const setTableMetadata = useTabStore((state) => state.setTableMetadata);

  return {
    findOrCreateTableTab,
    findOrCreateObjectDataTab,
    loadTablePage,
    loadDocumentPage,
    createTableTab,
    openDatabaseBrowser,
    openObjectBrowser,
    openRocketMqWorkspace,
    createTab,
    openSchemaDiagramTab,
    runTabQuery,
    setTableMetadata,
  };
}
