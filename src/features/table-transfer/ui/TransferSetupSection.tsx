import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  transferSchemaRestoreDescription,
  transferSchemaRestoreFamily,
} from "@/features/database-explorer/model/tableDataTransferSchemaObjects";
import {
  supportsPostgresIdentityReseed,
  supportsTableDataTransferUpsert,
  transferObjectKey,
} from "@/features/table-transfer/model/transferPolicy";
import { FixedTransferList } from "@/features/table-transfer/ui/FixedTransferList";
import {
  fieldClass,
  settingsRowClass,
} from "@/features/table-transfer/ui/transferStyles";
import type { TableDataTransferMode } from "@/services/tauri/types";
import { Loader2, ShieldAlert } from "lucide-react";

interface TransferSetupSectionContext {
  setupSectionRef: React.RefObject<HTMLElement | null>;
  initialSourceScope: "table" | "schema" | "database";
  sourceSchemas: string[];
  activeSourceSchema: string;
  setActiveSourceSchema: React.Dispatch<React.SetStateAction<string>>;
  setSourceTables: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedSourceTables: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSourceTransferObjects: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableDataTransferObjectSelection[]
    >
  >;
  setSelectedTransferObjectKeys: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  resetTransferReview: () => void;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  isSubmitting: boolean;
  sourceTables: string[];
  selectedSourceTables: Set<string>;
  toggleSourceTable: (table: string, checked: boolean) => void;
  selectedTransferObjects: import("@/services/tauri/types").TableDataTransferObjectSelection[];
  isSourceObjectsLoading: boolean;
  sourceTransferObjectGroups: {
    kind: import("@/services/tauri/types").TableDataTransferObjectKind;
    objects: import("@/services/tauri/types").TableDataTransferObjectSelection[];
  }[];
  selectedTransferObjectKeys: Set<string>;
  toggleTransferObject: (
    object: import("@/services/tauri/types").TableDataTransferObjectSelection,
    checked: boolean,
  ) => void;
  targetConnectionId: string;
  setTargetConnectionId: React.Dispatch<React.SetStateAction<string>>;
  eligibleTargetConnections: import("@/store/useConnectionStore").ConnectionConfig[];
  sourceSupportsTransfer: boolean;
  source: import("@/services/tauri/types").TableDataTransferEndpoint;
  targetSupportsCatalogs: boolean;
  targetDatabase: string;
  setTargetDatabase: React.Dispatch<React.SetStateAction<string>>;
  isDatabasesLoading: boolean;
  databases: string[];
  targetSchema: string;
  setTargetSchema: React.Dispatch<React.SetStateAction<string>>;
  isSchemasLoading: boolean;
  schemas: string[];
  targetTableMode: "existing" | "new";
  handleTargetTableModeChange: (nextMode: "existing" | "new") => void;
  isTablesLoading: boolean;
  isBatchTransfer: boolean;
  targetSupportsGeneratedTable: boolean;
  targetTable: string;
  setTargetTable: React.Dispatch<React.SetStateAction<string>>;
  tables: string[];
  setTargetPlan: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableDataTransferTargetPlan | null
    >
  >;
  setTargetPlanPreviewKey: React.Dispatch<React.SetStateAction<string>>;
  setTargetPlanConfirmation: React.Dispatch<React.SetStateAction<string>>;
  mode: import("@/services/tauri/types").TableDataTransferMode;
  handleModeChange: (
    nextMode: import("@/services/tauri/types").TableDataTransferMode,
  ) => void;
  targetDistribution: "bundled" | "external" | "managed" | null;
  canConfigureTargetColumnQuoting: boolean;
  quoteTargetColumnNames: boolean;
  setQuoteTargetColumnNames: React.Dispatch<React.SetStateAction<boolean>>;
  maxRows: string;
  setMaxRows: React.Dispatch<React.SetStateAction<string>>;
  batchSize: string;
  setBatchSize: React.Dispatch<React.SetStateAction<string>>;
  targetConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  reseedIdentity: boolean;
  setReseedIdentity: React.Dispatch<React.SetStateAction<boolean>>;
  canRestoreSourceSchemaObjects: boolean;
  restoreSourceSchemaObjects: boolean;
  setRestoreSourceSchemaObjects: React.Dispatch<React.SetStateAction<boolean>>;
  effectiveSource: {
    schema: string;
    table: string;
    connectionId: string;
    driver: import("@/services/tauri/types").DatabaseDriver;
    database?: string | undefined;
  };
}

