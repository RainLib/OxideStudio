import { useEffect, useMemo, useState } from "react";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildRedisCreateKeyCommand,
  REDIS_KEY_TYPES,
  type RedisKeyDraft,
  type RedisKeyType,
} from "@/lib/redisKey";

interface RedisKeyDialogProps {
  open: boolean;
  database: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: RedisKeyDraft, command: string) => Promise<void>;
}

const fieldClass =
  "h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2.5 text-[12px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";

export function RedisKeyDialog({
  open,
  database,
  onOpenChange,
  onCreate,
}: RedisKeyDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<RedisKeyType>("string");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const typeOption = useMemo(
    () => REDIS_KEY_TYPES.find((option) => option.value === type)!,
    [type]
  );

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("string");
    setValue("");
    setTtl("");
    setError(null);
    setIsCreating(false);
  }, [open]);

  const handleCreate = async () => {
    setError(null);
    const draft: RedisKeyDraft = {
      name,
      type,
      value,
      ttlSeconds: ttl.trim() ? Number(ttl) : null,
    };
    try {
      const command = buildRedisCreateKeyCommand(draft);
      setIsCreating(true);
      await onCreate(draft, command);
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isCreating && onOpenChange(next)}>
      <DialogContent layout="custom" className="w-[520px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-red-400" />
            <DialogTitle className="text-[13px]">New Redis Key</DialogTitle>
          </div>
          <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
            Database {database || "0"}. The key is created immediately when you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4">
          <label htmlFor="redis-key-name" className="pt-2 text-[11px] wb-muted">
            Key name
          </label>
          <input
            id="redis-key-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
            placeholder="session:user:42"
          />

          <span className="pt-2 text-[11px] wb-muted">Data type</span>
          <Select value={type} onValueChange={(next) => setType(next as RedisKeyType)}>
            <SelectTrigger className={fieldClass} aria-label="Redis key type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="">
              {REDIS_KEY_TYPES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label htmlFor="redis-key-value" className="pt-2 text-[11px] wb-muted">
            Initial value
          </label>
          <div>
            <textarea
              id="redis-key-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={`${fieldClass} min-h-[118px] resize-y py-2 font-mono leading-5`}
              placeholder={typeOption.placeholder}
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] wb-muted">{typeOption.hint}</p>
          </div>

          <label htmlFor="redis-key-ttl" className="pt-2 text-[11px] wb-muted">
            TTL
          </label>
          <div className="flex items-center gap-2">
            <input
              id="redis-key-ttl"
              type="number"
              min={1}
              step={1}
              value={ttl}
              onChange={(event) => setTtl(event.target.value)}
              className={`${fieldClass} max-w-[160px]`}
              placeholder="No expiration"
            />
            <span className="text-[10px] wb-muted">seconds, optional</span>
          </div>

          {error && (
            <div className="col-start-2 flex items-start gap-1.5 text-[11px] text-red-400" role="alert">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <button
            type="button"
            className="wb-text-button h-7 px-3 text-[11px]"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="wb-primary-button h-7 min-w-[76px] justify-center px-3 text-[11px]"
            onClick={() => void handleCreate()}
            disabled={isCreating || !name.trim()}
          >
            {isCreating ? <Loader2 size={12} className="animate-spin" /> : "Create Key"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
