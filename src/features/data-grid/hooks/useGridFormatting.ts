import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  columnFormatterKeys,
  queryColumnFormatterKeys,
} from "@/features/data-grid/model/columnFormatter";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { AppSettings } from "@/lib/appSettings";
import { databaseDriverProfile } from "@/lib/databaseDialect";
import { cachedSqlProjectionSources } from "@/lib/queryEditorCachedCompletion";
import type { QueryResult } from "@/services/tauri/types/query";

import { useCallback, useMemo } from "react";

interface GridFormattingOptions {
  activeTab: GridTabSnapshot | null;
  result: QueryResult | undefined;
  resultOverride: QueryResult | undefined;
  isTransposed: boolean;
  activeConnection: ConnectionConfig | undefined;
  dataGridSettings: AppSettings["dataGrid"];
}

export function useGridFormatting({
  activeTab,
  result,
  resultOverride,
  isTransposed,
  activeConnection,
  dataGridSettings,
}: GridFormattingOptions) {
  const tableColumns = activeTab?.tableColumns;
  const tableColumnsByName = useMemo(
    () => new Map(tableColumns?.map((column) => [column.name, column])),
    [tableColumns],
  );
  const resultColumns = result?.columns;
  const hasResultOverride = Boolean(resultOverride);
  const queryDisplaySourceColumns = useMemo(() => {
    if (
      activeTab?.type !== "query" ||
      !activeTab.resultSql ||
      !resultColumns?.length ||
      isTransposed ||
      hasResultOverride
    ) {
      return [];
    }
    return cachedSqlProjectionSources(
      activeTab.resultSql,
      resultColumns.map((column) => column.name),
    );
  }, [
    activeTab?.resultSql,
    activeTab?.type,
    hasResultOverride,
    isTransposed,
    resultColumns,
  ]);
  const activeNamespaceLabel = useMemo(
    () =>
      activeConnection
        ? databaseDriverProfile(activeConnection.driver).capabilities
            .namespaceLabel
        : undefined,
    [activeConnection],
  );

  const formatterKeysForResultColumn = useCallback(
    (columnIndex: number) => {
      const resultColumn = result?.columns[columnIndex];
      if (!resultColumn || !activeTab?.connectionId || isTransposed) {
        return [];
      }
      if (activeTab.type === "query") {
        return queryColumnFormatterKeys({
          connectionId: activeTab.connectionId,
          database: activeTab.databaseName,
          databaseType: activeConnection?.driver,
          namespaceLabel: activeNamespaceLabel,
          resultColumn: resultColumn.name,
          displaySource: queryDisplaySourceColumns[columnIndex],
        });
      }
      if (activeTab.type !== "table" || !activeTab.tableName) return [];
      return columnFormatterKeys({
        connectionId: activeTab.connectionId,
        database: activeTab.databaseName,
        schema: activeTab.schemaName,
        databaseType: activeConnection?.driver,
        resultColumn: resultColumn.name,
        tableMeta: {
          database: activeTab.databaseName,
          schema: activeTab.schemaName,
          tableName: activeTab.tableName,
        },
      });
    },
    [
      activeConnection?.driver,
      activeNamespaceLabel,
      activeTab,
      isTransposed,
      queryDisplaySourceColumns,
      result?.columns,
    ],
  );

  const formatterForResultColumn = useCallback(
    (columnIndex: number) => {
      for (const key of formatterKeysForResultColumn(columnIndex)) {
        const formatter = dataGridSettings.columnFormatters[key];
        if (formatter) return formatter;
      }
      return undefined;
    },
    [dataGridSettings.columnFormatters, formatterKeysForResultColumn],
  );

  return {
    tableColumnsByName,
    tableColumns,
    formatterForResultColumn,
    formatterKeysForResultColumn,
  };
}
