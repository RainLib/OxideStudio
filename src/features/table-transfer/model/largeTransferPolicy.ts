import type {
  LargeTransferRequest,
  LargeTransferSummary,
  TableDataTransferRequest,
} from "@/services/tauri/types";

export function buildLargeTransferRequest(
  request: TableDataTransferRequest | null,
  singleExistingNativeTable: boolean,
): LargeTransferRequest | null {
  if (
    !singleExistingNativeTable ||
    !request?.projectId ||
    !["sqlite", "postgres", "mysql"].includes(request.source.driver) ||
    request.target.driver !== request.source.driver ||
    !request.source.table ||
    !request.target.table
  )
    return null;
  if (
    request.source.driver === "postgres" &&
    [request.source.schema, request.target.schema].some(
      (schema) =>
        !schema || schema.startsWith("pg_") || schema === "information_schema",
    )
  )
    return null;
  if (
    request.source.driver === "mysql" &&
    [request.source, request.target].some((endpoint) => {
      const database = endpoint.schema || endpoint.database || "";
      return (
        [
          "mysql",
          "sys",
          "information_schema",
          "performance_schema",
          "ndbinfo",
        ].includes(database.toLowerCase()) ||
        Array.from(database).length > 64 ||
        Array.from(endpoint.table).length > 64 ||
        /[\u0000-\u001f\u007f]/.test(database)
      );
    })
  )
    return null;
  const endpoint = (value: TableDataTransferRequest["source"]) => ({
    connectionId: value.connectionId,
    driver: value.driver,
    schema:
      value.driver === "mysql"
        ? value.schema || value.database || ""
        : value.schema,
    table: value.table,
    database: value.database,
  });
  // This is a separate contract: legacy row caps/schema/identity options never
  // silently become options of the full snapshot workflow.
  return {
    projectId: request.projectId,
    source: endpoint(request.source),
    target: endpoint(request.target),
    mode: request.mode ?? "append",
    batchRows: 500,
  };
}

export function transferDriverName(driver: string) {
  return (
    (
      { sqlite: "SQLite", postgres: "PostgreSQL", mysql: "MySQL" } as Record<
        string,
        string
      >
    )[driver] ?? driver
  );
}
export function transferEndpointName(endpoint: LargeTransferSummary["source"]) {
  const namespace =
    endpoint.schema || (endpoint.driver === "mysql" ? endpoint.database : "");
  const relation = namespace ? `${namespace}.${endpoint.table}` : endpoint.table;
  return endpoint.driver === "postgres" && endpoint.database
    ? `${endpoint.database} · ${relation}`
    : relation;
}

export const transferPhaseLabels: Record<
  LargeTransferSummary["phase"],
  string
> = {
  preparing: "Preparing snapshot",
  awaitingReview: "Ready for review",
  copying: "Copying to staging",
  paused: "Paused",
  publishing: "Publishing target",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Preparation failed",
};

export function transferIssue(issue?: string | null) {
  switch (issue) {
    case "process_interrupted":
      return "The app stopped during this transfer. Review and resume it, or cancel it to remove the private snapshot.";
    case "preparation_failed":
      return "Snapshot preparation failed. Check the saved source connection, table columns, target permissions and available disk space. Cancel this job before preparing a new snapshot.";
    case "execution_interrupted_or_target_changed":
      return "The copy stopped or the target changed. Check the original saved connections and target before resuming. If they changed, cancel and prepare a new review.";
    case "cancellation_requires_review":
      return "Automatic cleanup stopped because the original target or staging objects changed. Restore access to the original target and retry cancellation; existing target rows were preserved.";
    case "snapshot_cleanup_pending":
      return "The transfer ended, but its private snapshot could not be removed. Close applications using that file; reopening this transfer retries cleanup.";
    default:
      return issue
        ? "This transfer needs attention. Check the original target before resuming."
        : null;
  }
}

export function mergeTransferJobs(
  current: LargeTransferSummary[],
  incoming: LargeTransferSummary[],
) {
  const merged = new Map(current.map((job) => [job.id, job]));
  incoming.forEach((job) => merged.set(job.id, job));
  return [...merged.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id),
  );
}
