export type DatabaseAdminView =
  | "sessions"
  | "metrics"
  | "locks"
  | "users"
  | "roles"
  | "privileges";

export const DATABASE_ADMIN_AUTO_REFRESH_MS = 10_000;

const LIVE_DATABASE_ADMIN_VIEWS = new Set<DatabaseAdminView>([
  "sessions",
  "metrics",
  "locks",
]);

export function supportsDatabaseAdminAutoRefresh(
  view: DatabaseAdminView,
): boolean {
  return LIVE_DATABASE_ADMIN_VIEWS.has(view);
}
