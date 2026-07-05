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
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import * as LucideIcons from "lucide-react";
import React from "react";
import { parseConnectionUrl } from "@/lib/connectionUrlParser";
import {
  connectionUrlScheme,
  databaseDriverProfile,
  defaultConnectionIcon,
  defaultDatabaseCapabilities,
  defaultDatabaseName,
  defaultDatabasePort,
  supportedDatabaseDriverProfiles,
} from "@/lib/databaseDialect";
import {
  databaseService,
  type DatabaseCapabilities,
  type DatabaseDriver,
} from "@/services/tauri";

import { QueryShortcuts } from "@/components/workspace/QueryShortcuts";

// Predefined colors
const COLORS = [
  "#f39c12", // Orange
  "#e74c3c", // Red
  "#8e44ad", // Purple
  "#3498db", // Blue
  "#2ecc71", // Green
  "#1abc9c", // Teal
  "#34495e", // Navy
  "#95a5a6", // Grey
];

// Predefined icons
const ICONS = [
  "Database",
  "Server",
  "Cloud",
  "HardDrive",
  "Box",
  "Layers",
  "LayoutGrid",
  "Settings",
  "Terminal",
  "Code",
  "Cpu",
  "Activity",
];

function fallbackDriverCapabilities() {
  return supportedDatabaseDriverProfiles().map((profile) =>
    defaultDatabaseCapabilities(profile.driver)
  );
}

