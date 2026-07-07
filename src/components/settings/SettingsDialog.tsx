import React, { useContext, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { aiService } from "@/services/tauri/ai.service";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { ThemeContext } from "@/theme/ThemeProvider";
import { Bot, Laptop, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const themeContext = useContext(ThemeContext);
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);
  const setAiEnabled = useAiSettingsStore((state) => state.setEnabled);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const [aiTestState, setAiTestState] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);

  if (!themeContext) return null;
  const { mode, setTheme } = themeContext;
  const canTestAi = Boolean(aiBaseUrl.trim() && aiModel.trim());

  const handleTestAiProvider = async () => {
    setAiTestState(null);
    setIsTestingAi(true);
    try {
      const result = await aiService.testProvider({
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim(),
        apiKey: aiApiKey.trim() || undefined,
        timeoutMs: aiTimeoutMs,
      });
      setAiTestState({
        status: "success",
        message: `${result.message}: ${result.model}`,
      });
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
    } finally {
      setIsTestingAi(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] h-[560px] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border bg-background">
          <DialogTitle className="text-foreground">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure appearance and AI assistant preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden bg-background">
          <Tabs
            defaultValue="appearance"
            orientation="vertical"
            className="flex w-full h-full"
          >
            <TabsList className="bg-muted w-48 h-full flex-col justify-start items-stretch gap-1 p-3 border-r border-border rounded-none">
              <TabsTrigger
                value="appearance"
                className="justify-start px-3 data-[state=active]:bg-secondary"
              >
                Appearance
              </TabsTrigger>
              <TabsTrigger
                value="ai"
                className="justify-start gap-2 px-3 data-[state=active]:bg-secondary"
              >
                <Bot className="h-4 w-4" />
                AI
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="appearance"
              className="flex-1 p-6 m-0 overflow-y-auto"
            >
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-1">Theme</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Customize the appearance of the application.
                  </p>

                  <div className="grid grid-cols-3 gap-4">
                    <ThemeCard
                      label="Light"
                      active={mode === "light"}
                      onClick={() => setTheme("light")}
                      icon={<Sun className="h-6 w-6 mb-2" />}
                    />
                    <ThemeCard
                      label="Dark"
                      active={mode === "dark"}
                      onClick={() => setTheme("dark")}
                      icon={<Moon className="h-6 w-6 mb-2" />}
                    />
                    <ThemeCard
                      label="System"
                      active={mode === "system"}
                      onClick={() => setTheme("system")}
                      icon={<Laptop className="h-6 w-6 mb-2" />}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="ai"
              className="flex-1 p-6 m-0 overflow-y-auto"
            >
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-medium mb-1">AI Assistant</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure an OpenAI-compatible model endpoint for tool planning.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-md border border-border bg-background-secondary/40 px-3 py-3">
                  <div className="min-w-0">
                    <Label htmlFor="ai-enabled" className="text-sm">
                      Use model planner
                    </Label>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Off keeps the local deterministic planner.
                    </div>
                  </div>
                  <Switch
                    id="ai-enabled"
                    checked={aiEnabled}
                    onCheckedChange={setAiEnabled}
                  />
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="ai-base-url">Base URL</Label>
                    <Input
                      id="ai-base-url"
                      value={aiBaseUrl}
                      onChange={(event) =>
                        updateAiSettings({ baseUrl: event.target.value })
                      }
                      placeholder="https://api.openai.com/v1"
                      spellCheck={false}
                    />
                  </div>

                  <div className="grid grid-cols-[1fr_140px] gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="ai-model">Model</Label>
                      <Input
                        id="ai-model"
                        value={aiModel}
                        onChange={(event) =>
                          updateAiSettings({ model: event.target.value })
                        }
                        placeholder="gpt-4.1-mini"
                        spellCheck={false}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ai-timeout">Timeout ms</Label>
                      <Input
                        id="ai-timeout"
                        type="number"
                        min={1000}
                        step={1000}
                        value={aiTimeoutMs}
                        onChange={(event) =>
                          updateAiSettings({
                            timeoutMs: Number(event.target.value) || 30_000,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="ai-api-key">API Key</Label>
                    <Input
                      id="ai-api-key"
                      type="password"
                      value={aiApiKey}
                      onChange={(event) =>
                        updateAiSettings({ apiKey: event.target.value })
                      }
                      placeholder="sk-..."
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleTestAiProvider}
                    disabled={!canTestAi || isTestingAi}
                  >
                    {isTestingAi ? "Testing" : "Test Provider"}
                  </Button>
                  {aiTestState && (
                    <div
                      className={cn(
                        "text-xs",
                        aiTestState.status === "success"
                          ? "text-emerald-500"
                          : "text-destructive"
                      )}
                    >
                      {aiTestState.message}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThemeCard({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border-2 bg-popover p-4 hover:bg-accent transition-all flex flex-col items-center justify-center",
        active
          ? "border-primary bg-accent text-foreground"
          : "border-muted text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </div>
  );
}
