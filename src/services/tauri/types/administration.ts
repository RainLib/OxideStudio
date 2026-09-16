export interface DatabaseAdminSession {
  id: string;
  user?: string | null;
  host?: string | null;
  database?: string | null;
  state?: string | null;
  statement?: string | null;
  wait?: string | null;
  durationSeconds?: number | null;
}

/** Identity confirmed by the active database session, not renderer state. */
export interface DatabaseAdminServerIdentity {
  driver: string;
  database?: string | null;
  account?: string | null;
  serverVersion?: string | null;
}

export interface DatabaseAdminUser {
  name: string;
  host?: string | null;
  canLogin?: boolean | null;
  isSuperuser?: boolean | null;
  authenticationPlugin?: string | null;
}

export interface CreateDatabaseAdminUserRequest {
  name: string;
  password?: string;
  host?: string;
  canLogin?: boolean;
  confirmed: boolean;
}

export interface UpdateDatabaseAdminPasswordRequest {
  name: string;
  password: string;
  host?: string;
  confirmed: boolean;
}

export interface SetDatabaseAdminLoginRequest {
  name: string;
  host?: string;
  canLogin: boolean;
  confirmed: boolean;
}

export interface DeleteDatabaseAdminUserRequest {
  name: string;
  host?: string;
  confirmed: boolean;
}

/** A read-only role-to-member relationship returned by the connected server. */
export interface DatabaseAdminRoleMembership {
  role: string;
  member: string;
}

export interface DatabaseAdminTablePrivilege {
  grantee: string;
  schema: string;
  table: string;
  privilege: string;
}

export interface DatabaseAdminEvent {
  schema: string;
  name: string;
  definer?: string | null;
  timeZone?: string | null;
  eventType?: string | null;
  executeAt?: string | null;
  intervalValue?: string | null;
  intervalField?: string | null;
  starts?: string | null;
  ends?: string | null;
  status?: string | null;
  onCompletion?: string | null;
  comment?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastExecuted?: string | null;
}

export interface DatabaseAdminEventCatalog {
  schedulerStatus?: string | null;
  events: DatabaseAdminEvent[];
}

export type DatabaseAdminEventIntervalUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

export type DatabaseAdminEventSchedule =
  | { kind: "once"; executeAt: string }
  | {
      kind: "interval";
      intervalValue: number;
      intervalUnit: DatabaseAdminEventIntervalUnit;
      starts?: string;
      ends?: string;
    };

export interface CreateDatabaseAdminEvent {
  schema: string;
  name: string;
  schedule: DatabaseAdminEventSchedule;
  preserveAfterCompletion: boolean;
  enabled: boolean;
  comment?: string;
  body: string;
}

export type DatabaseAdminEventMutation =
  | { action: "create"; event: CreateDatabaseAdminEvent }
  | { action: "setEnabled"; schema: string; name: string; enabled: boolean }
  | { action: "delete"; schema: string; name: string };

export interface DatabaseAdminEventPlan {
  action: "create" | "enable" | "disable" | "delete";
  target: string;
  summary: string;
  risk: "medium" | "high";
  sqlPreview: string;
  confirmationText: string;
  confirmationToken: string;
  serverVersion?: string | null;
}

export interface ExecuteDatabaseAdminEventMutation {
  mutation: DatabaseAdminEventMutation;
  confirmationToken: string;
  confirmationText: string;
}

export interface DatabaseAdminMetric {
  key: string;
  label: string;
  value?: string | null;
  unit: string;
  description?: string | null;
  available: boolean;
}

/** A read-only database blocking edge; intentionally contains no SQL text. */
export interface DatabaseAdminLockWait {
  waitingSessionId: string;
  blockingSessionId: string;
  waitingUser?: string | null;
  blockingUser?: string | null;
  database?: string | null;
  wait?: string | null;
  durationSeconds?: number | null;
}
