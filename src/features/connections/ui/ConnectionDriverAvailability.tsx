import { cn } from "@/lib/utils";
import type { DatabaseDriverCatalogEntry } from "@/services/tauri/types/database";
import {
  AlertCircle,
  Check,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface ConnectionDriverAvailabilityProps {
  selectedDriverAvailability: "activationRequired" | "installationRequired";
  selectedDriverLabel: string;
  isInstallingDriver: boolean;
  installSelectedDriver: () => Promise<void>;
  catalogRelease: DatabaseDriverCatalogEntry | null;
  setIsCatalogInstallSetupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isRefreshingDriverStatus: boolean;
  refreshDriverStatus: () => Promise<void>;
  isCatalogInstallSetupOpen: boolean;
  catalogUrlInput: string;
  setCatalogUrlInput: React.Dispatch<React.SetStateAction<string>>;
  installSelectedDriverFromCatalogUrl: () => Promise<void>;
}

export function ConnectionDriverAvailability({
  selectedDriverAvailability,
  selectedDriverLabel,
  isInstallingDriver,
  installSelectedDriver,
  catalogRelease,
  setIsCatalogInstallSetupOpen,
  isRefreshingDriverStatus,
  refreshDriverStatus,
  isCatalogInstallSetupOpen,
  catalogUrlInput,
  setCatalogUrlInput,
  installSelectedDriverFromCatalogUrl,
}: ConnectionDriverAvailabilityProps) {
  return (
    <div
      role="status"
      className="shrink-0 border-b border-amber-400/25 bg-amber-400/10 text-[10px] text-amber-100"
    >
      <div className="flex min-h-9 items-center gap-2 px-3">
        <AlertCircle size={13} className="shrink-0 text-amber-400" />
        <span className="min-w-0 flex-1">
          {selectedDriverAvailability === "activationRequired"
            ? `${selectedDriverLabel} is installed but not active. Activate its signed package before testing or saving this data source.`
            : `${selectedDriverLabel} needs a signed driver package before this data source can be tested or saved.`}
        </span>
        <button
          type="button"
          className="wb-text-button flex h-6 shrink-0 items-center gap-1 px-1 text-[10px] text-amber-200 hover:text-amber-50"
          disabled={isInstallingDriver}
          onClick={() => void installSelectedDriver()}
        >
          {isInstallingDriver ? (
            <Loader2 size={11} className="animate-spin" />
          ) : selectedDriverAvailability === "activationRequired" ? (
            <Check size={11} />
          ) : catalogRelease ? (
            <Download size={11} />
          ) : (
            <FolderOpen size={11} />
          )}
          {selectedDriverAvailability === "activationRequired"
            ? "Activate driver"
            : catalogRelease
              ? "Download & install"
              : "Install package…"}
        </button>
        {selectedDriverAvailability === "installationRequired" &&
          !catalogRelease && (
            <button
              type="button"
              className="wb-text-button h-6 shrink-0 px-1 text-[10px] text-amber-200 hover:text-amber-50"
              disabled={isInstallingDriver}
              onClick={() => setIsCatalogInstallSetupOpen((open) => !open)}
            >
              Download from catalog…
            </button>
          )}
        <button
          type="button"
          className="wb-icon-button h-6 w-6 shrink-0 text-amber-200 hover:text-amber-50"
          title="Refresh driver status"
          aria-label="Refresh driver status"
          disabled={isRefreshingDriverStatus}
          onClick={() => void refreshDriverStatus()}
        >
          <RefreshCw
            size={12}
            className={cn(isRefreshingDriverStatus && "animate-spin")}
          />
        </button>
      </div>
      {isCatalogInstallSetupOpen &&
        selectedDriverAvailability === "installationRequired" &&
        !catalogRelease && (
          <div className="flex min-h-9 items-center gap-2 border-t border-amber-400/20 px-3">
            <label
              className="shrink-0 text-[10px] text-amber-100"
              htmlFor="connection-driver-catalog-url"
            >
              Signed catalog
            </label>
            <input
              id="connection-driver-catalog-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              className="h-6 min-w-0 flex-1 rounded-[3px] border border-amber-300/35 bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
              placeholder="https://drivers.example.com/catalog.json"
              value={catalogUrlInput}
              onChange={(event) => setCatalogUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void installSelectedDriverFromCatalogUrl();
                }
              }}
            />
            <button
              type="button"
              className="wb-text-button h-6 shrink-0 px-1 text-[10px] text-amber-100 hover:text-amber-50 disabled:opacity-50"
              disabled={isInstallingDriver}
              onClick={() => void installSelectedDriverFromCatalogUrl()}
            >
              {isInstallingDriver ? "Downloading…" : "Download & install"}
            </button>
            <button
              type="button"
              className="wb-text-button h-6 shrink-0 px-1 text-[10px] text-amber-200 hover:text-amber-50"
              disabled={isInstallingDriver}
              onClick={() => setIsCatalogInstallSetupOpen(false)}
            >
              Cancel
            </button>
          </div>
        )}
    </div>
  );
}
