import { Code2 } from "lucide-react";

export type AssistantMessageBlock =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language?: string };

export function parseAssistantMessage(content: string): AssistantMessageBlock[] {
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

export function AssistantMessageContent({ content }: { content: string }) {
  const blocks = parseAssistantMessage(content);

  return (
    <div className="min-w-0 space-y-2" data-text-selectable="true">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <div
            key={`${block.type}-${index}`}
            className="overflow-hidden rounded-[5px] bg-[hsl(var(--wb-panel))]"
          >
            <div className="flex h-6 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] px-2 font-mono text-[9px] text-[hsl(var(--wb-text-muted))]">
              <Code2 size={10} />
              {block.language || "code"}
            </div>
            <pre className="custom-scrollbar max-h-72 overflow-auto p-2 font-mono text-[10px] leading-4 text-[hsl(var(--wb-text))]">
              <code>{block.content}</code>
            </pre>
          </div>
        ) : (
          <div
            key={`${block.type}-${index}`}
            className="whitespace-pre-wrap break-words"
          >
            {block.content}
          </div>
        )
      )}
    </div>
  );
}
