import {
  APP_EVENT_OPEN_DATABASE_SEARCH,
  type DatabaseSearchRequest,
} from "@/lib/actionEvents";
import { lazy, Suspense, useEffect, useState } from "react";

const DatabaseSearchDialog = lazy(() =>
  import("@/features/database-search/DatabaseSearchDialog").then((module) => ({
    default: module.DatabaseSearchDialog,
  })),
);

export function DeferredDatabaseSearch() {
  const [request, setRequest] = useState<DatabaseSearchRequest | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const openSearch = (event: Event) => {
      const detail = (event as CustomEvent<DatabaseSearchRequest>).detail;
      setRequest(detail || {});
      setRequestVersion((version) => version + 1);
    };
    window.addEventListener(APP_EVENT_OPEN_DATABASE_SEARCH, openSearch);
    return () =>
      window.removeEventListener(APP_EVENT_OPEN_DATABASE_SEARCH, openSearch);
  }, []);

  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <DatabaseSearchDialog request={request} requestVersion={requestVersion} />
    </Suspense>
  );
}
