import {
  useConnectionStore,
  ConnectionConfig,
} from "@/store/useConnectionStore";
import { Button } from "@/components/ui/button";
import { Save, Play, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Custom Styled Input for the Dark Theme
function ConfigInput({
  label,
  type = "text",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[11px] uppercase tracking-wide font-bold text-gray-500">
        {label}
      </label>
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded border border-[#333] bg-[#1a1a1a] px-3 py-1 text-sm text-gray-200 shadow-sm transition-colors",
          "placeholder:text-gray-600",
          "focus-visible:outline-none focus-visible:border-[#f39c12] focus-visible:ring-1 focus-visible:ring-[#f39c12]",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        {...props}
      />
    </div>
  );
}

export function ConnectionForm() {
  const {
    selectedConnection,
    saveConnection,
    connect,
    updateConnectionConfig,
  } = useConnectionStore();
  const [testStatus, setTestStatus] = useState<{
    type: "success" | "error" | "loading";
    msg: string;
  } | null>(null);

  if (!selectedConnection) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-[#131313] gap-4">
        <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center">
          <Play size={24} className="opacity-20 translate-x-1" />
        </div>
        <p>Select a connection to configure</p>
      </div>
    );
  }

  const handleChange = (field: keyof ConnectionConfig, value: any) => {
    updateConnectionConfig({ [field]: value });
  };

  const handleSave = async () => {
    if (selectedConnection) {
      await saveConnection(selectedConnection);
    }
  };

  const handleConnect = async () => {
    if (selectedConnection) {
      const error = await connect(selectedConnection);
      if (error) {
        setTestStatus({ type: "error", msg: error });
      }
    }
  };

  const handleTest = async () => {
    if (selectedConnection) {
      setTestStatus({ type: "loading", msg: "Testing connection..." });
      const error = await connect(selectedConnection);
      if (error) {
        setTestStatus({ type: "error", msg: error });
      } else {
        setTestStatus({ type: "success", msg: "Connection successful!" });
        // We don't disconnect here to allow immediate use if desired,
        // but technically "Test" implies generic check.
        // Oxide's connect also sets active connection, which is fine.
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#131313] text-gray-200 overflow-y-auto">
      {/* Form Header */}
      <div className="px-8 py-6 border-b border-[#222] bg-[#1e1e1e]/50">
        <div className="flex items-center gap-4 mb-4">
          <div
            className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center shadow-lg",
              selectedConnection.driver === "postgres"
                ? "bg-blue-600 text-white"
                : "bg-orange-600 text-white"
            )}
          >
            {selectedConnection.driver === "postgres" ? "PG" : "MY"}
          </div>
          <div>
            <input
              className="bg-transparent text-2xl font-bold text-white focus:outline-none placeholder:text-gray-600 w-full"
              value={selectedConnection.name || ""}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Name your connection..."
            />
            <div className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div
                  className={cn(
                    "w-3 h-3 rounded-full border border-gray-500 group-hover:border-blue-500 transition-colors",
                    selectedConnection.driver === "postgres" &&
                      "bg-blue-500 border-blue-500 ring-2 ring-blue-500/20"
                  )}
                />
                <span className="text-xs text-gray-400 group-hover:text-gray-300">
                  PostgreSQL
                </span>
                <input
                  type="radio"
                  className="hidden"
                  checked={selectedConnection.driver === "postgres"}
                  onChange={() => handleChange("driver", "postgres")}
                />
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div
                  className={cn(
                    "w-3 h-3 rounded-full border border-gray-500 group-hover:border-orange-500 transition-colors",
                    selectedConnection.driver === "mysql" &&
                      "bg-orange-500 border-orange-500 ring-2 ring-orange-500/20"
                  )}
                />
                <span className="text-xs text-gray-400 group-hover:text-gray-300">
                  MySQL
                </span>
                <input
                  type="radio"
                  className="hidden"
                  checked={selectedConnection.driver === "mysql"}
                  onChange={() => handleChange("driver", "mysql")}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 p-8 max-w-4xl mx-auto w-full">
        <div className="grid gap-6 bg-[#1a1a1a] p-6 rounded-lg border border-[#333] shadow-sm">
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-8">
              <ConfigInput
                label="Host"
                value={selectedConnection.host || ""}
                onChange={(e) => handleChange("host", e.target.value)}
                placeholder="localhost"
              />
            </div>
            <div className="col-span-4">
              <ConfigInput
                label="Port"
                type="number"
                value={selectedConnection.port || ""}
                onChange={(e) =>
                  handleChange("port", parseInt(e.target.value) || 5432)
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <ConfigInput
              label="Username"
              value={selectedConnection.user || ""}
              onChange={(e) => handleChange("user", e.target.value)}
              autoComplete="off"
            />
            <ConfigInput
              label="Password"
              type="password"
              value={selectedConnection.password || ""}
              onChange={(e) => handleChange("password", e.target.value)}
              autoComplete="off"
            />
          </div>

          <ConfigInput
            label="Default Database"
            value={selectedConnection.database || ""}
            onChange={(e) => handleChange("database", e.target.value)}
          />
        </div>

        {/* Status Message */}
        {testStatus && (
          <div
            className={cn(
              "mt-4 p-4 rounded border flex items-center gap-3",
              testStatus.type === "error"
                ? "bg-red-500/10 border-red-500/50 text-red-200"
                : testStatus.type === "success"
                ? "bg-green-500/10 border-green-500/50 text-green-200"
                : "bg-[#252525] border-[#444] text-gray-300"
            )}
          >
            {testStatus.type === "error" && <AlertCircle size={18} />}
            {testStatus.type === "success" && <CheckCircle2 size={18} />}
            <span className="text-sm font-medium">{testStatus.msg}</span>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-6 border-t border-[#222] bg-[#161616] flex justify-end gap-3 sticky bottom-0">
        <Button
          variant="ghost"
          className="hover:bg-[#252525] hover:text-white text-gray-400"
          onClick={handleTest}
        >
          Test Connection
        </Button>
        <Button
          variant="outline"
          className="border-[#444] bg-[#252525] text-gray-200 hover:bg-[#333]"
          onClick={handleSave}
        >
          <Save size={16} className="mr-2" /> Save
        </Button>
        <Button
          className="bg-[#e67e22] hover:bg-[#d35400] text-white px-8 font-bold shadow-lg shadow-orange-900/20"
          onClick={handleConnect}
        >
          <Play size={16} className="mr-2 fill-current" /> Connect
        </Button>
      </div>
    </div>
  );
}
