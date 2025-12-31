import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionStore } from "@/store/useConnectionStore";
import { queryService } from "@/services/tauri/query.service";
import { useSchemaStore } from "@/store/useSchemaStore";

interface CreateDatabaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnectionId: string;
}

const MYSQL_CHARSETS = ["utf8mb4", "utf8", "latin1", "ascii", "gbk", "gb2312"];

const MYSQL_COLLATIONS: Record<string, string[]> = {
  utf8mb4: ["utf8mb4_general_ci", "utf8mb4_unicode_ci", "utf8mb4_bin"],
  utf8: ["utf8_general_ci", "utf8_unicode_ci", "utf8_bin"],
  latin1: ["latin1_general_ci", "latin1_swedish_ci", "latin1_bin"],
  ascii: ["ascii_general_ci", "ascii_bin"],
  gbk: ["gbk_chinese_ci", "gbk_bin"],
  gb2312: ["gb2312_chinese_ci", "gb2312_bin"],
};

export function CreateDatabaseDialog({
  isOpen,
  onClose,
  activeConnectionId,
}: CreateDatabaseDialogProps) {
  const [databaseName, setDatabaseName] = useState("");
  const [charset, setCharset] = useState("utf8mb4");
  const [collation, setCollation] = useState("utf8mb4_general_ci");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { connections } = useConnectionStore();
  const { loadSchemas } = useSchemaStore();

  const connection = connections.find((c) => c.id === activeConnectionId);
  const driver = connection?.driver || "postgres";

  const handleCreate = async () => {
    if (!databaseName.trim()) {
      setError("Database name is required");
      return;
    }

    // Validate database name (basic check)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
      setError(
        "Invalid database name. Use letters, numbers, and underscores only."
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let sql: string;
      const quote = driver === "mysql" ? "`" : '"';

      if (driver === "mysql") {
        sql = `CREATE DATABASE ${quote}${databaseName}${quote} CHARACTER SET ${charset} COLLATE ${collation};`;
      } else {
        // PostgreSQL
        sql = `CREATE DATABASE ${quote}${databaseName}${quote};`;
      }

      console.log("Creating database with SQL:", sql);

      await queryService.executeQuery(activeConnectionId, sql);

      // Refresh schemas to show the new database
      await loadSchemas(activeConnectionId, true);

      // Reset form and close
      setDatabaseName("");
      setCharset("utf8mb4");
      setCollation("utf8mb4_general_ci");
      onClose();
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCharsetChange = (newCharset: string) => {
    setCharset(newCharset);
    // Auto-select default collation for the charset
    const collations = MYSQL_COLLATIONS[newCharset] || [];
    if (collations.length > 0) {
      setCollation(collations[0]);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[400px] bg-[#18181b] text-foreground border-white/10">
        <DialogHeader>
          <DialogTitle>Create New Database</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-xs p-2 rounded border border-destructive/20">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Database Name
            </label>
            <Input
              value={databaseName}
              onChange={(e) => setDatabaseName(e.target.value)}
              placeholder="e.g. my_database"
              className="bg-[#27272a] border-white/10"
              autoFocus
            />
          </div>

          {driver === "mysql" && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Character Set
                </label>
                <Select value={charset} onValueChange={handleCharsetChange}>
                  <SelectTrigger className="bg-[#27272a] border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MYSQL_CHARSETS.map((cs) => (
                      <SelectItem key={cs} value={cs}>
                        {cs}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Collation
                </label>
                <Select value={collation} onValueChange={setCollation}>
                  <SelectTrigger className="bg-[#27272a] border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(MYSQL_COLLATIONS[charset] || []).map((col) => (
                      <SelectItem key={col} value={col}>
                        {col}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Database"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
