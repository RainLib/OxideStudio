import type { VimCustomMapping, VimMappingMode } from "@/lib/appSettings";

export type ParsedVimMappings = {
  mappings: VimCustomMapping[];
  errors: string[];
};

const VIM_COMMAND =
  /^(map|nmap|imap|vmap|noremap|nnoremap|inoremap|vnoremap)\s+(\S+)\s+(.+)$/i;

export function parseVimMappings(source: string): ParsedVimMappings {
  const mappings: VimCustomMapping[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('"')) return;

    const match = line.match(VIM_COMMAND);
    if (!match) {
      errors.push(`Line ${index + 1}: expected a Vim map command`);
      return;
    }

    const command = match[1]!.toLowerCase();
    const lhs = match[2]!.trim();
    const rhs = match[3]!.trim();
    const mode = vimMappingMode(command);
    const recursive = !command.includes("noremap");
    const key = `${mode}:${lhs.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`Line ${index + 1}: duplicate mapping for ${lhs}`);
      return;
    }
    seen.add(key);
    mappings.push({ mode, lhs, rhs, recursive });
  });

  return { mappings, errors };
}

export function serializeVimMappings(mappings: VimCustomMapping[]) {
  return mappings
    .map((mapping) => {
      const command = vimMappingCommand(mapping.mode, mapping.recursive);
      return `${command} ${mapping.lhs} ${mapping.rhs}`;
    })
    .join("\n");
}

export function expandVimLeader(value: string, leader: string) {
  return value.replace(/<leader>/gi, leader);
}

function vimMappingMode(command: string): VimMappingMode {
  if (command.startsWith("i")) return "insert";
  if (command.startsWith("v")) return "visual";
  if (command.startsWith("n") && command !== "noremap") return "normal";
  return "all";
}

function vimMappingCommand(mode: VimMappingMode, recursive: boolean) {
  if (mode === "insert") return recursive ? "imap" : "inoremap";
  if (mode === "visual") return recursive ? "vmap" : "vnoremap";
  if (mode === "normal") return recursive ? "nmap" : "nnoremap";
  return recursive ? "map" : "noremap";
}
