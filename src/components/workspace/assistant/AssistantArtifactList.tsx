import {
  agentHostService,
  type AgentArtifactReadResult,
  type AgentArtifactSearchResult,
} from "@/services/tauri/agent-host.service";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  CircleAlert,
  Download,
  FileJson2,
  Loader2,
  Search,
} from "lucide-react";
import { useState, type FormEvent, type SyntheticEvent } from "react";

const ARTIFACT_PREVIEW_BYTES = 16 * 1024;

export function AssistantArtifactList({
  projectId,
  artifactRefs,
}: {
  projectId: string;
  artifactRefs: string[];
}) {
  const references = [...new Set(artifactRefs.filter(Boolean))];
  if (references.length === 0) return null;
  return (
    <div
      className="mt-2 divide-y divide-[hsl(var(--wb-border-subtle))] border-y border-[hsl(var(--wb-border-subtle))]"
      aria-label="Offloaded AI tool results"
    >
      {references.map((artifactRef, index) => (
        <AssistantArtifactDisclosure
          key={artifactRef}
          projectId={projectId}
          artifactRef={artifactRef}
          ordinal={index + 1}
        />
      ))}
    </div>
  );
}

function AssistantArtifactDisclosure({
  projectId,
  artifactRef,
  ordinal,
}: {
  projectId: string;
  artifactRef: string;
  ordinal: number;
}) {
  const [preview, setPreview] = useState<AgentArtifactReadResult | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] =
    useState<AgentArtifactSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const loadRange = async (offset: number, append = false) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await agentHostService.readArtifact({
        projectId,
        artifactId: artifactRef,
        offset,
        maxBytes: ARTIFACT_PREVIEW_BYTES,
      });
      setPreview(result);
      setPreviewContent((current) =>
        append && result.offset > 0 ? `${current}${result.content}` : result.content,
      );
      if (!result.found) {
        setError("This tool result has expired or was cleared.");
      }
    } catch (reason) {
      setError(artifactError(reason, "Could not preview this tool result."));
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && !preview && !loading) {
      void loadRange(0);
    }
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const searchQuery = query.trim();
    if (!searchQuery || searching) return;
    setSearching(true);
    setError(null);
    try {
      const result = await agentHostService.searchArtifact({
        projectId,
        artifactId: artifactRef,
        query: searchQuery,
        maxMatches: 8,
        contextBytes: 96,
      });
      setSearchResult(result);
      if (!result.found) {
        setError("This tool result has expired or was cleared.");
      }
    } catch (reason) {
      setError(artifactError(reason, "Could not search this tool result."));
    } finally {
      setSearching(false);
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    setExportMessage(null);
    try {
      const result = await agentHostService.exportArtifact({
        projectId,
        artifactId: artifactRef,
        suggestedFileName: `oxide-agent-result-${ordinal}.json`,
      });
      if (result.exported) {
        setExportMessage(
          `Exported ${formatBytes(result.byteCount)}${result.filePath ? ` · ${result.filePath}` : ""}`,
        );
      }
    } catch (reason) {
      setError(artifactError(reason, "Could not export this tool result."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <details className="group" onToggle={handleToggle}>
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 px-1 py-1 text-[10px] text-[hsl(var(--wb-text-muted))] outline-none marker:content-none hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={10}
          className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
        <FileJson2 size={11} className="shrink-0 text-[hsl(var(--wb-accent))]" />
        <span className="font-medium text-[hsl(var(--wb-text))]">
          Offloaded tool result
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[9px]">
          {shortArtifactId(artifactRef)}
        </span>
        {preview?.found && (
          <span className="shrink-0 text-[9px]">
            {formatBytes(preview.totalBytes)}
          </span>
        )}
      </summary>

      <div className="pb-2 pl-[25px] pr-1">
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          <form
            className="flex min-w-[180px] flex-1 items-center gap-1"
            onSubmit={handleSearch}
          >
            <label className="sr-only" htmlFor={`artifact-search-${artifactRef}`}>
              Search this tool result
            </label>
            <input
              id={`artifact-search-${artifactRef}`}
              value={query}
              maxLength={256}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find in result"
              className="h-6 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-transparent px-1.5 text-[9px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent)/0.72)]"
            />
            <button
              type="submit"
              disabled={!query.trim() || searching}
              className="flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[9px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? (
                <Loader2 size={10} className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Search size={10} />
              )}
              Find
            </button>
          </form>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[9px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-wait disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 size={10} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Download size={10} />
            )}
            Export JSON
          </button>
        </div>

        {searchResult && (
          <div className="mb-1 divide-y divide-[hsl(var(--wb-border-subtle))] text-[9px]">
            {searchResult.matches.length === 0 ? (
              <p className="py-1 text-[hsl(var(--wb-text-muted))]">
                No matches for “{searchResult.query}”.
              </p>
            ) : (
              searchResult.matches.map((match) => (
                <button
                  key={`${match.offset}:${match.length}`}
                  type="button"
                  className="block w-full py-1 text-left font-mono leading-4 text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() => void loadRange(match.snippetOffset)}
                  title={`Show byte ${match.offset.toLocaleString()}`}
                >
                  <span className="mr-1 text-[hsl(var(--wb-accent))]">
                    {match.offset.toLocaleString()}
                  </span>
                  {compactSnippet(match.snippet)}
                </button>
              ))
            )}
          </div>
        )}

        {loading && !preview && (
          <div className="flex min-h-8 items-center gap-1.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
            <Loader2 size={10} className="animate-spin motion-reduce:animate-none" />
            Reading encrypted result…
          </div>
        )}

        {preview?.found && (
          <>
            <div className="mb-1 flex items-center justify-between text-[8px] text-[hsl(var(--wb-text-muted))]">
              <span>
                Bytes {preview.offset.toLocaleString()}–
                {preview.nextOffset.toLocaleString()} of{" "}
                {preview.totalBytes.toLocaleString()}
              </span>
              {!preview.eof && preview.nextOffset > preview.offset && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void loadRange(preview.nextOffset, true)}
                  className="rounded-[3px] px-1 py-0.5 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-wait"
                >
                  {loading ? "Loading…" : "Load next range"}
                </button>
              )}
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words bg-black/10 px-2 py-1.5 font-mono text-[9px] leading-4 text-[hsl(var(--wb-text))]">
              {previewContent}
            </pre>
          </>
        )}

        {(error || exportMessage) && (
          <p
            className={cn(
              "mt-1 flex items-start gap-1 text-[9px] leading-4",
              error
                ? "text-amber-300"
                : "text-[hsl(var(--wb-text-muted))]",
            )}
            role="status"
            title={exportMessage ?? undefined}
          >
            {error && <CircleAlert size={10} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 truncate">{error || exportMessage}</span>
          </p>
        )}
      </div>
    </details>
  );
}

function artifactError(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return fallback;
}

function shortArtifactId(artifactRef: string) {
  if (artifactRef.length <= 30) return artifactRef;
  return `${artifactRef.slice(0, 18)}…${artifactRef.slice(-8)}`;
}

function compactSnippet(value: string) {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
