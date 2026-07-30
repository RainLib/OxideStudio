import { cn } from "@/lib/utils";
import type { ProjectGitRepository } from "@/services/tauri/project-git.service";
import { useProjectStore } from "@/store/useProjectStore";
import {
  type VersionControlView,
  useProjectGitStore,
} from "@/store/useProjectGitStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clipboard,
  CloudDownload,
  GitBranch,
  GitFork,
  History,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  X,
} from "lucide-react";
import { useEffect } from "react";

const VIEWS: Array<[VersionControlView, typeof History, string]> = [
  ["log", History, "Log"],
  ["branches", GitBranch, "Branches"],
  ["remotes", Server, "Remotes"],
  ["patches", Clipboard, "Patches"],
];

export function VersionControlPanel() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const project = useProjectStore((state) =>
    state.projects.find((candidate) => candidate.id === state.activeProjectId),
  );
  const session = useProjectGitStore((state) => state.sessions[activeProjectId]);
  const ensureSession = useProjectGitStore((state) => state.ensureSession);
  const updateSession = useProjectGitStore((state) => state.updateSession);
  const refresh = useProjectGitStore((state) => state.refresh);
  const initialize = useProjectGitStore((state) => state.initialize);
  const fetchRepository = useProjectGitStore((state) => state.fetch);
  const pull = useProjectGitStore((state) => state.pull);
  const push = useProjectGitStore((state) => state.push);
  const createBranch = useProjectGitStore((state) => state.createBranch);
  const checkoutBranch = useProjectGitStore((state) => state.checkoutBranch);
  const saveRemote = useProjectGitStore((state) => state.saveRemote);
  const loadPatch = useProjectGitStore((state) => state.loadPatch);
  const applyPatch = useProjectGitStore((state) => state.applyPatch);
  const loadCommitFiles = useProjectGitStore((state) => state.loadCommitFiles);
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (state) => state.setToolWindowVisible,
  );
  const rootPath = project?.root_path || null;

  useEffect(() => {
    ensureSession(activeProjectId, rootPath);
    void refresh(activeProjectId, rootPath);
  }, [activeProjectId, ensureSession, refresh, rootPath]);

  const repository = session?.repository;
  const busy = Boolean(session?.operation);
  const view = session?.versionView ?? "log";

  return (
    <section className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-panel))] text-[hsl(var(--wb-text))]" aria-label="Version Control">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-2">
        <GitFork size={13} className="text-[hsl(var(--wb-accent))]" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">Version Control</span>
        {repository?.branch && (
          <span className="max-w-28 truncate font-mono text-[9px]" title={repository.branch}>{repository.branch}</span>
        )}
        <button type="button" className="wb-icon-button h-6 w-6" disabled={session?.loading} onClick={() => void refresh(activeProjectId, rootPath)} title="Refresh repository">
          <RefreshCw size={11} className={session?.loading ? "animate-spin" : ""} />
        </button>
        <button type="button" className="wb-icon-button h-6 w-6" onClick={() => setToolWindowVisible("versionControl", false)} title="Hide Version Control"><X size={11} /></button>
      </header>

      {repository?.isRepository && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-2">
          <GitAction icon={CloudDownload} label="Fetch" busy={session?.operation === "fetch"} disabled={busy} onClick={() => void fetchRepository(activeProjectId)} />
          <GitAction icon={ArrowDownToLine} label="Pull" busy={session?.operation === "pull"} disabled={busy} onClick={() => void pull(activeProjectId)} />
          <GitAction icon={ArrowUpFromLine} label="Push" busy={session?.operation === "push"} disabled={busy} onClick={() => void push(activeProjectId)} />
          <span className="ml-auto whitespace-nowrap text-[8px] text-[hsl(var(--wb-text-muted))]">
            {repository.ahead > 0 && `↑${repository.ahead} `}
            {repository.behind > 0 && `↓${repository.behind} `}
            {repository.upstream || repository.head || "No upstream"}
          </span>
        </div>
      )}

      {session?.error && <div role="alert" className="border-b border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[9px] leading-4 text-red-400">{session.error}</div>}
      {session?.notice && <div role="status" className="border-b border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-[9px] leading-4 text-emerald-400">{session.notice}</div>}

      {!rootPath || project?.origin === "managed" ? (
        <PanelEmpty title="No local project directory" detail="Link a local directory before using version control." />
      ) : session?.loading && !repository ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[10px] text-[hsl(var(--wb-text-muted))]"><LoaderCircle size={12} className="mr-2 animate-spin" />Loading repository…</div>
      ) : repository && !repository.isRepository ? (
        <PanelEmpty title="No Git repository" detail="Initialize Git to begin tracking this project." action="Initialize Git" disabled={busy} onAction={() => void initialize(activeProjectId, rootPath)} />
      ) : repository ? (
        <>
          <nav className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[hsl(var(--wb-border-subtle))] px-1" aria-label="Version control views">
            {VIEWS.map(([id, Icon, label]) => (
              <button key={id} type="button" className={cn("flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[9px]", view === id ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]" : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]")} onClick={() => updateSession(activeProjectId, { versionView: id })}>
                <Icon size={10} />{label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-hidden">
            {view === "log" ? (
              <LogView
                repository={repository}
                selectedCommitHash={session?.selectedCommitHash ?? null}
                commitFiles={session?.commitFiles ?? null}
                loading={session?.commitFilesLoading ?? false}
                onSelect={(revision) => void loadCommitFiles(activeProjectId, revision)}
              />
            ) : view === "branches" ? (
              <BranchesView
                repository={repository}
                branchName={session?.branchName ?? ""}
                busy={busy}
                onBranchName={(branchName) => updateSession(activeProjectId, { branchName })}
                onCreate={() => void createBranch(activeProjectId)}
                onCheckout={(branch) => void checkoutBranch(activeProjectId, branch)}
              />
            ) : view === "remotes" ? (
              <RemotesView
                repository={repository}
                remoteName={session?.remoteName ?? "origin"}
                remoteUrl={session?.remoteUrl ?? ""}
                busy={busy}
                onName={(remoteName) => updateSession(activeProjectId, { remoteName })}
                onUrl={(remoteUrl) => updateSession(activeProjectId, { remoteUrl })}
                onSave={() => void saveRemote(activeProjectId)}
              />
            ) : (
              <PatchesView
                session={session}
                busy={busy}
                onUpdate={(patch) => updateSession(activeProjectId, patch)}
                onLoad={() => void loadPatch(activeProjectId)}
                onApply={(reverse) => void applyPatch(activeProjectId, reverse)}
              />
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function GitAction({ icon: Icon, label, busy, disabled, onClick }: { icon: typeof RefreshCw; label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="wb-text-button h-6 px-1.5 text-[8px]" disabled={disabled} onClick={onClick}>{busy ? <LoaderCircle size={9} className="animate-spin" /> : <Icon size={9} />}{label}</button>;
}

function LogView({ repository, selectedCommitHash, commitFiles, loading, onSelect }: { repository: ProjectGitRepository; selectedCommitHash: string | null; commitFiles: ReturnType<typeof useProjectGitStore.getState>["sessions"][string]["commitFiles"]; loading: boolean; onSelect: (revision: string) => void }) {
  const selectedCommit = repository.commits.find((commit) => commit.hash === selectedCommitHash);
  return <div className="flex h-full min-h-0 flex-col"><div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">{repository.commits.map((commit) => <button type="button" key={commit.hash} aria-pressed={commit.hash === selectedCommitHash} className={cn("block w-full border-b border-[hsl(var(--wb-border-subtle))] px-2 py-2 text-left hover:bg-[hsl(var(--wb-hover))]", commit.hash === selectedCommitHash && "bg-[hsl(var(--wb-active))]")} onClick={() => onSelect(commit.hash)}><div className="flex items-baseline gap-2"><code className="shrink-0 text-[9px] text-[hsl(var(--wb-accent))]">{commit.shortHash}</code><span className="min-w-0 flex-1 truncate text-[10px]" title={commit.message}>{commit.message}</span></div><div className="mt-1 flex gap-2 text-[8px] text-[hsl(var(--wb-text-muted))]"><span className="min-w-0 flex-1 truncate">{commit.authorName}</span><time className="shrink-0">{formatTime(commit.timestamp)}</time></div></button>)}{repository.commits.length === 0 && <PanelEmpty title="No commits yet" detail="Stage files in Commit and create the first commit." />}</div>{selectedCommit && <section className="flex max-h-[45%] min-h-24 shrink-0 flex-col border-t border-[hsl(var(--wb-border))]" aria-label="Commit details"><div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1.5"><div className="truncate text-[9px] font-medium" title={selectedCommit.message}>{selectedCommit.message}</div><div className="mt-0.5 flex gap-2 text-[8px] text-[hsl(var(--wb-text-muted))]"><code>{selectedCommit.shortHash}</code><span className="min-w-0 truncate">{selectedCommit.authorName} &lt;{selectedCommit.authorEmail}&gt;</span></div></div><div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">{loading ? <div className="flex h-16 items-center justify-center text-[9px] text-[hsl(var(--wb-text-muted))]"><LoaderCircle size={10} className="mr-1.5 animate-spin" />Loading changed files…</div> : commitFiles?.files.map((file) => <div key={file.relativePath} className="flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle)/0.5)] px-2 text-[9px]"><FileText size={10} className="shrink-0 text-[hsl(var(--wb-text-muted))]" /><span className="min-w-0 flex-1 truncate" title={file.relativePath}>{file.relativePath}</span><span className="shrink-0 font-mono text-[8px]"><span className="text-emerald-400">+{file.additions}</span>{" "}<span className="text-red-400">-{file.deletions}</span></span></div>)}</div></section>}</div>;
}

function BranchesView({ repository, branchName, busy, onBranchName, onCreate, onCheckout }: { repository: ReturnType<typeof useProjectGitStore.getState>["sessions"][string]["repository"]; branchName: string; busy: boolean; onBranchName: (value: string) => void; onCreate: () => void; onCheckout: (branch: string) => void }) {
  return <div className="flex h-full min-h-0 flex-col"><div className="flex shrink-0 gap-1 border-b border-[hsl(var(--wb-border-subtle))] p-2"><input value={branchName} onChange={(event) => onBranchName(event.currentTarget.value)} placeholder="New branch" className="h-7 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[9px] outline-none focus:border-[hsl(var(--wb-accent))]" /><button type="button" className="wb-text-button h-7 px-2 text-[9px]" disabled={busy || !branchName.trim()} onClick={onCreate}><Plus size={10} />Create</button></div><div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">{repository.branches.map((branch) => <div key={`${branch.remote}:${branch.name}`} className="flex min-h-8 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2 text-[9px]"><GitBranch size={10} className={branch.current ? "text-[hsl(var(--wb-accent))]" : "text-[hsl(var(--wb-text-muted))]"} /><span className="min-w-0 flex-1 truncate" title={branch.name}>{branch.name}</span>{branch.current ? <span className="text-[8px] text-[hsl(var(--wb-accent))]">current</span> : !branch.remote && <button type="button" className="text-[8px] text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]" disabled={busy} onClick={() => onCheckout(branch.name)}>Checkout</button>}</div>)}</div></div>;
}

function RemotesView({ repository, remoteName, remoteUrl, busy, onName, onUrl, onSave }: { repository: ReturnType<typeof useProjectGitStore.getState>["sessions"][string]["repository"]; remoteName: string; remoteUrl: string; busy: boolean; onName: (value: string) => void; onUrl: (value: string) => void; onSave: () => void }) {
  return <div className="flex h-full min-h-0 flex-col"><div className="grid shrink-0 grid-cols-[80px_minmax(0,1fr)] gap-1 border-b border-[hsl(var(--wb-border-subtle))] p-2"><input value={remoteName} onChange={(event) => onName(event.currentTarget.value)} placeholder="Name" className="h-7 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[9px] outline-none" /><input value={remoteUrl} onChange={(event) => onUrl(event.currentTarget.value)} placeholder="Remote URL" className="h-7 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[8px] outline-none" /><button type="button" className="wb-text-button col-span-2 h-7 justify-center text-[9px]" disabled={busy || !remoteName.trim() || !remoteUrl.trim()} onClick={onSave}>Save remote</button></div><div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">{repository.remotes.map((remote) => <div key={remote.name} className="border-b border-[hsl(var(--wb-border-subtle))] px-2 py-2"><div className="text-[9px] font-medium">{remote.name}</div><div className="mt-1 truncate font-mono text-[8px] text-[hsl(var(--wb-text-muted))]" title={remote.fetchUrl}>{remote.fetchUrl}</div></div>)}</div></div>;
}

function PatchesView({ session, busy, onUpdate, onLoad, onApply }: { session: ReturnType<typeof useProjectGitStore.getState>["sessions"][string] | undefined; busy: boolean; onUpdate: (patch: Partial<NonNullable<typeof session>>) => void; onLoad: () => void; onApply: (reverse: boolean) => void }) {
  return <div className="flex h-full min-h-0 flex-col"><div className="flex shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] p-2"><select value={session?.patchScope ?? "working"} onChange={(event) => onUpdate({ patchScope: event.currentTarget.value as "working" | "staged" | "all" })} className="h-7 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-1 text-[9px]"><option value="working">Working tree</option><option value="staged">Staged</option><option value="all">Compared with HEAD</option></select><button type="button" className="wb-text-button h-7 px-2 text-[9px]" disabled={busy} onClick={onLoad}>Create</button></div><textarea value={session?.patchText ?? ""} onChange={(event) => onUpdate({ patchText: event.currentTarget.value })} placeholder="Create or paste a unified diff…" spellCheck={false} className="min-h-0 flex-1 resize-none bg-[hsl(var(--wb-editor))] p-2 font-mono text-[8px] leading-4 outline-none" /><div className="flex shrink-0 items-center gap-1 border-t border-[hsl(var(--wb-border-subtle))] p-2"><span className="min-w-0 flex-1 text-[8px] text-[hsl(var(--wb-text-muted))]">{session?.patchSummary && <><span className="text-emerald-400">+{session.patchSummary.additions}</span>{" "}<span className="text-red-400">-{session.patchSummary.deletions}</span></>}</span><button type="button" className="wb-text-button h-7 px-2 text-[9px]" disabled={busy || !session?.patchText.trim()} onClick={() => onApply(true)}><RotateCcw size={9} />Reverse</button><button type="button" className="wb-primary-button h-7 px-2 text-[9px]" disabled={busy || !session?.patchText.trim()} onClick={() => onApply(false)}>Apply</button></div></div>;
}

function PanelEmpty({ title, detail, action, disabled, onAction }: { title: string; detail: string; action?: string; disabled?: boolean; onAction?: () => void }) { return <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center"><GitFork size={18} className="mb-2 text-[hsl(var(--wb-text-muted))]" /><div className="text-[11px] font-medium">{title}</div><p className="mt-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">{detail}</p>{action && <button type="button" className="wb-primary-button mt-3 h-7 px-3 text-[10px]" disabled={disabled} onClick={onAction}>{action}</button>}</div>; }

function formatTime(timestamp: number) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1_000)); }
