import { Checkbox } from "@/components/ui/checkbox";
import { openProjectGitDiffInEditor } from "@/lib/projectFileOpen";
import { assistantFileChangeAttributions } from "@/lib/assistantFileChanges";
import { cn } from "@/lib/utils";
import type { ProjectGitWorkspaceFile } from "@/services/tauri/project-git.service";
import { useProjectStore } from "@/store/useProjectStore";
import { useProjectGitStore } from "@/store/useProjectGitStore";
import { useAssistantChangeStore } from "@/store/useAssistantChangeStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FilePlus2,
  FileX2,
  GitCommitHorizontal,
  LoaderCircle,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useMemo } from "react";

type ChangeGroup = {
  id: "conflicts" | "staged" | "changes" | "untracked";
  label: string;
  files: ProjectGitWorkspaceFile[];
};

const EMPTY_ASSISTANT_TURNS: never[] = [];

export function CommitPanel() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const project = useProjectStore((state) =>
    state.projects.find((candidate) => candidate.id === state.activeProjectId),
  );
  const session = useProjectGitStore((state) => state.sessions[activeProjectId]);
  const assistantTurns = useAssistantChangeStore(
    (state) => state.turnsByProject[activeProjectId] ?? EMPTY_ASSISTANT_TURNS,
  );
  const ensureSession = useProjectGitStore((state) => state.ensureSession);
  const updateSession = useProjectGitStore((state) => state.updateSession);
  const refresh = useProjectGitStore((state) => state.refresh);
  const initialize = useProjectGitStore((state) => state.initialize);
  const stage = useProjectGitStore((state) => state.stage);
  const unstage = useProjectGitStore((state) => state.unstage);
  const commit = useProjectGitStore((state) => state.commit);
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (state) => state.setToolWindowVisible,
  );
  const rootPath = project?.root_path || null;

  useEffect(() => {
    ensureSession(activeProjectId, rootPath);
    void refresh(activeProjectId, rootPath);
  }, [activeProjectId, ensureSession, refresh, rootPath]);

  const repository = session?.repository;
  const allFiles = repository?.files ?? [];
  const attributions = useMemo(
    () => assistantFileChangeAttributions(assistantTurns),
    [assistantTurns],
  );
  const assistantFilter = session?.assistantFilter ?? "all";
  const attributedPaths = useMemo(() => {
    if (assistantFilter === "all") return null;
    const turnId = assistantFilter.startsWith("turn:")
      ? assistantFilter.slice("turn:".length)
      : "";
    return new Set(
      attributions
        .filter((change) => change.turnId === turnId)
        .map((change) => change.relativePath),
    );
  }, [assistantFilter, attributions]);
  const files = attributedPaths
    ? allFiles.filter((file) => attributedPaths.has(file.relativePath))
    : allFiles;
  const groups = useMemo<ChangeGroup[]>(() => {
    const conflicts = files.filter((file) => file.conflicted);
    const staged = files.filter((file) => file.staged && !file.conflicted);
    const changes = files.filter(
      (file) => file.unstaged && !file.untracked && !file.conflicted,
    );
    const untracked = files.filter((file) => file.untracked && !file.conflicted);
    return [
      { id: "conflicts", label: "Conflicts", files: conflicts },
      { id: "staged", label: "Staged changes", files: staged },
      { id: "changes", label: "Changes", files: changes },
      { id: "untracked", label: "Untracked files", files: untracked },
    ].filter((group) => group.files.length > 0) as ChangeGroup[];
  }, [files]);
  const selectedPaths = session?.selectedPaths ?? [];
  const selectedFiles = files.filter((file) =>
    selectedPaths.includes(file.relativePath),
  );
  const selectedStageable = selectedFiles.filter(
    (file) => file.unstaged || file.untracked,
  );
  const selectedUnstageable = selectedFiles.filter((file) => file.staged);
  const stagedFiles = allFiles.filter((file) => file.staged);
  const stagedAdditions = stagedFiles.reduce(
    (total, file) => total + file.additions,
    0,
  );
  const stagedDeletions = stagedFiles.reduce(
    (total, file) => total + file.deletions,
    0,
  );
  const hasConflicts = allFiles.some((file) => file.conflicted);
  const busy = Boolean(session?.operation);

  const toggleSelected = (path: string, checked: boolean) => {
    const next = new Set(selectedPaths);
    if (checked) next.add(path);
    else next.delete(path);
    updateSession(activeProjectId, { selectedPaths: [...next] });
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-panel))] text-[hsl(var(--wb-text))]" aria-label="Commit">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-2">
        <GitCommitHorizontal size={13} className="text-[hsl(var(--wb-accent))]" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">Commit</span>
        {repository?.branch && (
          <span className="max-w-28 truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]" title={repository.branch}>
            {repository.branch}
          </span>
        )}
        <button type="button" className="wb-icon-button h-6 w-6" disabled={session?.loading} onClick={() => void refresh(activeProjectId, rootPath)} title="Refresh changes">
          <RefreshCw size={11} className={session?.loading ? "animate-spin motion-reduce:animate-none" : ""} />
        </button>
        <button type="button" className="wb-icon-button h-6 w-6" onClick={() => setToolWindowVisible("commit", false)} title="Hide Commit">
          <X size={11} />
        </button>
      </header>

      {session?.error && (
        <div role="alert" className="border-b border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[9px] leading-4 text-red-400">
          {session.error}
        </div>
      )}
      {session?.notice && (
        <div role="status" className="border-b border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-[9px] leading-4 text-emerald-400">
          {session.notice}
        </div>
      )}

      {!rootPath || project?.origin === "managed" ? (
        <PanelEmpty
          title="No local project directory"
          detail="Link a local project directory before using Git version control."
        />
      ) : session?.loading && !repository ? (
        <PanelLoading label="Loading project changes…" />
      ) : repository && !repository.isRepository ? (
        <PanelEmpty
          title="No Git repository"
          detail="Initialize Git in this project. Existing files are not committed automatically."
          action="Initialize Git"
          disabled={busy}
          onAction={() => void initialize(activeProjectId, rootPath)}
        />
      ) : (
        <>
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-2">
            {attributions.length > 0 && (
              <select
                value={assistantFilter}
                onChange={(event) =>
                  updateSession(activeProjectId, {
                    assistantFilter: event.currentTarget.value,
                    selectedPaths: [],
                  })
                }
                aria-label="Filter changes by Agent turn"
                className="h-6 min-w-0 max-w-28 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-1 text-[8px] outline-none"
              >
                <option value="all">All changes</option>
                {[...new Map(attributions.map((change) => [change.turnId, change])).values()].map((change) => (
                  <option key={change.turnId} value={`turn:${change.turnId}`}>
                    Agent · {change.turnId.slice(-8)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="wb-text-button h-6 px-2 text-[9px]"
              disabled={!selectedStageable.length || busy}
              onClick={() => void stage(activeProjectId, selectedStageable.map((file) => file.relativePath))}
            >
              Stage selected
            </button>
            <button
              type="button"
              className="wb-text-button h-6 px-2 text-[9px]"
              disabled={!selectedUnstageable.length || busy}
              onClick={() => void unstage(activeProjectId, selectedUnstageable.map((file) => file.relativePath))}
            >
              Unstage selected
            </button>
            <span className="ml-auto text-[9px] tabular-nums text-[hsl(var(--wb-text-muted))]">
              {files.length}{files.length !== allFiles.length ? `/${allFiles.length}` : ""} file{files.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            {groups.length ? (
              groups.map((group) => (
                <ChangeSection
                  key={group.id}
                  group={group}
                  selectedPaths={selectedPaths}
                  busy={busy}
                  projectId={activeProjectId}
                  rootPath={rootPath}
                  onToggle={toggleSelected}
                  onStage={(file) => void stage(activeProjectId, [file.relativePath])}
                  onUnstage={(file) => void unstage(activeProjectId, [file.relativePath])}
                />
              ))
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[10px] text-[hsl(var(--wb-text-muted))]">
                Working tree clean
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.45)] p-2">
            <textarea
              value={session?.commitMessage ?? ""}
              onChange={(event) => updateSession(activeProjectId, { commitMessage: event.currentTarget.value })}
              spellCheck
              rows={3}
              placeholder="Commit message"
              className="w-full resize-none rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 py-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--wb-accent))]"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
                {stagedFiles.length} staged · <span className="text-emerald-400">+{stagedAdditions}</span>{" "}
                <span className="text-red-400">-{stagedDeletions}</span>
                {hasConflicts && " · Resolve conflicts before committing"}
              </span>
              <button
                type="button"
                className="wb-primary-button h-7 px-3 text-[10px]"
                disabled={busy || !stagedFiles.length || hasConflicts || !session?.commitMessage.trim()}
                onClick={() => void commit(activeProjectId)}
              >
                {session?.operation === "commit" ? <LoaderCircle size={11} className="animate-spin" /> : <Check size={11} />}
                Commit
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ChangeSection({
  group,
  selectedPaths,
  busy,
  projectId,
  rootPath,
  onToggle,
  onStage,
  onUnstage,
}: {
  group: ChangeGroup;
  selectedPaths: string[];
  busy: boolean;
  projectId: string;
  rootPath: string;
  onToggle: (path: string, checked: boolean) => void;
  onStage: (file: ProjectGitWorkspaceFile) => void;
  onUnstage: (file: ProjectGitWorkspaceFile) => void;
}) {
  return (
    <section>
      <div className="sticky top-0 z-10 flex h-6 items-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
        {group.label}
        <span className="ml-auto tabular-nums">{group.files.length}</span>
      </div>
      {group.files.map((file) => {
        const scope: "staged" | "working" =
          file.staged && !file.unstaged ? "staged" : "working";
        return (
          <div key={`${group.id}:${file.relativePath}`} className="group flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle)/0.45)] px-2 text-[10px] hover:bg-[hsl(var(--wb-hover))]">
            <Checkbox checked={selectedPaths.includes(file.relativePath)} aria-label={`Select ${file.relativePath}`} onCheckedChange={(value) => onToggle(file.relativePath, value === true)} />
            <ChangeIcon file={file} />
            <button type="button" className="min-w-0 flex-1 truncate text-left outline-none" title={file.relativePath} onClick={() => void openProjectGitDiffInEditor(projectId, file.relativePath, rootPath, scope)}>
              {file.relativePath}
            </button>
            <span className="shrink-0 font-mono text-[8px] tabular-nums">
              <span className="text-emerald-400">+{file.additions}</span>{" "}
              <span className="text-red-400">-{file.deletions}</span>
            </span>
            <button
              type="button"
              disabled={busy}
              className={cn("h-5 shrink-0 px-1 text-[8px] text-[hsl(var(--wb-text-muted))] opacity-0 hover:text-[hsl(var(--wb-text))] focus-visible:opacity-100 group-hover:opacity-100", file.conflicted && "invisible")}
              onClick={() => (group.id === "staged" ? onUnstage(file) : onStage(file))}
            >
              {group.id === "staged" ? "Unstage" : "Stage"}
            </button>
            <ChevronRight size={10} className="shrink-0 text-[hsl(var(--wb-text-muted))] opacity-0 group-hover:opacity-100" />
          </div>
        );
      })}
    </section>
  );
}

function ChangeIcon({ file }: { file: ProjectGitWorkspaceFile }) {
  const className = "shrink-0 text-[hsl(var(--wb-text-muted))]";
  if (file.conflicted) return <AlertTriangle size={11} className="shrink-0 text-amber-400" />;
  if (file.status === "added" || file.untracked) return <FilePlus2 size={11} className={className} />;
  if (file.status === "deleted") return <FileX2 size={11} className={className} />;
  return <Pencil size={11} className={className} />;
}

function PanelLoading({ label }: { label: string }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-[10px] text-[hsl(var(--wb-text-muted))]"><LoaderCircle size={12} className="mr-2 animate-spin" />{label}</div>;
}

function PanelEmpty({ title, detail, action, disabled, onAction }: { title: string; detail: string; action?: string; disabled?: boolean; onAction?: () => void }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"><GitCommitHorizontal size={18} className="mb-2 text-[hsl(var(--wb-text-muted))]" /><div className="text-[11px] font-medium">{title}</div><p className="mt-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">{detail}</p>{action && <button type="button" className="wb-primary-button mt-3 h-7 px-3 text-[10px]" disabled={disabled} onClick={onAction}>{action}</button>}</div>;
}
