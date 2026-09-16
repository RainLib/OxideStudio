import { parseElasticsearchConsoleServerVersion } from "@/features/query-editor/model/elasticsearchConsoleVersion";
import type { ElasticsearchServerVersion } from "@/lib/elasticsearchConsole";
import { connectionService } from "@/services/tauri";
import { useEffect, useState } from "react";

interface EditorServerVersionOptions {
  isElasticsearchConsole: boolean;
  effectiveConnectionId: string | null;
  connectedConnectionIds: string[];
  mountedEditor: any;
}

export function useEditorServerVersion({
  isElasticsearchConsole,
  effectiveConnectionId,
  connectedConnectionIds,
  mountedEditor,
}: EditorServerVersionOptions) {
  const [elasticsearchServerVersion, setElasticsearchServerVersion] = useState<
    ElasticsearchServerVersion | undefined
  >();

  useEffect(() => {
    let cancelled = false;
    if (
      !isElasticsearchConsole ||
      !effectiveConnectionId ||
      !connectedConnectionIds.includes(effectiveConnectionId)
    ) {
      setElasticsearchServerVersion(undefined);
      return;
    }

    connectionService
      .getServerVersion(effectiveConnectionId)
      .then((version) => {
        if (cancelled) return;
        setElasticsearchServerVersion(
          parseElasticsearchConsoleServerVersion(version),
        );
      })
      .catch(() => {
        if (!cancelled) setElasticsearchServerVersion(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [connectedConnectionIds, effectiveConnectionId, isElasticsearchConsole]);

  useEffect(() => {
    const model = mountedEditor?.getModel?.() as
      | { __oxideElasticsearchServerVersion?: ElasticsearchServerVersion }
      | undefined;
    if (!model) return;
    model.__oxideElasticsearchServerVersion = isElasticsearchConsole
      ? elasticsearchServerVersion
      : undefined;
  }, [elasticsearchServerVersion, isElasticsearchConsole, mountedEditor]);

  return { elasticsearchServerVersion };
}
