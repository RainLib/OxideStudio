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
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <div className="w-20 h-20 rounded-2xl bg-[#18181b] border border-white/5 flex items-center justify-center shadow-2xl">
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
    <div className="flex-1 flex justify-center overflow-y-auto p-4 md:p-8 custom-scrollbar">
      <div className="w-full max-w-3xl flex flex-col min-h-0 pb-20">
        {/* Header Section */}
        <div className="mb-8 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {selectedConnection?.name || "New Connection"}
            </h1>
            <Dialog
              open={isImportDialogOpen}
              onOpenChange={setIsImportDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 text-xs uppercase tracking-wide font-semibold opacity-70 hover:opacity-100"
                >
                  <Globe size={14} /> Import URL
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Import Connection</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <p className="text-sm text-muted-foreground">
                    Paste your connection URL (e.g. postgres://...)
                  </p>
                  <Input
                    placeholder="postgres://user:pass@host:5432/db"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setIsImportDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleImport}>Import</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure your database connection details below.
          </p>
        </div>

        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Section: Connection Type */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
              <Database size={14} /> Database Type
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { id: "postgres", label: "PostgreSQL", icon: Database },
                { id: "mysql", label: "MySQL", icon: Database },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleChange("driver", type.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200",
                    selectedConnection?.driver === type.id
                      ? "bg-primary/5 border-primary text-primary ring-1 ring-primary/20 shadow-sm"
                      : "bg-card border-border/50 text-muted-foreground hover:bg-accent/50 hover:border-border hover:text-foreground"
                  )}
                >
                  <type.icon size={24} strokeWidth={1.5} />
                  <span className="text-sm font-medium">{type.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Section: Connection Details */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
              <Globe size={14} /> Connection Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-xl border border-border/50 bg-card/30">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">
                  Display Name
                </label>
                <Input
                  className="bg-background/50 border-input/60 focus:border-primary/50"
                  placeholder="My Production DB"
                  value={selectedConnection?.name || ""}
                  onChange={(e) => handleChange("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">
                  Database Name
                </label>
                <Input
                  className="bg-background/50 border-input/60 focus:border-primary/50"
                  placeholder="postgres"
                  value={selectedConnection?.database || ""}
                  onChange={(e) => handleChange("database", e.target.value)}
                />
              </div>

              <div className="col-span-1 md:col-span-2 grid grid-cols-12 gap-4">
                <div className="col-span-8 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground ml-1">
                    Host
                  </label>
                  <div className="relative">
                    <Input
                      className="bg-background/50 border-input/60 focus:border-primary/50 font-mono"
                      placeholder="localhost"
                      value={selectedConnection?.host || ""}
                      onChange={(e) => handleChange("host", e.target.value)}
                    />
                  </div>
                </div>
                <div className="col-span-4 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground ml-1">
                    Port
                  </label>
                  <Input
                    className="bg-background/50 border-input/60 focus:border-primary/50 font-mono text-center"
                    type="number"
                    placeholder="5432"
                    value={selectedConnection?.port || ""}
                    onChange={(e) =>
                      handleChange("port", parseInt(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Section: Authentication */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
              <Lock size={14} /> Authentication
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-xl border border-border/50 bg-card/30">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">
                  Username
                </label>
                <Input
                  className="bg-background/50 border-input/60 focus:border-primary/50"
                  placeholder="postgres"
                  value={selectedConnection?.user || ""}
                  onChange={(e) => handleChange("user", e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">
                  Password
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    className="bg-background/50 border-input/60 focus:border-primary/50 pr-10"
                    placeholder="••••••••"
                    value={selectedConnection?.password || ""}
                    onChange={(e) => handleChange("password", e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Advanced */}
          <section className="space-y-2">
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  <Lock size={16} />
                </div>
                <div>
                  <div className="text-sm font-medium">SSL Connection</div>
                  <div className="text-xs text-muted-foreground">
                    Enable secure connection
                  </div>
                </div>
              </div>
              <Switch
                checked={selectedConnection?.sslMode === "require"}
                onCheckedChange={(checked) =>
                  handleChange("sslMode", checked ? "require" : "disable")
                }
              />
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 mt-10 py-4 bg-[#09090b]/90 backdrop-blur-lg border-t border-white/5 flex items-center justify-between z-10 -mx-4 px-8 md:px-8 md:-mx-8 md:rounded-b-xl">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={handleTest}
              disabled={testStatus?.type === "loading"}
              className="text-muted-foreground hover:text-foreground"
            >
              {testStatus?.type === "loading" ? (
                <Loader2 size={16} className="animate-spin mr-2" />
              ) : (
                <CheckCircle2 size={16} className="mr-2" />
              )}
              Test Connection
            </Button>
            {testStatus && testStatus.type !== "loading" && (
              <span
                className={cn(
                  "text-xs font-medium animate-in fade-in flex items-center gap-1.5",
                  testStatus.type === "success"
                    ? "text-green-500"
                    : "text-destructive"
                )}
              >
                {testStatus.type === "success" ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
                {testStatus.msg}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleSave}
              className="bg-secondary/80 hover:bg-secondary"
            >
              Save Draft
            </Button>
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="shadow-lg shadow-primary/20 min-w-[140px]"
            >
              {isConnecting ? (
                <Loader2 size={16} className="animate-spin mr-2" />
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
