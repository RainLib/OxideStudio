import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  ConnectionStatus,
  UpdateConnectionField,
} from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

interface ConnectionAuthenticationFieldsProps {
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
  isFileBased: boolean;
  isInfluxDb3: boolean;
  isInfluxDb2: boolean;
  mongoOidcEnabled: boolean;
  showPassword: boolean;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  isMongoDb: boolean;
  setMongoOidcEnabled: (enabled: boolean) => void;
  isInfluxDb: boolean;
  influxDbVersion: "1" | "2";
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  isVictoriaMetrics: boolean;
}

/** Authentication and database-specific protocol fields for network connections. */
export function ConnectionAuthenticationFields({
  selectedConnection,
  updateField,
  isFileBased,
  isInfluxDb3,
  isInfluxDb2,
  mongoOidcEnabled,
  showPassword,
  setShowPassword,
  isMongoDb,
  setMongoOidcEnabled,
  isInfluxDb,
  influxDbVersion,
  updateConnectionConfig,
  setStatus,
  isVictoriaMetrics,
}: ConnectionAuthenticationFieldsProps) {
  if (isFileBased) return null;

  return (
    <>
      {!isInfluxDb3 && !isInfluxDb2 && !mongoOidcEnabled && (
        <>
          <label className={labelClass} htmlFor="connection-user">
            User
          </label>
          <input
            id="connection-user"
            value={selectedConnection.user || ""}
            onChange={(event) => updateField("user", event.target.value, true)}
            className={fieldClass}
            autoComplete="off"
          />
        </>
      )}

      {!mongoOidcEnabled && (
        <label className={labelClass} htmlFor="connection-password">
          {isInfluxDb3 || isInfluxDb2 ? "API token" : "Password"}
        </label>
      )}
      {!mongoOidcEnabled && (
        <div className="relative">
          <input
            id="connection-password"
            type={showPassword ? "text" : "password"}
            value={selectedConnection.password || ""}
            onChange={(event) => updateField("password", event.target.value, true)}
            className={cn(fieldClass, "pr-8")}
            autoComplete="off"
            placeholder={
              isInfluxDb3
                ? "Optional when authentication is disabled"
                : isInfluxDb2
                  ? "Required InfluxDB 2.x token"
                  : undefined
            }
          />
          <button
            type="button"
            className="wb-icon-button absolute right-0.5 top-0.5"
            onClick={() => setShowPassword((visible) => !visible)}
            title={showPassword ? "Hide Password" : "Show Password"}
          >
            {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      )}
      {isMongoDb && (
        <>
          <label className={labelClass} htmlFor="connection-mongodb-oidc">
            Authentication
          </label>
          <div className="flex min-h-7 items-center gap-2">
            <Switch
              id="connection-mongodb-oidc"
              checked={mongoOidcEnabled}
              onCheckedChange={setMongoOidcEnabled}
            />
            <div>
              <span className="text-[11px] text-[hsl(var(--wb-text))]">
                Sign in with browser (MongoDB OIDC)
              </span>
              {mongoOidcEnabled && (
                <p className="text-[10px] wb-muted">
                  The system browser opens during test or connect. Tokens remain in
                  the MongoDB driver and are never saved by OxideStudio.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      {isInfluxDb3 && (
        <>
          <span />
          <p className="text-[10px] leading-4 wb-muted">
            The token is sent only as a Bearer credential to this InfluxDB 3
            endpoint.
          </p>
        </>
      )}
      {isInfluxDb && (
        <>
          <label className={labelClass} htmlFor="connection-influx-version">
            Version
          </label>
          <Select
            value={influxDbVersion}
            onValueChange={(value: "1" | "2") => {
              updateConnectionConfig({
                influxDbVersion: value,
                ...(value === "1" ? { influxDbOrganization: "" } : {}),
              });
              setStatus(null);
            }}
          >
            <SelectTrigger id="connection-influx-version" className={fieldClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">InfluxDB 1.x (InfluxQL)</SelectItem>
              <SelectItem value="2">InfluxDB 2.x (Flux)</SelectItem>
            </SelectContent>
          </Select>
          {isInfluxDb2 && (
            <>
              <label className={labelClass} htmlFor="connection-influx-org">
                Organization
              </label>
              <input
                id="connection-influx-org"
                value={selectedConnection.influxDbOrganization || ""}
                onChange={(event) =>
                  updateConnectionConfig({
                    influxDbOrganization: event.target.value,
                  })
                }
                className={fieldClass}
                placeholder="my-org"
                autoComplete="off"
              />
            </>
          )}
          <span />
          <p className="text-[10px] leading-4 wb-muted">
            {isInfluxDb2
              ? "Uses the InfluxDB 2.x token, organization, bucket and Flux API."
              : "Uses InfluxDB 1.x credentials and the InfluxQL HTTP API."}
          </p>
        </>
      )}
      {isVictoriaMetrics && (
        <>
          <label
            className={labelClass}
            htmlFor="connection-victoriametrics-api-path"
          >
            Prometheus API path
          </label>
          <input
            id="connection-victoriametrics-api-path"
            value={selectedConnection.victoriaMetricsApiPath || "/prometheus"}
            onChange={(event) =>
              updateField("victoriaMetricsApiPath", event.target.value, true)
            }
            className={fieldClass}
            placeholder="/prometheus"
            autoComplete="off"
          />
          <label
            className={labelClass}
            htmlFor="connection-victoriametrics-lookback"
          >
            Metadata lookback
          </label>
          <input
            id="connection-victoriametrics-lookback"
            value={selectedConnection.victoriaMetricsLookback || "1h"}
            onChange={(event) =>
              updateField("victoriaMetricsLookback", event.target.value, true)
            }
            className={fieldClass}
            placeholder="1h"
            autoComplete="off"
          />
          <span />
          <p className="text-[10px] leading-4 wb-muted">
            Queries use the native read-only MetricsQL API. The lookback limits
            label discovery only.
          </p>
        </>
      )}
    </>
  );
}
