import {
  type GitHubCliStatus,
  type GitHubRepository,
} from "@/services/tauri/project-git.service";
import { Check, Github, LoaderCircle } from "lucide-react";

export function GithubProjectSource({
  status,
  token,
  query,
  repositories,
  selectedRepository,
  loading,
  disabled,
  onTokenChange,
  onQueryChange,
  onAuthenticate,
  onRefresh,
  onSearch,
  onSelect,
}: {
  status: GitHubCliStatus | null;
  token: string;
  query: string;
  repositories: GitHubRepository[];
  selectedRepository: GitHubRepository | null;
  loading: boolean;
  disabled: boolean;
  onTokenChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onAuthenticate: () => void;
  onRefresh: () => void;
  onSearch: () => void;
  onSelect: (repository: GitHubRepository) => void;
}) {
  if (!status) {
    return (
      <div className="flex h-16 items-center justify-center rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-[10px] text-[hsl(var(--wb-text-muted))]">
        {loading ? (
          <>
            <LoaderCircle size={13} className="mr-2 animate-spin" />
            Checking GitHub CLI…
          </>
        ) : (
          <button
            type="button"
            className="wb-text-button h-7 px-3"
            onClick={onRefresh}
          >
            Check GitHub CLI
          </button>
        )}
      </div>
    );
  }

  if (!status.installed) {
    return (
      <div className="rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-3 py-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
        GitHub CLI (`gh`) was not found. Install it from cli.github.com, then
        refresh this check. Git URL cloning remains available without `gh`.
        <button
          type="button"
          className="ml-2 text-[hsl(var(--wb-accent))] hover:underline"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    );
  }

  if (!status.authenticated) {
    return (
      <div className="space-y-2 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3">
        <div className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          Authenticate `gh` with a GitHub token. OxideStudio sends it once on
          standard input and never stores it; credential storage is owned by
          `gh`.
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="GitHub personal access token"
            autoComplete="off"
            className="h-8 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
            disabled={disabled || loading}
          />
          <button
            type="button"
            className="wb-text-button h-8 px-3"
            disabled={!token.trim() || disabled || loading}
            onClick={onAuthenticate}
          >
            {loading && (
              <LoaderCircle size={12} className="mr-1 animate-spin" />
            )}
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Check size={11} />
          Signed in{status.account ? ` as ${status.account}` : ""}
        </span>
        {status.version && <span className="truncate">· {status.version}</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch();
            }
          }}
          placeholder="Search repositories by name, owner, or topic"
          className="h-8 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          disabled={disabled || loading}
        />
        <button
          type="button"
          className="wb-text-button h-8 px-3"
          disabled={!query.trim() || disabled || loading}
          onClick={onSearch}
        >
          {loading && <LoaderCircle size={12} className="mr-1 animate-spin" />}
          Search
        </button>
      </div>
      {repositories.length > 0 && (
        <div className="max-h-36 overflow-y-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))]">
          {repositories.map((repository) => {
            const selected =
              selectedRepository?.fullName === repository.fullName;
            return (
              <button
                key={repository.fullName}
                type="button"
                className={`flex w-full items-start gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2.5 py-2 text-left last:border-b-0 ${
                  selected
                    ? "bg-[hsl(var(--wb-active))]"
                    : "hover:bg-[hsl(var(--wb-hover))]"
                }`}
                onClick={() => onSelect(repository)}
              >
                <Github
                  size={13}
                  className={
                    selected
                      ? "mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
                      : "mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[11px]">
                    <strong className="truncate font-medium">
                      {repository.fullName}
                    </strong>
                    {repository.isPrivate && (
                      <span className="text-[8px] uppercase text-[hsl(var(--wb-text-muted))]">
                        private
                      </span>
                    )}
                  </span>
                  {repository.description && (
                    <span className="block truncate text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                      {repository.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[hsl(var(--wb-text-muted))]">
                  ★ {repository.stargazersCount}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
