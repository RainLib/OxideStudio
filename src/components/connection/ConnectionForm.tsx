import {
  useConnectionStore,
  ConnectionConfig,
} from "@/store/useConnectionStore";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Globe,
  Database,
  Lock,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

  const [showPassword, setShowPassword] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  if (!selectedConnection) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background-primary text-muted-foreground gap-4">
        <div className="w-20 h-20 rounded-2xl bg-background-tertiary border border-border flex items-center justify-center shadow-2xl">
          <Database size={32} className="opacity-20 text-foreground" />
        </div>
        <div className="text-center space-y-1">
          <h3 className="text-lg font-medium text-foreground">
            No Connection Selected
          </h3>
          <p className="text-sm text-muted-foreground/60">
            Select a connection or create a new one to get started.
          </p>
        </div>
      </div>
    );
  }

  const parseConnectionString = (url: string): Partial<ConnectionConfig> => {
    try {
      let workingUrl = url.trim();
      if (workingUrl.startsWith("jdbc:")) {
        workingUrl = workingUrl.substring(5);
      }

      const parsed = new URL(workingUrl);
      const protocol = parsed.protocol.replace(":", "");
      const host = parsed.hostname;

      // Map protocol to driver
      const driver =
        protocol === "postgresql" || protocol === "postgres"
          ? "postgres"
          : "mysql";

      const port = parsed.port
        ? parseInt(parsed.port)
        : driver === "postgres"
        ? 5432
        : 3306;

      const user = decodeURIComponent(parsed.username);
      const password = decodeURIComponent(parsed.password);
      const database = decodeURIComponent(parsed.pathname.split("/")[1] || "");

      return {
        driver,
        host,
        port,
        user,
        password,
        database,
        connectionUrl: url,
      };
    } catch (e) {
      console.error("Failed to parse connection string:", e);
      return {};
    }
  };

  const handleImport = () => {
    if (!importUrl.trim()) return;
    const updates = parseConnectionString(importUrl.trim());
    if (Object.keys(updates).length > 0) {
      updateConnectionConfig(updates);
    }
    setImportUrl("");
    setIsImportDialogOpen(false);
  };

  const handleChange = (field: keyof ConnectionConfig, value: any) => {
    updateConnectionConfig({ [field]: value });
  };

  const handleTest = async () => {
    setTestStatus({ type: "loading", msg: "Testing connection..." });
    const error = await connect(selectedConnection);
    if (error) {
      setTestStatus({ type: "error", msg: error });
    } else {
      setTestStatus({ type: "success", msg: "Connection successful" });
      setTimeout(() => setTestStatus(null), 3000);
    }
  };

  const handleSave = async () => {
    await saveConnection(selectedConnection);
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await handleSave();
      const error = await connect(selectedConnection);
      if (error) {
        setTestStatus({ type: "error", msg: error });
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex-1 flex justify-center bg-background-primary overflow-y-auto p-8">
      <div className="w-full max-w-2xl flex flex-col min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-foreground tracking-tight">
            {selectedConnection.name || "New Connection"}
          </h2>
          <Dialog
            open={isImportDialogOpen}
            onOpenChange={setIsImportDialogOpen}
          >
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-xs text-muted-foreground hover:text-foreground uppercase tracking-wider font-bold"
              >
                Import from URL
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-background-elevated border-border text-foreground">
              <DialogHeader>
                <DialogTitle>Import from URL</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Paste your database connection string below.
                </p>
                <Input
                  className="bg-background-tertiary border-border text-foreground"
                  placeholder="postgres://user:pass@localhost:5432/mydb"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleImport()}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setIsImportDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Import
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-6">
          {/* Connection Type */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Connection Type
            </label>
            <div className="grid grid-cols-2 gap-4 p-1 bg-background-tertiary rounded-lg border border-border">
              {[
                { id: "postgres", label: "PostgreSQL", icon: Database },
                { id: "mysql", label: "MySQL", icon: Database }, // Use appropriate icons
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleChange("driver", type.id)}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                    selectedConnection.driver === type.id
                      ? "bg-background-elevated text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground hover:bg-background-elevated/50"
                  )}
                >
                  <type.icon
                    size={16}
                    className={
                      selectedConnection.driver === type.id
                        ? "text-primary"
                        : "currentColor"
                    }
                  />
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Host & Port */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-9 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Host
              </label>
              <div className="relative group">
                <Globe
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors group-focus-within:text-primary"
                />
                <input
                  className="w-full h-10 bg-background-tertiary border border-border rounded-lg pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder="localhost"
                  value={selectedConnection.host || ""}
                  onChange={(e) => handleChange("host", e.target.value)}
                />
              </div>
            </div>
            <div className="col-span-3 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Port
              </label>
              <input
                type="number"
                className="w-full h-10 bg-background-tertiary border border-border rounded-lg px-3 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-center font-mono"
                placeholder="5432"
                value={selectedConnection.port || ""}
                onChange={(e) => handleChange("port", parseInt(e.target.value))}
              />
            </div>
          </div>

          {/* Authentication */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                User
              </label>
              <input
                className="w-full h-10 bg-background-tertiary border border-border rounded-lg px-3 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="postgres"
                value={selectedConnection.user || ""}
                onChange={(e) => handleChange("user", e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full h-10 bg-background-tertiary border border-border rounded-lg px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder="••••••••"
                  value={selectedConnection.password || ""}
                  onChange={(e) => handleChange("password", e.target.value)}
                  autoComplete="off"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Database & SSL */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Default Database
            </label>
            <input
              className="w-full h-10 bg-background-tertiary border border-border rounded-lg px-3 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder="postgres"
              value={selectedConnection.database || ""}
              onChange={(e) => handleChange("database", e.target.value)}
            />
          </div>

          {/* Options Toggles */}
          <div className="pt-4 space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary border border-border">
              <div className="flex items-center gap-3">
                <Lock size={16} className="text-muted-foreground/50" />
                <div className="text-xs font-medium text-foreground">
                  Enable SSL
                </div>
              </div>
              <Switch
                checked={selectedConnection.sslMode === "require"}
                onCheckedChange={(checked) =>
                  handleChange("sslMode", checked ? "require" : "disable")
                }
                className="data-[state=checked]:bg-primary"
              />
            </div>
          </div>

          {/* Connection Name */}
          <div className="space-y-2 pt-4 border-t border-border">
            <label className="text-xs font-medium text-muted-foreground">
              Connection Name
            </label>
            <input
              className="w-full h-10 bg-background-tertiary border border-border rounded-lg px-3 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder="My Production DB"
              value={selectedConnection.name || ""}
              onChange={(e) => handleChange("name", e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={handleTest}
              className="text-muted-foreground hover:text-foreground hover:bg-background-elevated"
              disabled={testStatus?.type === "loading"}
            >
              {testStatus?.type === "loading" ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>

            {testStatus && testStatus.type !== "loading" && (
              <div
                className={cn(
                  "text-xs font-medium flex items-center gap-1.5",
                  testStatus.type === "success"
                    ? "text-green-500"
                    : "text-red-500"
                )}
              >
                {testStatus.type === "success" ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
                {testStatus.msg}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleSave}
              className="bg-background-elevated text-foreground hover:bg-background-tertiary border border-border"
            >
              Save
            </Button>
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="bg-foreground text-background hover:bg-foreground/90 font-bold px-6 min-w-[120px]"
            >
              {isConnecting ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
