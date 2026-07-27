import { Check, Code2, Copy, Loader2, SquarePen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { isSqlAssistantCodeBlock } from "@/lib/assistantSqlPatch";
import { normalizeProjectRelativePath } from "@/services/tauri/project-files.service";

export type AssistantMessageBlock =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language?: string };

export function parseAssistantMessage(
  content: string | null | undefined,
): AssistantMessageBlock[] {
  if (typeof content !== "string" || content.length === 0) return [];
  const lines = content.split("\n");
  const blocks: AssistantMessageBlock[] = [];
  let textLines: string[] = [];
  let codeLines: string[] | null = null;
  let language: string | undefined;

  const flushText = () => {
    if (textLines.length === 0) return;
    blocks.push({ type: "text", content: textLines.join("\n") });
    textLines = [];
  };

  const flushCode = () => {
    if (!codeLines) return;
    blocks.push({
      type: "code",
      content: codeLines.join("\n"),
      ...(language ? { language } : {}),
    });
    codeLines = null;
    language = undefined;
  };

  lines.forEach((line) => {
    const fence = line.match(/^```([^`]*)$/);
    if (fence) {
      if (codeLines) {
        flushCode();
      } else {
        flushText();
        codeLines = [];
        language = fence[1]?.trim() || undefined;
      }
      return;
    }

    if (codeLines) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  });

  flushCode();
  flushText();
  return blocks;
}

export function AssistantMessageContent({
  content,
  onPreviewSqlPatch,
  trustedProjectFilePaths = [],
  onOpenProjectFile,
}: {
  content?: string | null;
  onPreviewSqlPatch?: (replacement: string) => void;
  trustedProjectFilePaths?: readonly string[];
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
}) {
  const blocks = parseAssistantMessage(content);
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);

  const copyBlock = async (index: number, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedBlock(index);
    window.setTimeout(() => setCopiedBlock((current) => (current === index ? null : current)), 1_500);
  };

  return (
    <div className="min-w-0 space-y-2" data-text-selectable="true">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <div
            key={`${block.type}-${index}`}
            className="overflow-hidden rounded-[5px] bg-[hsl(var(--wb-panel))]"
          >
            <div className="flex h-7 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] px-2 font-mono text-[9px] text-[hsl(var(--wb-text-muted))]">
              <Code2 size={10} />
              <span className="min-w-0 flex-1 truncate">{block.language || "code"}</span>
              {onPreviewSqlPatch &&
                isSqlAssistantCodeBlock(block.language) && (
                  <button
                    type="button"
                    className="wb-text-button h-5 gap-1 px-1.5 text-[9px]"
                    onClick={() => onPreviewSqlPatch(block.content)}
                    aria-label="Preview SQL in editor"
                    title="Create a revision-bound patch preview without running the query"
                  >
                    <SquarePen size={9} aria-hidden="true" />
                    Preview in editor
                  </button>
                )}
              <button
                type="button"
                className="wb-text-button h-5 gap-1 px-1.5 text-[9px]"
                onClick={() => void copyBlock(index, block.content)}
                aria-label={`Copy ${block.language || "code"} block`}
              >
                {copiedBlock === index ? <Check size={9} /> : <Copy size={9} />}
                {copiedBlock === index ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="custom-scrollbar max-h-72 overflow-auto p-2 font-mono text-[10px] leading-4 text-[hsl(var(--wb-text))]">
              <code>{block.content}</code>
            </pre>
          </div>
        ) : (
          <ProjectLinkedMarkdownText
            key={`${block.type}-${index}`}
            content={block.content}
            trustedProjectFilePaths={trustedProjectFilePaths}
            onOpenProjectFile={onOpenProjectFile}
          />
        )
      )}
    </div>
  );
}

function ProjectLinkedMarkdownText({
  content,
  trustedProjectFilePaths,
  onOpenProjectFile,
}: {
  content: string;
  trustedProjectFilePaths: readonly string[];
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
}) {
  const [openingProjectFile, setOpeningProjectFile] = useState<string | null>(
    null,
  );
  const [projectFileError, setProjectFileError] = useState<string | null>(null);
  const projectFilePaths = normalizeTrustedProjectFilePaths(
    trustedProjectFilePaths,
  );

  const openProjectFile = async (relativePath: string) => {
    if (!onOpenProjectFile || openingProjectFile) return;
    setOpeningProjectFile(relativePath);
    setProjectFileError(null);
    try {
      await onOpenProjectFile(relativePath);
    } catch (error) {
      setProjectFileError(
        error instanceof Error
          ? error.message
          : `Failed to open ${relativePath}`,
      );
    } finally {
      setOpeningProjectFile(null);
    }
  };

  return (
    <>
      <MarkdownText
        content={content}
        projectFilePaths={projectFilePaths}
        openingProjectFile={openingProjectFile}
        onOpenProjectFile={
          onOpenProjectFile ? (path) => void openProjectFile(path) : undefined
        }
      />
      {projectFileError && (
        <p role="alert" className="text-[9px] leading-4 text-amber-300">
          Could not open the project file: {projectFileError}
        </p>
      )}
    </>
  );
}

