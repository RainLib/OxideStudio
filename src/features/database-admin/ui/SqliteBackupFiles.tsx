import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { databaseService } from "@/services/tauri/database.service";
import { confirmSqliteBackupFileDeletion } from "../model/confirmSqliteBackupFileDeletion";
import type { SqliteBackupArtifactPage, SqliteBackupRun } from "@/services/tauri/types";
import { useProjectStore } from "@/store/useProjectStore";
import { RefreshCw, Trash2 } from "lucide-react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

interface Props {
  projectId: string;
  refreshKey: string;
  onDeleted: () => Promise<void>;
}

interface LoadedPage extends SqliteBackupArtifactPage {
  key: string;
  cursor?: string;
}

const compactBytes = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export const SqliteBackupFiles = memo(function SqliteBackupFiles({ projectId, refreshKey, onDeleted }: Props) {
  const projects = useProjectStore((state) => state.projects);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const [allProjects, setAllProjects] = useState(false);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [navigation, setNavigation] = useState<{ key: string; cursor?: string; previous: Array<string | undefined> }>({ key: "", previous: [] });
  const [page, setPage] = useState<LoadedPage>({ key: "", items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const revision = useRef(0);
  const headingId = useId();
  const helpId = useId();
  const key = JSON.stringify([allProjects ? null : projectId, search]);
  const cursor = navigation.key === key ? navigation.cursor : undefined;
  const previous = navigation.key === key ? navigation.previous : [];
  const currentPage = page.key === key && page.cursor === cursor;
  const items = currentPage ? page.items : [];

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    // Observe other projects and retention changes without driving execution.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") setReload((value) => value + 1);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const current = ++revision.current;
    setLoading(true);
    void databaseService.listSqliteBackupArtifacts({
      projectId: allProjects ? undefined : projectId,
      search,
      cursor,
      limit: 50,
    }).then((result) => {
      if (revision.current !== current) return;
      setPage({ ...result, key, cursor });
      setError(null);
    }).catch((reason: unknown) => {
      if (revision.current === current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (revision.current === current) setLoading(false);
    });
    return () => { revision.current += 1; };
  }, [projectId, allProjects, search, cursor, key, reload, refreshKey]);

  const remove = async (run: SqliteBackupRun) => {
    setDeleting(run.id);
    setError(null);
    try {
      const confirmation = await confirmSqliteBackupFileDeletion(run.id);
      if (confirmation === null) return;
      await databaseService.deleteSqliteBackupRun(run.id, confirmation);
      await onDeleted();
      setReload((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section aria-labelledby={headingId} aria-busy={loading} className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-[12px] font-semibold">Retained backup files</h3>
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => {
          setNavigation({ key, previous: [] });
          setReload((value) => value + 1);
        }}>
          <RefreshCw size={12} className="mr-1" /> Refresh files
        </Button>
      </div>
      <p id={helpId} className="mb-3 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
        Files stay listed after recent run history is trimmed. Cleanup checks each file before deletion.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Search retained backup files" aria-describedby={helpId} placeholder="Search name or file path" value={input}
          onChange={(event) => setInput(event.target.value)} className="h-7 min-w-40 flex-1 text-[11px]" />
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={allProjects} onChange={(event) => setAllProjects(event.target.checked)} /> All projects
        </label>
      </div>
      {error ? <p role="alert" className="mb-2 text-[11px] text-[hsl(var(--destructive))]">{error}</p> : null}
      <ul aria-label="Retained backup files" className="divide-y divide-[hsl(var(--wb-border-subtle))] overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
        {items.map((run) => (
          <li key={run.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium"><span className="truncate">{run.scheduleName}</span>{run.status === "interrupted" ? <span className="shrink-0 text-[10px] text-[hsl(var(--wb-text-muted))]">Needs review</span> : null}</div>
              <div title={run.filePath ?? undefined} className="mt-0.5 truncate font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">{run.filePath}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
                <span>{projectNames.get(run.projectId) ?? "Archived project"}</span>
                <time dateTime={run.completedAt ?? run.startedAt}>{new Date(run.completedAt ?? run.startedAt).toLocaleString()}</time>
                <span>{run.byteLen == null ? "—" : `${compactBytes.format(run.byteLen)} bytes`}</span>
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" disabled={loading || deleting !== null}
              aria-label={`Delete retained backup ${run.scheduleName}`} onClick={() => void remove(run)}>
              <Trash2 size={12} />{deleting === run.id ? "Deleting…" : null}
            </Button>
          </li>
        ))}
        {!items.length ? <li className="px-3 py-5 text-center text-[11px] text-[hsl(var(--wb-text-muted))]" role="status">
          {loading ? "Loading retained backup files…" : error ? "Backup files could not be loaded." : "No retained backup files match these filters."}
        </li> : null}
      </ul>
      <div className="mt-2 flex items-center justify-between text-[10px] text-[hsl(var(--wb-text-muted))]">
        <span>{items.length} files on this page</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={loading || !previous.length} onClick={() => {
            setNavigation({ key, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) });
          }}>Previous files</Button>
          <Button type="button" variant="ghost" size="sm" disabled={loading || !currentPage || !page.nextCursor} onClick={() => {
            setNavigation({ key, cursor: page.nextCursor ?? undefined, previous: [...previous, cursor] });
          }}>Next files</Button>
        </div>
      </div>
    </section>
  );
});
