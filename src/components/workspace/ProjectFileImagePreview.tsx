import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

interface ProjectFileImagePreviewProps {
  dataUrl: string;
  fileName: string;
  mediaType: string;
  size: number;
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

export function ProjectFileImagePreview({
  dataUrl,
  fileName,
  mediaType,
  size,
}: ProjectFileImagePreviewProps) {
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDimensions(null);
    setFailed(false);
  }, [dataUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))]">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {failed ? (
          <div className="flex flex-col items-center gap-2 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
            <ImageOff size={24} />
            <span>This image could not be decoded.</span>
          </div>
        ) : (
          <img
            src={dataUrl}
            alt={`Preview of ${fileName}`}
            className="block max-h-full max-w-full select-none object-contain shadow-[0_8px_30px_hsl(0_0%_0%/0.28)]"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="flex h-6 shrink-0 items-center justify-end gap-3 border-t border-[hsl(var(--wb-border-subtle))] px-3 text-[9px] text-[hsl(var(--wb-text-muted))]">
        {dimensions && <span>{dimensions}</span>}
        <span>{mediaType.replace("image/", "").toUpperCase()}</span>
        <span>{formatFileSize(size)}</span>
      </div>
    </div>
  );
}