type ProjectFileMarkdownProps = {
  projectFilePaths: readonly string[];
  openingProjectFile: string | null;
  onOpenProjectFile?: (relativePath: string) => void;
};

function MarkdownText({
  content,
  ...fileProps
}: { content: string } & ProjectFileMarkdownProps) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(
        <div
          key={`heading-${index}`}
          className={
            level === 1
              ? "pt-1 text-[14px] font-semibold"
              : level === 2
                ? "pt-1 text-[13px] font-semibold"
                : "pt-0.5 text-[11px] font-semibold"
          }
        >
          <InlineMarkdown value={heading[2] || ""} {...fileProps} />
        </div>,
      );
      index += 1;
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/u);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/u);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index] || "";
        const match = orderedList
          ? candidate.match(/^\s*\d+[.)]\s+(.+)$/u)
          : candidate.match(/^\s*[-*+]\s+(.+)$/u);
        if (!match) break;
        items.push(match[1] || "");
        index += 1;
      }
      const List = orderedList ? "ol" : "ul";
      blocks.push(
        <List
          key={`list-${index}-${orderedList ? "ol" : "ul"}`}
          className={orderedList ? "ml-5 list-decimal space-y-1" : "ml-5 list-disc space-y-1"}
        >
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item.slice(0, 20)}`} className="pl-0.5">
              <InlineMarkdown value={item} {...fileProps} />
            </li>
          ))}
        </List>,
      );
      continue;
    }

    if (/^\s*>\s?/u.test(line)) {
      const quote: string[] = [];
      while (
        index < lines.length &&
        /^\s*>\s?/u.test(lines[index] || "")
      ) {
        quote.push((lines[index] || "").replace(/^\s*>\s?/u, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-2 border-[hsl(var(--wb-border-strong))] pl-2 text-[hsl(var(--wb-text-muted))]"
        >
          <InlineMarkdown value={quote.join(" ")} {...fileProps} />
        </blockquote>,
      );
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(
        lines[index + 1] || "",
      )
    ) {
      const headers = markdownTableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (
        index < lines.length &&
        (lines[index] || "").includes("|") &&
        (lines[index] || "").trim()
      ) {
        rows.push(markdownTableCells(lines[index] || ""));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="custom-scrollbar overflow-x-auto">
          <table className="w-full border-collapse text-left text-[10px]">
            <thead>
              <tr>
                {headers.map((header, columnIndex) => (
                  <th
                    key={`${columnIndex}-${header}`}
                    className="border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1 font-medium"
                  >
                    <InlineMarkdown value={header} {...fileProps} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, columnIndex) => (
                    <td
                      key={columnIndex}
                      className="border border-[hsl(var(--wb-border-subtle))] px-2 py-1 align-top"
                    >
                      <InlineMarkdown
                        value={row[columnIndex] || ""}
                        {...fileProps}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] || "").trim() &&
      !/^(#{1,4})\s+|^\s*[-*+]\s+|^\s*\d+[.)]\s+|^\s*>\s?/u.test(
        lines[index] || "",
      )
    ) {
      paragraph.push(lines[index] || "");
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap break-words">
        <InlineMarkdown value={paragraph.join("\n")} {...fileProps} />
      </p>,
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}

function InlineMarkdown({
  value,
  projectFilePaths,
  openingProjectFile,
  onOpenProjectFile,
}: { value: string } & ProjectFileMarkdownProps) {
  const tokens = value.split(
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/gu,
  );
  return (
    <>
      {tokens.filter(Boolean).map((token, index) => {
        if (token.startsWith("**") && token.endsWith("**")) {
          return (
            <strong key={index}>
              <InlineMarkdown
                value={token.slice(2, -2)}
                projectFilePaths={projectFilePaths}
                openingProjectFile={openingProjectFile}
                onOpenProjectFile={onOpenProjectFile}
              />
            </strong>
          );
        }
        if (token.startsWith("`") && token.endsWith("`")) {
          const codeValue = token.slice(1, -1);
          if (
            onOpenProjectFile &&
            projectFilePaths.includes(codeValue)
          ) {
            return (
              <ProjectFileLink
                key={index}
                relativePath={codeValue}
                opening={openingProjectFile === codeValue}
                onOpen={onOpenProjectFile}
                code
              />
            );
          }
          return (
            <code
              key={index}
              className="rounded-[3px] bg-[hsl(var(--wb-panel))] px-1 py-0.5 font-mono text-[10px]"
            >
              {codeValue}
            </code>
          );
        }
        const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/u);
        if (link) {
          return (
            <a
              key={index}
              href={link[2]}
              target="_blank"
              rel="noreferrer"
              className="text-[hsl(var(--wb-accent))] underline underline-offset-2 hover:brightness-110"
            >
              {link[1]}
            </a>
          );
        }
        return (
          <TrustedProjectFileText
            key={index}
            value={token}
            projectFilePaths={projectFilePaths}
            openingProjectFile={openingProjectFile}
            onOpenProjectFile={onOpenProjectFile}
          />
        );
      })}
    </>
  );
}

function TrustedProjectFileText({
  value,
  projectFilePaths,
  openingProjectFile,
  onOpenProjectFile,
}: { value: string } & ProjectFileMarkdownProps) {
  if (!onOpenProjectFile || projectFilePaths.length === 0) return value;
  const segments = splitTrustedProjectFileText(value, projectFilePaths);
  return (
    <>
      {segments.map((segment, index) =>
        segment.relativePath ? (
          <ProjectFileLink
            key={`${segment.relativePath}-${index}`}
            relativePath={segment.relativePath}
            opening={openingProjectFile === segment.relativePath}
            onOpen={onOpenProjectFile}
          />
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

function ProjectFileLink({
  relativePath,
  opening,
  onOpen,
  code = false,
}: {
  relativePath: string;
  opening: boolean;
  onOpen: (relativePath: string) => void;
  code?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        code
          ? "inline rounded-[3px] bg-[hsl(var(--wb-panel))] px-1 py-0.5 font-mono text-[10px] text-[hsl(var(--wb-accent))] underline underline-offset-2 outline-none hover:brightness-110 focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-60"
          : "inline break-all rounded-[2px] font-mono text-[10px] text-[hsl(var(--wb-accent))] underline underline-offset-2 outline-none hover:brightness-110 focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-60"
      }
      disabled={opening}
      onClick={() => onOpen(relativePath)}
      aria-label={`Open ${relativePath} in editor`}
      title="Open project file in editor"
    >
      {relativePath}
      {opening && (
        <Loader2
          size={9}
          className="ml-1 inline animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

type TrustedProjectFileTextSegment = {
  text: string;
  relativePath?: string;
};

function splitTrustedProjectFileText(
  value: string,
  paths: readonly string[],
): TrustedProjectFileTextSegment[] {
  const segments: TrustedProjectFileTextSegment[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const match = nextTrustedProjectFileMatch(value, paths, cursor);
    if (!match) {
      segments.push({ text: value.slice(cursor) });
      break;
    }
    if (match.index > cursor) {
      segments.push({ text: value.slice(cursor, match.index) });
    }
    segments.push({ text: match.path, relativePath: match.path });
    cursor = match.index + match.path.length;
  }
  return segments.length > 0 ? segments : [{ text: value }];
}

function nextTrustedProjectFileMatch(
  value: string,
  paths: readonly string[],
  from: number,
) {
  let best: { index: number; path: string } | null = null;
  for (const path of paths) {
    let index = value.indexOf(path, from);
    while (index >= 0) {
      const before = index > 0 ? value[index - 1] : undefined;
      const end = index + path.length;
      const after = end < value.length ? value[end] : undefined;
      if (isProjectPathBoundary(before) && isProjectPathBoundary(after)) {
        if (
          !best ||
          index < best.index ||
          (index === best.index && path.length > best.path.length)
        ) {
          best = { index, path };
        }
        break;
      }
      index = value.indexOf(path, index + 1);
    }
  }
  return best;
}

function isProjectPathBoundary(value: string | undefined) {
  return (
    value === undefined ||
    /[\s"'`(){}\[\]<>:=：,，。;；!?！？【】]/u.test(value)
  );
}

function normalizeTrustedProjectFilePaths(paths: readonly string[]) {
  const normalized = new Set<string>();
  for (const path of paths) {
    try {
      normalized.add(normalizeProjectRelativePath(path));
    } catch {
      // Trusted file events are validated at the protocol boundary. Ignore a
      // malformed restored entry rather than turning model text into a link.
    }
  }
  return [...normalized].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
}

function markdownTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}
