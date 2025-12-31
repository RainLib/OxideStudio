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
  Tag,
  X,
  Plus,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import React from "react";

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
  const [tagInput, setTagInput] = useState("");

  const PREDEFINED_TAGS = [
    "Production",
    "Staging",
    "Development",
    "Personal",
    "Work",
    "Test",
  ];

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

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const currentTags = selectedConnection.tags || [];
    if (currentTags.includes(trimmed)) {
      setTagInput("");
      return;
    }
    handleChange("tags", [...currentTags, trimmed]);
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = selectedConnection.tags || [];
    handleChange(
      "tags",
      currentTags.filter((t: string) => t !== tagToRemove)
    );
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
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
        <div className="w-full max-w-3xl mx-auto flex flex-col min-h-0">
          {/* Header Section */}
          <div className="mb-8 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <Input
                  className="text-2xl font-bold tracking-tight text-foreground bg-transparent border-none p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:opacity-20 hover:bg-white/5 transition-colors cursor-text px-2 -ml-2 rounded-md"
                  placeholder="New Connection"
                  value={selectedConnection?.name || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleChange("name", e.target.value)
                  }
                />
              </div>
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setImportUrl(e.target.value)
                      }
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

          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Section: Driver & Security & Tags */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              <section className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                  <Database size={14} /> Database Type
                </h3>
                <Select
                  value={selectedConnection?.driver || ""}
                  onValueChange={(value) => handleChange("driver", value)}
                >
                  <SelectTrigger className="w-full bg-background/50 border-input/60 focus:border-primary/50 h-10">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="bg-background-elevated border-border text-foreground">
                    <SelectItem value="postgres">
                      <div className="flex items-center gap-2">
                        <Database size={14} className="text-blue-400" />
                        <span>PostgreSQL</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="mysql">
                      <div className="flex items-center gap-2">
                        <Database size={14} className="text-orange-400" />
                        <span>MySQL / MariaDB</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* Security nested here to save top-level space if needed, or keeping it distinct */}
                <div className="pt-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 ml-1">
                    Security Settings
                  </h3>
                  <div className="flex items-center justify-between p-2.5 px-4 rounded-xl border border-border/40 bg-card/20 hover:bg-card/40 transition-colors">
                    <div className="text-xs font-medium">SSL Connection</div>
                    <Switch
                      checked={selectedConnection?.sslMode === "require"}
                      onCheckedChange={(checked) =>
                        handleChange("sslMode", checked ? "require" : "disable")
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                  <Tag size={14} /> Tags
                </h3>
                <div className="space-y-3 p-4 rounded-xl border border-border/50 bg-card/20 group">
                  {/* Active Tags */}
                  <div className="flex flex-wrap gap-2 min-h-[24px]">
                    {selectedConnection.tags?.map((tag: string) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 pl-2 pr-1 py-0.5 gap-1 transition-all"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                        >
                          <X size={10} />
                        </button>
                      </Badge>
                    ))}
                    {(!selectedConnection.tags ||
                      selectedConnection.tags.length === 0) && (
                      <span className="text-xs text-muted-foreground/40 italic ml-1 select-none">
                        No tags added
                      </span>
                    )}
                  </div>

                  {/* Tag Input */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        className="bg-background/40 border-input/40 focus:border-primary/40 h-8 text-xs pl-7"
                        placeholder="Add tag..."
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddTag(tagInput);
                          }
                        }}
                      />
                      <Tag
                        size={12}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary transition-colors border border-transparent hover:border-primary/20"
                      onClick={() => handleAddTag(tagInput)}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>

                  {/* Suggestions */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {PREDEFINED_TAGS.filter(
                      (t: string) => !selectedConnection.tags?.includes(t)
                    )
                      .slice(0, 4)
                      .map((tag: string) => (
                        <button
                          key={tag}
                          onClick={() => handleAddTag(tag)}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-border/40 text-muted-foreground/60 hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all"
                        >
                          + {tag}
                        </button>
                      ))}
                  </div>
                </div>
              </section>
            </div>

            <div className="h-px bg-white/5" />

            {/* Section: Connection Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Network & Database */}
              <div className="space-y-8">
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                    <Globe size={14} /> Network
                  </h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground ml-1">
                        Host
                      </label>
                      <Input
                        className="bg-background/50 border-input/60 focus:border-primary/50 font-mono"
                        placeholder="localhost"
                        value={selectedConnection?.host || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleChange("host", e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground ml-1">
                        Port
                      </label>
                      <Input
                        className="bg-background/50 border-input/60 focus:border-primary/50 font-mono"
                        type="number"
                        placeholder="5432"
                        value={selectedConnection?.port || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleChange("port", parseInt(e.target.value))
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                    <Database size={14} /> Database
                  </h3>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground ml-1">
                      Database Name
                    </label>
                    <Input
                      className="bg-background/50 border-input/60 focus:border-primary/50"
                      placeholder="postgres"
                      value={selectedConnection?.database || ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleChange("database", e.target.value)
                      }
                    />
                  </div>
                </section>
              </div>

              {/* Right Column: Authentication */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                  <Lock size={14} /> Authentication
                </h3>
                <div className="space-y-4 p-6 rounded-xl border border-border/50 bg-card/10">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground ml-1">
                      Username
                    </label>
                    <Input
                      className="bg-background/50 border-input/60 focus:border-primary/50"
                      placeholder="postgres"
                      value={selectedConnection?.user || ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleChange("user", e.target.value)
                      }
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
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleChange("password", e.target.value)
                        }
                        autoComplete="off"
                      />
                      <button
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="py-4 bg-[#09090b]/90 backdrop-blur-lg border-t border-white/5 flex items-center justify-center z-10 shrink-0">
        <div className="w-full max-w-3xl flex items-center justify-between px-8">
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
