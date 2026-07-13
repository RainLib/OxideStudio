import { Database } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface PostgresDatabaseVisibilitySectionProps {
  databases: string[];
  currentDatabase: string | null;
  showAll: boolean;
  visibleDatabases: ReadonlySet<string>;
  checkboxClassName: string;
  connectionColor: string;
  onToggleAll: (checked: boolean | "indeterminate") => void;
  onToggleDatabase: (
    database: string,
    checked: boolean | "indeterminate"
  ) => void;
}

export function PostgresDatabaseVisibilitySection({
  databases,
  currentDatabase,
  showAll,
  visibleDatabases,
  checkboxClassName,
  connectionColor,
  onToggleAll,
  onToggleDatabase,
}: PostgresDatabaseVisibilitySectionProps) {
  return (
    <>
      <div className="flex h-5 items-center px-2 text-[10px] font-medium wb-muted">
        Databases
      </div>
      <label className="flex h-6 cursor-default select-none items-center gap-2 px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
        <Checkbox
          className={checkboxClassName}
          checked={showAll}
          onCheckedChange={onToggleAll}
        />
        <span className="font-medium">All databases</span>
        <span className="ml-auto text-[10px] wb-muted">{databases.length}</span>
      </label>
      {databases.map((database) => (
        <label
          key={database}
          data-postgres-database-visibility={database}
          className="flex h-6 cursor-default select-none items-center gap-2 px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]"
        >
          <Checkbox
            className={checkboxClassName}
            checked={showAll || visibleDatabases.has(database)}
            onCheckedChange={(checked) =>
              onToggleDatabase(database, checked)
            }
          />
          <Database
            size={12}
            className="shrink-0"
            style={{ color: connectionColor }}
          />
          <span className="min-w-0 flex-1 truncate">{database}</span>
          {database === currentDatabase && (
            <span className="shrink-0 text-[9px] wb-muted">default</span>
          )}
        </label>
      ))}
    </>
  );
}
