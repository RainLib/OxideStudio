export interface ProjectSqlFileTarget {
  connectionId: string;
  databaseName?: string;
  schemaName?: string;
}

interface ProjectSqlFileTargetRecord extends ProjectSqlFileTarget {
  projectId: string;
  relativePath: string;
  updatedAt: number;
}

interface PersistedProjectSqlFileTargets {
  version: 1;
  records: ProjectSqlFileTargetRecord[];
}

const STORAGE_KEY = "oxide-studio-project-sql-file-targets";
const STORAGE_VERSION = 1;
const MAX_RECORDS = 200;
const MAX_PROJECT_ID_LENGTH = 256;
const MAX_RELATIVE_PATH_LENGTH = 1_024;
const MAX_CONNECTION_ID_LENGTH = 256;
const MAX_DATABASE_NAME_LENGTH = 512;
const MAX_SCHEMA_NAME_LENGTH = 512;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function storageAvailable() {
  return typeof localStorage !== "undefined";
}

function boundedIdentifier(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    CONTROL_CHARACTERS.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function optionalIdentifier(value: unknown, maxLength: number) {
  if (value == null || value === "") return undefined;
  return boundedIdentifier(value, maxLength);
}

function normalizedRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_RELATIVE_PATH_LENGTH) {
    return undefined;
  }
  if (
    CONTROL_CHARACTERS.test(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return undefined;
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return normalized && normalized.length <= MAX_RELATIVE_PATH_LENGTH
    ? normalized
    : undefined;
}

function normalizedRecord(value: unknown): ProjectSqlFileTargetRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProjectSqlFileTargetRecord>;
  const projectId = boundedIdentifier(
    candidate.projectId,
    MAX_PROJECT_ID_LENGTH,
  );
  const relativePath = normalizedRelativePath(candidate.relativePath);
  const connectionId = boundedIdentifier(
    candidate.connectionId,
    MAX_CONNECTION_ID_LENGTH,
  );
  const databaseName = optionalIdentifier(
    candidate.databaseName,
    MAX_DATABASE_NAME_LENGTH,
  );
  const schemaName = optionalIdentifier(
    candidate.schemaName,
    MAX_SCHEMA_NAME_LENGTH,
  );
  const updatedAt = Number(candidate.updatedAt);
  if (
    !projectId ||
    !relativePath ||
    !connectionId ||
    !relativePath.toLocaleLowerCase().endsWith(".sql") ||
    !Number.isFinite(updatedAt) ||
    updatedAt < 0
  ) {
    return null;
  }
  if (
    (candidate.databaseName != null && candidate.databaseName !== "" && !databaseName) ||
    (candidate.schemaName != null && candidate.schemaName !== "" && !schemaName)
  ) {
    return null;
  }
  return {
    projectId,
    relativePath,
    connectionId,
    ...(databaseName ? { databaseName } : {}),
    ...(schemaName ? { schemaName } : {}),
    updatedAt,
  };
}

function recordKey(record: Pick<ProjectSqlFileTargetRecord, "projectId" | "relativePath">) {
  return `${record.projectId}\u0000${record.relativePath}`;
}