export function ConnectionForm() {
  const {
    selectedConnection,
    saveConnection,
    connect,
    testConnection,
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
  const [driverCapabilities, setDriverCapabilities] =
    useState<DatabaseCapabilities[]>(fallbackDriverCapabilities);
  const uploadIconRef = useRef<HTMLInputElement>(null);
  const driverOptions = useMemo(() => {
    const seenDrivers = new Set<string>();
    return [...driverCapabilities, ...fallbackDriverCapabilities()]
      .filter((capabilities) => {
        const driver = String(capabilities.driver);
        if (seenDrivers.has(driver)) return false;
        seenDrivers.add(driver);
        return true;
      })
      .map((capabilities) => ({
        capabilities,
        profile: databaseDriverProfile(capabilities.driver),
      }));
  }, [driverCapabilities]);

  useEffect(() => {
    let cancelled = false;

    databaseService
      .listDatabaseCapabilities()
      .then((capabilities) => {
        if (!cancelled && capabilities.length > 0) {
          setDriverCapabilities(capabilities);
        }
      })
      .catch((error) => {
        console.warn("Failed to load database capabilities:", error);
        if (!cancelled) {
          setDriverCapabilities(fallbackDriverCapabilities());
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const PREDEFINED_TAGS = [
    "Production",
    "Staging",
    "Development",
    "Personal",
    "Work",
    "Test",
  ];

  if (!selectedConnection) {
    return <QueryShortcuts />;
  }

  const selectedDriverDefaultPort = defaultDatabasePort(
    selectedConnection.driver
  );
  const selectedDriverDefaultDatabase =
    defaultDatabaseName(selectedConnection.driver) || "database";
  const importExampleUrl = `${connectionUrlScheme(
    selectedConnection.driver
  )}://user:pass@host${
    selectedDriverDefaultPort ? `:${selectedDriverDefaultPort}` : ""
  }/${selectedDriverDefaultDatabase}`;

  const parseConnectionString = (url: string): Partial<ConnectionConfig> => {
    const parsed = parseConnectionUrl(url);
    if (!parsed) {
      console.error("Failed to parse connection string");
      return {};
    }

    return {
      driver: parsed.driver,
      host: parsed.host,
      port: parsed.port,
      user: parsed.user || "",
      password: parsed.password || "",
      database: parsed.database || "",
      sslMode: parsed.sslMode,
      connectionUrl: url,
    };
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

  const handleDriverChange = (driver: DatabaseDriver) => {
    const previousDriver = selectedConnection.driver;
    const previousDefaultPort = defaultDatabasePort(previousDriver);
    const previousDefaultDatabase = defaultDatabaseName(previousDriver);
    const previousDefaultIcon = defaultConnectionIcon(previousDriver);
    const nextDefaultPort = defaultDatabasePort(driver);
    const nextDefaultDatabase = defaultDatabaseName(driver);
    const nextDefaultIcon = databaseDriverProfile(driver).defaultIcon;

    const updates: Partial<ConnectionConfig> = { driver };
    if (
      !selectedConnection.port ||
      selectedConnection.port === previousDefaultPort
    ) {
      updates.port = nextDefaultPort || undefined;
    }
    if (
      selectedConnection.database === undefined ||
      selectedConnection.database === previousDefaultDatabase
    ) {
      updates.database = nextDefaultDatabase;
    }
    if (
      !selectedConnection.icon ||
      selectedConnection.icon === previousDefaultIcon
    ) {
      updates.icon = nextDefaultIcon;
    }

    updateConnectionConfig(updates);
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

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        handleChange("icon", reader.result as string); // Save as base64
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper to render dynamic icon
  const renderIcon = (iconName?: string, size: number = 20) => {
    if (!iconName) {
      const Icon = LucideIcons.Database;
      return <Icon size={size} strokeWidth={1.5} />;
    }

    // Check if it is a base64 image (upload)
    if (iconName.startsWith("data:image")) {
      return (
        <img
          src={iconName}
          alt="icon"
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      );
    }

    // Check if it's a valid Lucide icon
    const IconComponent = (LucideIcons as any)[iconName];
    if (IconComponent) {
      return <IconComponent size={size} strokeWidth={1.5} />;
    }

    // Otherwise treat as text
    return (
      <span
        style={{ fontSize: size * 0.6 }}
        className="font-bold font-mono leading-none truncate"
      >
        {iconName.slice(0, 3)}
      </span>
    );
  };

  const handleTest = async () => {
    setTestStatus({ type: "loading", msg: "Testing connection..." });
    try {
      const error = await testConnection(selectedConnection);
      if (error) {
        setTestStatus({ type: "error", msg: error });
      } else {
        setTestStatus({ type: "success", msg: "Connection available" });
        setTimeout(() => setTestStatus(null), 3000);
      }
    } catch (error: any) {
      setTestStatus({ type: "error", msg: error?.message || String(error) });
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
              <div className="flex items-center gap-3 flex-1 mr-4">
                {/* Icon Selector */}
                <Popover>
                  <PopoverTrigger asChild>
                    <div
                      className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer hover:shadow-lg transition-all border border-transparent hover:border-border/60",
                        !selectedConnection.icon &&
                          !selectedConnection.color &&
                          "bg-secondary/50"
                      )}
                      style={{
                        backgroundColor: selectedConnection.color
                          ? `${selectedConnection.color}20`
                          : undefined,
                        color: selectedConnection.color || undefined,
                      }}
                    >
                      {renderIcon(selectedConnection.icon, 24)}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="start">
                    <div className="space-y-4">
                      {/* Icon Grid */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Icon
                        </label>
                        <div className="grid grid-cols-6 gap-2">
                          {ICONS.map((icon) => (
                            <div
                              key={icon}
                              onClick={() => handleChange("icon", icon)}
                              className={cn(
                                "w-8 h-8 rounded-md flex items-center justify-center cursor-pointer hover:bg-secondary transition-colors",
                                selectedConnection.icon === icon &&
                                  "bg-secondary text-primary"
                              )}
                            >
                              {renderIcon(icon, 16)}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Text Icon Input */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Text Icon
                        </label>
                        <Input
                          placeholder="e.g. DEV, PROD, 🚀"
                          value={
                            !selectedConnection.icon?.startsWith(
                              "data:image"
                            ) &&
                            !ICONS.includes(selectedConnection.icon || "") &&
                            !(LucideIcons as any)[selectedConnection.icon || ""]
                              ? selectedConnection.icon || ""
                              : ""
                          }
                          onChange={(e) => handleChange("icon", e.target.value)}
                          maxLength={3}
                          className="h-8 text-xs font-mono"
                        />
                      </div>

                      {/* Upload & Color */}
                      <div className="pt-2 border-t border-border/50 space-y-4">
                        <div className="space-y-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs h-7"
                            onClick={() => uploadIconRef.current?.click()}
                          >
                            <Upload size={12} className="mr-2" /> Upload Image
                          </Button>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={uploadIconRef}
                            onChange={handleIconUpload}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-muted-foreground uppercase">
                            Color
                          </label>
                          <div className="grid grid-cols-8 gap-2">
                            {COLORS.map((color) => (
                              <div
                                key={color}
                                onClick={() => handleChange("color", color)}
                                className={cn(
                                  "w-6 h-6 rounded-full cursor-pointer hover:scale-110 transition-transform border border-transparent",
                                  selectedConnection.color === color &&
                                    "ring-2 ring-offset-2 ring-offset-background ring-primary border-white"
                                )}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Input
                  className="text-2xl font-bold tracking-tight text-foreground bg-transparent border-none p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:opacity-20 hover:bg-white/5 transition-colors cursor-text px-2 rounded-md"
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
                      Paste your connection URL (e.g.{" "}
                      {connectionUrlScheme(selectedConnection.driver)}://...)
                    </p>
                    <Input
                      placeholder={importExampleUrl}
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
            <p className="text-sm text-muted-foreground ml-16">
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
                  onValueChange={(value) =>
                    handleDriverChange(value as DatabaseDriver)
                  }
                >
                  <SelectTrigger className="w-full bg-background/50 border-input/60 focus:border-primary/50 h-10">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="bg-background-elevated border-border text-foreground">
                    {driverOptions.map(({ capabilities, profile }) => (
                      <SelectItem
                        key={capabilities.driver}
                        value={capabilities.driver}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn("inline-flex", profile.iconClassName)}
                          >
                            {renderIcon(profile.defaultIcon, 14)}
                          </span>
                          <span>
                            {capabilities.displayName || profile.menuLabel}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
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
              {/* Left Column: Network & Database */}
              <div className="space-y-6">
                <section className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2 mb-3">
                    <Globe size={12} /> Network & Database
                  </h3>

                  <div className="bg-card/20 border border-border/40 rounded-xl p-4 space-y-4">
                    <div className="grid grid-cols-4 gap-3">
                      <div className="col-span-3 space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground ml-1">
                          Host
                        </label>
                        <Input
                          className="bg-background/50 border-input/60 focus:border-primary/50 font-mono h-9"
                          placeholder="localhost"
                          value={selectedConnection?.host || ""}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            handleChange("host", e.target.value)
                          }
                        />
                      </div>
                      <div className="col-span-1 space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground ml-1">
                          Port
                        </label>
                        <Input
                          className="bg-background/50 border-input/60 focus:border-primary/50 font-mono h-9"
                          type="number"
                          placeholder={String(
                            defaultDatabasePort(selectedConnection.driver) || ""
                          )}
                          value={selectedConnection?.port || ""}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            handleChange("port", parseInt(e.target.value))
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground ml-1">
                        Database Name
                      </label>
                      <Input
                        className="bg-background/50 border-input/60 focus:border-primary/50 h-9"
                        placeholder={
                          defaultDatabaseName(selectedConnection.driver) ||
                          "database"
                        }
                        value={selectedConnection?.database || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleChange("database", e.target.value)
                        }
                      />
                    </div>
                  </div>
                </section>
              </div>

              {/* Right Column: Authentication */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2 mb-3">
                  <Lock size={12} /> Authentication
                </h3>
                <div className="space-y-4 p-4 rounded-xl border border-border/40 bg-card/20">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground ml-1">
                        Username
                      </label>
                      <Input
                        className="bg-background/50 border-input/60 focus:border-primary/50 h-9"
	                        placeholder="user"
                        value={selectedConnection?.user || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleChange("user", e.target.value)
                        }
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground ml-1">
                        Password
                      </label>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          className="bg-background/50 border-input/60 focus:border-primary/50 pr-8 h-9"
                          placeholder="••••••••"
                          value={selectedConnection?.password || ""}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            handleChange("password", e.target.value)
                          }
                          autoComplete="off"
                        />
                        <button
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                        >
                          {showPassword ? (
                            <EyeOff size={12} />
                          ) : (
                            <Eye size={12} />
                          )}
                        </button>
                      </div>
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
              type="button"
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