export function TransferSetupSection({
  setupSectionRef,
  initialSourceScope,
  sourceSchemas,
  activeSourceSchema,
  setActiveSourceSchema,
  setSourceTables,
  setSelectedSourceTables,
  setSourceTransferObjects,
  setSelectedTransferObjectKeys,
  resetTransferReview,
  setError,
  isSubmitting,
  sourceTables,
  selectedSourceTables,
  toggleSourceTable,
  selectedTransferObjects,
  isSourceObjectsLoading,
  sourceTransferObjectGroups,
  selectedTransferObjectKeys,
  toggleTransferObject,
  targetConnectionId,
  setTargetConnectionId,
  eligibleTargetConnections,
  sourceSupportsTransfer,
  source,
  targetSupportsCatalogs,
  targetDatabase,
  setTargetDatabase,
  isDatabasesLoading,
  databases,
  targetSchema,
  setTargetSchema,
  isSchemasLoading,
  schemas,
  targetTableMode,
  handleTargetTableModeChange,
  isTablesLoading,
  isBatchTransfer,
  targetSupportsGeneratedTable,
  targetTable,
  setTargetTable,
  tables,
  setTargetPlan,
  setTargetPlanPreviewKey,
  setTargetPlanConfirmation,
  mode,
  handleModeChange,
  targetDistribution,
  canConfigureTargetColumnQuoting,
  quoteTargetColumnNames,
  setQuoteTargetColumnNames,
  maxRows,
  setMaxRows,
  batchSize,
  setBatchSize,
  targetConnection,
  reseedIdentity,
  setReseedIdentity,
  canRestoreSourceSchemaObjects,
  restoreSourceSchemaObjects,
  setRestoreSourceSchemaObjects,
  effectiveSource,
}: TransferSetupSectionContext) {
  return (
    <section ref={setupSectionRef} className="space-y-4 px-5 py-4">
      <div>
        <div className="text-[12px] font-medium">Transfer setup</div>
        <p className="mt-0.5 text-[10px] wb-muted">
          Choose where this data will be copied. No data is changed until you
          confirm a reviewed plan.
        </p>
      </div>
      {initialSourceScope === "database" && sourceSchemas.length > 1 && (
        <label className="block space-y-1">
          <span className="text-[10px] font-medium">Source schema</span>
          <Select
            value={activeSourceSchema}
            onValueChange={(nextSchema) => {
              setActiveSourceSchema(nextSchema);
              setSourceTables([]);
              setSelectedSourceTables(new Set());
              setSourceTransferObjects([]);
              setSelectedTransferObjectKeys(new Set());
              resetTransferReview();
              setError(null);
            }}
            disabled={isSubmitting}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue placeholder="Choose source schema" />
            </SelectTrigger>
            <SelectContent>
              {sourceSchemas.map((schema) => (
                <SelectItem key={schema} value={schema}>
                  {schema}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="block text-[9px] leading-4 wb-muted">
            Database entry keeps schema boundaries explicit. Choose a schema,
            then review all its tables as one bounded batch.
          </span>
        </label>
      )}
      {sourceTables.length > 1 && (
        <div className="space-y-1.5 border-y border-[hsl(var(--wb-border-subtle))] py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium">Source scope</span>
            <span className="text-[9px] wb-muted">
              {selectedSourceTables.size} selected
            </span>
          </div>
          <FixedTransferList
            items={sourceTables}
            scopeKey={`${activeSourceSchema}:tables:${sourceTables.length}`}
            viewportHeight={96}
            className="custom-scrollbar space-y-0 overflow-auto pr-1 text-[10px]"
            itemKey={(table) => table}
            renderItem={(table) => (
              <label className="flex h-6 cursor-pointer items-center gap-1.5">
                <Checkbox
                  checked={selectedSourceTables.has(table)}
                  onCheckedChange={(checked) =>
                    toggleSourceTable(table, checked === true)
                  }
                  disabled={
                    isSubmitting ||
                    (selectedSourceTables.size === 1 &&
                      selectedSourceTables.has(table) &&
                      selectedTransferObjects.length === 0)
                  }
                />
                <span className="truncate" title={table}>
                  {table}
                </span>
              </label>
            )}
          />
        </div>
      )}
      {(isSourceObjectsLoading || sourceTransferObjectGroups.length > 0) && (
        <div
          className="space-y-2 border-b border-[hsl(var(--wb-border-subtle))] pb-3"
          data-transfer-object-selector
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium">Schema objects</div>
              <p className="mt-0.5 text-[9px] leading-4 wb-muted">
                Optional, explicit selection. Existing target objects are
                skipped; they are never silently replaced.
              </p>
            </div>
            <span className="shrink-0 text-[9px] wb-muted">
              {selectedTransferObjects.length} selected
            </span>
          </div>
          {isSourceObjectsLoading && sourceTransferObjectGroups.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[9px] wb-muted">
              <Loader2 size={11} className="animate-spin" />
              Reading object catalog…
            </div>
          ) : (
            <div className="custom-scrollbar max-h-40 space-y-2 overflow-auto pr-1">
              {sourceTransferObjectGroups.map((group) => (
                <div key={group.kind} className="space-y-1">
                  <div className="text-[9px] font-medium tracking-wide wb-muted">
                    {group.kind.replace(/_/g, " ")}
                  </div>
                  <FixedTransferList
                    items={group.objects}
                    scopeKey={`${activeSourceSchema}:${group.kind}:${group.objects.length}`}
                    viewportHeight={160}
                    className="custom-scrollbar overflow-auto"
                    itemKey={transferObjectKey}
                    renderItem={(object) => {
                      const key = transferObjectKey(object);
                      const checked = selectedTransferObjectKeys.has(key);
                      return (
                        <label className="flex h-6 cursor-pointer items-center gap-1.5 text-[10px]">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              toggleTransferObject(object, nextChecked === true)
                            }
                            disabled={
                              isSubmitting ||
                              (checked &&
                                selectedTransferObjects.length === 1 &&
                                selectedSourceTables.size === 0)
                            }
                          />
                          <span className="min-w-0 truncate" title={key}>
                            {object.parentName
                              ? `${object.parentName}.${object.name}`
                              : object.name}
                          </span>
                        </label>
                      );
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] leading-4 wb-muted">
            Native PostgreSQL objects use catalog-built DDL and the same
            transaction as table data. Other driver families remain visible in
            review but are blocked until their DDL execution contract is
            verified.
          </p>
        </div>
      )}
      <label className={settingsRowClass}>
        <span className="text-[10px] font-medium">Destination connection</span>
        <Select
          value={targetConnectionId}
          onValueChange={setTargetConnectionId}
          disabled={isSubmitting}
        >
          <SelectTrigger className={fieldClass}>
            <SelectValue placeholder="Choose connection" />
          </SelectTrigger>
          <SelectContent>
            {eligibleTargetConnections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {connection.name} · {connection.driver}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {!sourceSupportsTransfer && (
        <p className="text-[10px] leading-4 text-[hsl(var(--destructive))]">
          {source.driver} does not yet have a verified source paging and
          type-mapping path.
        </p>
      )}
      {eligibleTargetConnections.length === 0 && (
        <p className="text-[10px] leading-4 wb-muted">
          Add a PostgreSQL, MySQL/MariaDB, SQLite, or DuckDB connection to use
          bounded table transfer.
        </p>
      )}
      {targetSupportsCatalogs && (
        <label className={settingsRowClass}>
          <span className="text-[10px] wb-muted">Database</span>
          <Select
            value={targetDatabase}
            onValueChange={setTargetDatabase}
            disabled={isSubmitting || isDatabasesLoading}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue
                placeholder={
                  isDatabasesLoading ? "Loading databases…" : "Choose database"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {databases.map((database) => (
                <SelectItem key={database} value={database}>
                  {database}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <label className={settingsRowClass}>
        <span className="text-[10px] wb-muted">Schema</span>
        <Select
          value={targetSchema}
          onValueChange={setTargetSchema}
          disabled={isSubmitting || isSchemasLoading}
        >
          <SelectTrigger className={fieldClass}>
            <SelectValue
              placeholder={
                isSchemasLoading ? "Loading schemas…" : "Choose schema"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {schemas.map((schema) => (
              <SelectItem key={schema} value={schema}>
                {schema}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className={settingsRowClass}>
        <span className="text-[10px] font-medium">Destination table</span>
        <Select
          value={targetTableMode}
          onValueChange={(value) =>
            handleTargetTableModeChange(value as "existing" | "new")
          }
          disabled={isSubmitting || isTablesLoading || isBatchTransfer}
        >
          <SelectTrigger className={fieldClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="existing">Use existing table</SelectItem>
            {targetSupportsGeneratedTable && (
              <SelectItem value="new">Create new table…</SelectItem>
            )}
          </SelectContent>
        </Select>
      </label>
      {targetTableMode === "existing" ? (
        <label className={settingsRowClass}>
          <span className="text-[10px] wb-muted">Existing table</span>
          <Select
            value={targetTable}
            onValueChange={setTargetTable}
            disabled={isSubmitting || isTablesLoading || isBatchTransfer}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue
                placeholder={
                  isTablesLoading ? "Loading tables…" : "Choose table"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {tables.map((table) => (
                <SelectItem key={table} value={table}>
                  {table}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : (
        <label className={settingsRowClass}>
          <span className="text-[10px] wb-muted">New table name</span>
          <input
            className={fieldClass}
            value={targetTable}
            onChange={(event) => {
              setTargetTable(event.target.value);
              setTargetPlan(null);
              setTargetPlanPreviewKey("");
              setTargetPlanConfirmation("");
              resetTransferReview();
            }}
            placeholder="e.g. copied_table"
            disabled={isSubmitting}
          />
        </label>
      )}
      {targetTableMode === "existing" && (
        <>
          <label className={settingsRowClass}>
            <span className="text-[10px] font-medium">Copy mode</span>
            <Select
              value={mode}
              onValueChange={(value) =>
                handleModeChange(value as TableDataTransferMode)
              }
              disabled={isSubmitting}
            >
              <SelectTrigger className={fieldClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Append rows</SelectItem>
                <SelectItem value="overwrite">Replace target rows</SelectItem>
                {supportsTableDataTransferUpsert(targetDistribution) && (
                  <SelectItem value="upsert">
                    Upsert by target primary key
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </label>
          {mode === "overwrite" && (
            <p className="flex items-start gap-1.5 rounded-[4px] border border-[hsl(var(--wb-warning)/0.35)] bg-[hsl(var(--wb-warning)/0.08)] px-2 py-1.5 text-[10px] leading-4 text-[hsl(var(--wb-text))]">
              <ShieldAlert
                size={13}
                className="mt-0.5 shrink-0 text-[hsl(var(--wb-warning))]"
              />
              Replace deletes destination rows inside the reviewed transaction
              before copying. Check the preview carefully before confirming.
            </p>
          )}
          {canConfigureTargetColumnQuoting && (
            <label className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px] leading-4">
              <Checkbox
                checked={quoteTargetColumnNames}
                onCheckedChange={(checked) => {
                  setQuoteTargetColumnNames(checked === true);
                  resetTransferReview();
                }}
                disabled={isSubmitting}
              />
              <span>
                Quote destination column names
                <span className="mt-0.5 block wb-muted">
                  Disable only when the GaussDB/openGauss target expects
                  unquoted identifiers to fold to lowercase. Reserved or unsafe
                  names remain quoted by the Host.
                </span>
              </span>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[10px] wb-muted">Row limit</span>
              <input
                className={fieldClass}
                inputMode="numeric"
                value={maxRows}
                onChange={(event) => setMaxRows(event.target.value)}
                disabled={isSubmitting}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] wb-muted">Batch size</span>
              <input
                className={fieldClass}
                inputMode="numeric"
                value={batchSize}
                onChange={(event) => setBatchSize(event.target.value)}
                disabled={isSubmitting}
              />
            </label>
          </div>
          {supportsPostgresIdentityReseed(targetConnection?.driver) && (
            <label className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px] leading-4">
              <Checkbox
                checked={reseedIdentity}
                onCheckedChange={(checked) => {
                  setReseedIdentity(checked === true);
                  resetTransferReview();
                }}
                disabled={isSubmitting}
              />
              <span>
                Synchronize PostgreSQL serial/identity generators after copy.
                This runs inside the same target transaction and is included in
                the confirmation plan.
              </span>
            </label>
          )}
          {canRestoreSourceSchemaObjects && (
            <label className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px] leading-4">
              <Checkbox
                checked={restoreSourceSchemaObjects}
                onCheckedChange={(checked) => {
                  setRestoreSourceSchemaObjects(checked === true);
                  resetTransferReview();
                }}
                disabled={isSubmitting}
              />
              <span>
                Restore source indexes and constraints after the row copy
                <span className="mt-0.5 block wb-muted">
                  {transferSchemaRestoreDescription(
                    effectiveSource.driver,
                    targetConnection?.driver,
                  )}{" "}
                  The resulting DDL is reviewed first,
                  {transferSchemaRestoreFamily(
                    targetConnection?.driver || "",
                  ) === "mysql"
                    ? " runs after the row transaction commits, and returns a manual-review receipt if any statement fails. Foreign keys run last."
                    : " runs inside the target transaction, and restores foreign keys last."}
                </span>
              </span>
            </label>
          )}
          <p className="text-[10px] leading-4 wb-muted">
            Transfer streams bounded row batches through one target transaction.{" "}
            {restoreSourceSchemaObjects &&
            transferSchemaRestoreFamily(targetConnection?.driver || "") ===
              "mysql"
              ? "MySQL index and constraint DDL starts only after those rows commit because ALTER TABLE implicitly commits; a partial receipt blocks automatic retry."
              : "The target commits only after every reviewed transactional step succeeds."}{" "}
            {mode === "overwrite"
              ? "Replace mode deletes the previewed target rows inside that transaction and rolls the deletion back on row-copy failure."
              : mode === "upsert"
                ? "Upsert mode uses the target table's declared primary key and updates only mapped non-key columns."
                : "Append mode leaves existing rows unchanged."}{" "}
            Only verified paging, binding, and transaction paths are listed.
          </p>
          {isBatchTransfer && (
            <p className="text-[10px] leading-4 text-[hsl(var(--wb-warning))]">
              Batch transfer writes each selected source table to the same-named
              existing table in the target schema. New-table generation is
              intentionally unavailable for a multi-table transaction.
            </p>
          )}
        </>
      )}
    </section>
  );
}