function readRecords(): ProjectSqlFileTargetRecord[] {
  if (!storageAvailable()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedProjectSqlFileTargets>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.records)) {
      return [];
    }

    const deduplicated = new Map<string, ProjectSqlFileTargetRecord>();
    for (const value of parsed.records.slice(0, MAX_RECORDS * 2)) {
      const record = normalizedRecord(value);
      if (!record) continue;
      const key = recordKey(record);
      const existing = deduplicated.get(key);
      if (!existing || record.updatedAt > existing.updatedAt) {
        deduplicated.set(key, record);
      }
    }
    return [...deduplicated.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function writeRecords(records: readonly ProjectSqlFileTargetRecord[]) {
  if (!storageAvailable()) return;
  try {
    const deduplicated = new Map<string, ProjectSqlFileTargetRecord>();
    for (const record of records) {
      const key = recordKey(record);
      const existing = deduplicated.get(key);
      if (!existing || record.updatedAt > existing.updatedAt) {
        deduplicated.set(key, record);
      }
    }
    const payload: PersistedProjectSqlFileTargets = {
      version: STORAGE_VERSION,
      records: [...deduplicated.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_RECORDS),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // A file target is a convenience cache. Storage denial or quota pressure
    // must never block opening or editing a project file.
  }
}

function normalizedIdentity(projectId: string, relativePath: string) {
  const normalizedProjectId = boundedIdentifier(projectId, MAX_PROJECT_ID_LENGTH);
  const normalizedPath = normalizedRelativePath(relativePath);
  if (!normalizedProjectId || !normalizedPath) return null;
  return { projectId: normalizedProjectId, relativePath: normalizedPath };
}

export function isProjectSqlFile(relativePath: string) {
  return relativePath.trim().toLocaleLowerCase().endsWith(".sql");
}

export function resolveProjectSqlFileTarget(
  projectId: string,
  relativePath: string,
  connectionExists?: (connectionId: string) => boolean,
): ProjectSqlFileTarget | null {
  const identity = normalizedIdentity(projectId, relativePath);
  if (!identity || !isProjectSqlFile(identity.relativePath)) return null;
  const records = readRecords();
  const key = recordKey(identity);
  const record = records.find((candidate) => recordKey(candidate) === key);
  if (!record) return null;
  if (connectionExists && !connectionExists(record.connectionId)) {
    writeRecords(records.filter((candidate) => recordKey(candidate) !== key));
    return null;
  }
  return {
    connectionId: record.connectionId,
    ...(record.databaseName ? { databaseName: record.databaseName } : {}),
    ...(record.schemaName ? { schemaName: record.schemaName } : {}),
  };
}

export function rememberProjectSqlFileTarget(
  projectId: string,
  relativePath: string,
  target: ProjectSqlFileTarget,
  updatedAt = Date.now(),
) {
  const identity = normalizedIdentity(projectId, relativePath);
  const connectionId = boundedIdentifier(
    target.connectionId,
    MAX_CONNECTION_ID_LENGTH,
  );
  const databaseName = optionalIdentifier(
    target.databaseName,
    MAX_DATABASE_NAME_LENGTH,
  );
  const schemaName = optionalIdentifier(target.schemaName, MAX_SCHEMA_NAME_LENGTH);
  if (
    !identity ||
    !isProjectSqlFile(identity.relativePath) ||
    !connectionId ||
    !Number.isFinite(updatedAt) ||
    updatedAt < 0 ||
    (target.databaseName != null && target.databaseName !== "" && !databaseName) ||
    (target.schemaName != null && target.schemaName !== "" && !schemaName)
  ) {
    return false;
  }

  const record: ProjectSqlFileTargetRecord = {
    ...identity,
    connectionId,
    ...(databaseName ? { databaseName } : {}),
    ...(schemaName ? { schemaName } : {}),
    updatedAt,
  };
  const key = recordKey(record);
  writeRecords([record, ...readRecords().filter((item) => recordKey(item) !== key)]);
  return true;
}

export function renameProjectSqlFileTargets(
  projectId: string,
  oldRelativePath: string,
  newRelativePath: string,
) {
  const oldIdentity = normalizedIdentity(projectId, oldRelativePath);
  const newIdentity = normalizedIdentity(projectId, newRelativePath);
  if (!oldIdentity || !newIdentity) return 0;
  const oldPrefix = `${oldIdentity.relativePath}/`;
  const records = readRecords();
  let changed = 0;
  const next = records.flatMap((record) => {
    if (
      record.projectId !== oldIdentity.projectId ||
      (record.relativePath !== oldIdentity.relativePath &&
        !record.relativePath.startsWith(oldPrefix))
    ) {
      return [record];
    }
    const relativePath = `${newIdentity.relativePath}${record.relativePath.slice(oldIdentity.relativePath.length)}`;
    if (!isProjectSqlFile(relativePath)) {
      changed += 1;
      return [];
    }
    changed += 1;
    return [{ ...record, relativePath }];
  });
  if (changed > 0) writeRecords(next);
  return changed;
}

export function forgetProjectSqlFileTargets(
  projectId: string,
  relativePath = "",
) {
  const normalizedProjectId = boundedIdentifier(projectId, MAX_PROJECT_ID_LENGTH);
  const normalizedPath = relativePath
    ? normalizedRelativePath(relativePath)
    : "";
  if (!normalizedProjectId || (relativePath && !normalizedPath)) return 0;
  const prefix = normalizedPath ? `${normalizedPath}/` : "";
  const records = readRecords();
  const next = records.filter((record) => {
    if (record.projectId !== normalizedProjectId) return true;
    if (!normalizedPath) return false;
    return (
      record.relativePath !== normalizedPath &&
      !record.relativePath.startsWith(prefix)
    );
  });
  const removed = records.length - next.length;
  if (removed > 0) writeRecords(next);
  return removed;
}

export const projectSqlFileTargetStorageKey = STORAGE_KEY;
