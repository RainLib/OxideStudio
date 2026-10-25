import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "src/services/tauri/table";
const facade = readSourceText(path.join(root, `${base}.service.ts`));

for (const module of ["page", "export", "compare", "import", "transfer", "definition"]) {
  if (!facade.includes(`export * from "./table/${module}";`)) {
    throw new Error(`Table service facade must re-export ${module}.`);
  }
}

for (const service of [
  "tablePageService",
  "tableExportService",
  "tableCompareService",
  "tableImportService",
  "tableTransferService",
  "tableDefinitionService",
]) {
  if (!facade.includes(`...${service},`)) {
    throw new Error(`Table service facade must compose ${service}.`);
  }
}

const ownership = {
  page: ["previewTablePage", "truncateTable", "dropTable"],
  export: ["exportTableData", "exportDatabaseSql", "TABLE_EXPORT_PROGRESS_EVENT"],
  compare: ["compareTableDataFull", "executeTableDataCompareSync", "TABLE_DATA_COMPARE_PROGRESS_EVENT"],
  import: ["importTableData", "preflightTableCsvImport", "TABLE_IMPORT_PROGRESS_EVENT"],
  transfer: ["previewTableDataTransfer", "executeTableDataTransferBatch", "TABLE_DATA_TRANSFER_PROGRESS_EVENT"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = readSourceText(path.join(root, `${base}/${module}.ts`));
  if (!source.includes('from "../client"') || symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${module} must retain its Tauri table command ownership.`);
  }
}

const definitionFacade = readSourceText(path.join(root, `${base}/definition.ts`));
for (const module of ["table", "columns", "indexes", "constraints", "views", "sources"]) {
  if (!definitionFacade.includes(`./definition/${module}`)) {
    throw new Error(`Table definition facade must compose ${module}.`);
  }
  const source = readSourceText(path.join(root, `${base}/definition/${module}.ts`));
  if (!source.includes('from "../../client"') || source.includes('from "../definition"')) {
    throw new Error(`Table definition ${module} has an invalid command boundary.`);
  }
}

const definitionOwnership = {
  table: ["renameTable", "mutateTableRows", "createTable", "previewCreateTable"],
  columns: ["addTableColumn", "dropTableColumn", "alterTableColumn"],
  indexes: ["createTableIndex", "dropTableIndex", "renameTableIndex"],
  constraints: ["createTableForeignKey", "createTableCheckConstraint", "dropTableConstraint"],
  views: ["createView", "createMaterializedView", "refreshMaterializedView"],
  sources: ["getTableDdl", "getViewDefinition", "getPostgresRoutineDefinitions"],
};
for (const [module, symbols] of Object.entries(definitionOwnership)) {
  const source = readSourceText(path.join(root, `${base}/definition/${module}.ts`));
  if (symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`Table definition ${module} lost a command owner.`);
  }
}

console.log("Table service boundaries verified: five capability owners and six definition command owners are explicit.");
