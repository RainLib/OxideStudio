import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface RenameTableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  objectLabel?: string;
  onRename: (oldName: string, newName: string) => Promise<void>;
}

export function RenameTableDialog({
  isOpen,
  onClose,
  tableName,
  objectLabel = "Table",
  onRename,
}: RenameTableDialogProps) {
  const [newName, setNewName] = useState(tableName);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNewName(tableName);
      setError(null);
    }
  }, [isOpen, tableName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || newName === tableName) {
      onClose();
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await onRename(tableName, newName);
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {objectLabel}</DialogTitle>
          <DialogDescription>
            Enter a new name for {objectLabel.toLowerCase()}{" "}
            <strong>{tableName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="name">
                Name
              </Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </div>
            {error && (
              <div className="text-red-500 text-sm ml-auto">{error}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
