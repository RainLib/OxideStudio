import React, { useContext } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeContext } from "@/theme/ThemeProvider";
import { Moon, Sun, Laptop } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const themeContext = useContext(ThemeContext);

  if (!themeContext) return null;
  const { mode, setTheme } = themeContext;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[500px] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border bg-background">
          <DialogTitle className="text-foreground">Settings</DialogTitle>
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
              {/* Future settings tabs can go here */}
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
        "cursor-pointer rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground flex flex-col items-center justify-center transition-all",
        active && "border-primary bg-accent"
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </div>
  );
}
