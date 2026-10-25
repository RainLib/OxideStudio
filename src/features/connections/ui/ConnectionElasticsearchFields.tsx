import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { UpdateConnectionField } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";

interface ConnectionElasticsearchFieldsProps {
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
}

/** Elasticsearch Console proxy, connectivity, and index-display preferences. */
export function ConnectionElasticsearchFields({
  selectedConnection,
  updateField,
}: ConnectionElasticsearchFieldsProps) {
  if (selectedConnection.driver !== "elasticsearch") return null;

  return (
    <>
            <label
              className={labelClass}
              htmlFor="connection-elasticsearch-mode"
            >
              Transport
            </label>
            <div className="space-y-1.5">
              <Select
                value={selectedConnection.elasticsearchMode || "direct"}
                onValueChange={(value: "direct" | "kibana") =>
                  updateField("elasticsearchMode", value)
                }
              >
                <SelectTrigger
                  id="connection-elasticsearch-mode"
                  className={fieldClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="">
                  <SelectItem value="direct">Direct HTTP</SelectItem>
                  <SelectItem value="kibana">
                    Kibana / OpenSearch Console proxy
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className="flex min-h-6 items-center gap-1.5 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 font-mono text-[10px] wb-muted">
                <span className="text-[hsl(var(--wb-text))]">OxideStudio</span>
                <span aria-hidden="true">→</span>
                {selectedConnection.elasticsearchMode === "kibana" && (
                  <>
                    <span className="text-[hsl(var(--wb-accent))]">
                      Kibana / Dashboards
                    </span>
                    <span aria-hidden="true">→</span>
                  </>
                )}
                <span>Elasticsearch cluster</span>
              </div>
            </div>

            {selectedConnection.elasticsearchMode === "kibana" && (
              <>
                <label
                  className={labelClass}
                  htmlFor="connection-elasticsearch-kibana-base-path"
                >
                  Console base path
                </label>
                <div>
                  <input
                    id="connection-elasticsearch-kibana-base-path"
                    value={selectedConnection.elasticsearchKibanaBasePath || ""}
                    onChange={(event) =>
                      updateField(
                        "elasticsearchKibanaBasePath",
                        event.target.value,
                      )
                    }
                    className={fieldClass}
                    placeholder="Optional, e.g. /kibana/s/analytics"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-[10px] wb-muted">
                    Requests use the Console proxy and include Kibana and
                    OpenSearch anti-CSRF headers.
                  </p>
                </div>
              </>
            )}

            <label
              className={labelClass}
              htmlFor="connection-elasticsearch-check-path"
            >
              Connection check
            </label>
            <div className="space-y-1.5">
              <input
                id="connection-elasticsearch-check-path"
                value={
                  selectedConnection.elasticsearchConnectivityCheckPath || ""
                }
                onChange={(event) =>
                  updateField(
                    "elasticsearchConnectivityCheckPath",
                    event.target.value,
                  )
                }
                className={fieldClass}
                placeholder="GET / (or a permitted index path)"
                spellCheck={false}
                disabled={
                  selectedConnection.elasticsearchConnectivityCheckDisabled
                }
              />
              <label className="flex items-center justify-between gap-3 text-[10px] wb-muted">
                <span>
                  Skip the probe only when this account has no stable read-only
                  health path.
                </span>
                <Switch
                  checked={
                    selectedConnection.elasticsearchConnectivityCheckDisabled ||
                    false
                  }
                  onCheckedChange={(checked) =>
                    updateField(
                      "elasticsearchConnectivityCheckDisabled",
                      checked,
                    )
                  }
                  className="h-5 w-9 shrink-0 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                  aria-label="Skip Elasticsearch connectivity check"
                />
              </label>
            </div>

            <label
              className={labelClass}
              htmlFor="connection-elasticsearch-index-grouping"
            >
              Index grouping
            </label>
            <div>
              <input
                id="connection-elasticsearch-index-grouping"
                value={selectedConnection.indexGroupingPattern || ""}
                onChange={(event) =>
                  updateField("indexGroupingPattern", event.target.value)
                }
                className={fieldClass}
                placeholder="Optional regex, e.g. [-_.@]\\d{4}[-_.]?\\d{2}.*$"
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] wb-muted">
                Collapses matching rolling-index suffixes into <code>*</code>.
                Leave blank to show every index.
              </p>
            </div>
    </>
  );
}
