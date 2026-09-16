import {
  CheckboxLabel,
  NumberInput,
  SettingRow,
  SettingsDivider,
  SettingsInput,
  SettingsPanel,
  selectClass,
} from "@/features/settings/ui/SettingsFields";
import { SqlSnippetSettingsEditor } from "@/features/settings/ui/SqlSnippetSettingsEditor";
import { type AppSettings } from "@/lib/appSettings";
import { cn } from "@/lib/utils";
import { parseVimMappings, serializeVimMappings } from "@/lib/vimMappings";
import { useEffect, useMemo, useState } from "react";

export function EditorSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const editor = settings.editor;
  const updateEditor = (patch: Partial<AppSettings["editor"]>) =>
    onUpdate({ editor: { ...editor, ...patch } });
  const serializedMappings = useMemo(
    () => serializeVimMappings(editor.vim.mappings),
    [editor.vim.mappings],
  );
  const [vimMappingDraft, setVimMappingDraft] = useState(serializedMappings);
  const [vimMappingErrors, setVimMappingErrors] = useState<string[]>([]);

  useEffect(() => {
    setVimMappingDraft(serializedMappings);
  }, [serializedMappings]);

  const updateVim = (patch: Partial<AppSettings["editor"]["vim"]>) =>
    updateEditor({ vim: { ...editor.vim, ...patch } });

  return (
    <SettingsPanel>
      <SettingsDivider title="Editor tabs" first />
      <SettingRow label="Tab bar position:">
        <select
          className={selectClass}
          value={editor.tabPlacement}
          onChange={(event) =>
            updateEditor({
              tabPlacement: event.target
                .value as AppSettings["editor"]["tabPlacement"],
            })
          }
        >
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </SettingRow>
      <SettingRow label="Group tabs by:">
        <select
          className={selectClass}
          value={editor.tabGroupMode}
          onChange={(event) =>
            updateEditor({
              tabGroupMode: event.target
                .value as AppSettings["editor"]["tabGroupMode"],
            })
          }
        >
          <option value="none">No grouping</option>
          <option value="database-type">Database type</option>
          <option value="connection">Connection</option>
        </select>
      </SettingRow>
      <SettingRow label="Sort tabs by:">
        <select
          className={selectClass}
          value={editor.tabSortMode}
          onChange={(event) =>
            updateEditor({
              tabSortMode: event.target
                .value as AppSettings["editor"]["tabSortMode"],
            })
          }
        >
          <option value="manual">Manual order</option>
          <option value="created-asc">Creation time</option>
          <option value="title-asc">Title</option>
        </select>
      </SettingRow>
      <p className="px-1 pb-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
        Drag tabs to reorder them in Manual order. Pinned tabs always remain in
        their own leading section.
      </p>
      <SettingsDivider title="SQL Editor" />
      <SettingRow label="Font size:">
        <NumberInput
          value={editor.fontSize}
          min={10}
          max={24}
          onChange={(fontSize) => updateEditor({ fontSize })}
        />
      </SettingRow>
      <SettingRow label="Tab size:">
        <NumberInput
          value={editor.tabSize}
          min={2}
          max={8}
          onChange={(tabSize) => updateEditor({ tabSize })}
        />
      </SettingRow>
      <SettingRow label="Word wrap:">
        <select
          className={selectClass}
          value={editor.wordWrap}
          onChange={(event) =>
            updateEditor({
              wordWrap: event.target.value as AppSettings["editor"]["wordWrap"],
            })
          }
        >
          <option value="off">Off</option>
          <option value="on">On</option>
          <option value="wordWrapColumn">At column</option>
          <option value="bounded">Bounded</option>
        </select>
      </SettingRow>
      <CheckboxLabel
        label="Show minimap"
        checked={editor.minimap}
        onChange={() => updateEditor({ minimap: !editor.minimap })}
      />
      <CheckboxLabel
        label="Confirm destructive SQL before execution"
        checked={editor.confirmDestructiveSql}
        onChange={() =>
          updateEditor({ confirmDestructiveSql: !editor.confirmDestructiveSql })
        }
      />
      <CheckboxLabel
        label="Run all SQL from a blank line"
        detail="When Run current statement has no statement at the cursor. Disabled by default."
        checked={editor.executeAllOnBlankLine}
        onChange={() =>
          updateEditor({
            executeAllOnBlankLine: !editor.executeAllOnBlankLine,
          })
        }
      />
      <CheckboxLabel
        label="Show table DDL in editor hover"
        detail="Loads a cached, bounded DDL preview only when hovering a table reference."
        checked={editor.showTableDdlHoverPreview}
        onChange={() =>
          updateEditor({
            showTableDdlHoverPreview: !editor.showTableDdlHoverPreview,
          })
        }
      />
      <CheckboxLabel
        label="Refresh DDL when opening its tab"
        detail="Disabled by default to avoid an extra database request; Refresh always fetches the latest DDL."
        checked={editor.refreshDdlOnOpen}
        onChange={() =>
          updateEditor({ refreshDdlOnOpen: !editor.refreshDdlOnOpen })
        }
      />
      <SettingsDivider title="SQL formatting" />
      <SettingRow label="Keyword case:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.keywordCase}
          onChange={(event) => {
            const keywordCase = event.target
              .value as AppSettings["editor"]["sqlFormatting"]["keywordCase"];
            updateEditor({
              sqlFormatting: { ...editor.sqlFormatting, keywordCase },
              sqlCompletion: { ...editor.sqlCompletion, keywordCase },
            });
          }}
          title="Uses the same keyword casing for formatting and SQL suggestions"
        >
          <option value="upper">UPPER CASE</option>
          <option value="lower">lower case</option>
          <option value="preserve">Preserve source</option>
        </select>
      </SettingRow>
      <SettingRow label="Function case:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.functionCase}
          onChange={(event) => {
            const functionCase = event.target
              .value as AppSettings["editor"]["sqlFormatting"]["functionCase"];
            updateEditor({
              sqlFormatting: { ...editor.sqlFormatting, functionCase },
              sqlCompletion: { ...editor.sqlCompletion, functionCase },
            });
          }}
          title="Cases function calls while preserving quoted function names and database object identifiers"
        >
          <option value="preserve">Preserve source</option>
          <option value="upper">UPPER CASE</option>
          <option value="lower">lower case</option>
        </select>
      </SettingRow>
      <SettingRow label="Logical operators:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.logicalOperatorNewline}
          onChange={(event) =>
            updateEditor({
              sqlFormatting: {
                ...editor.sqlFormatting,
                logicalOperatorNewline: event.target
                  .value as AppSettings["editor"]["sqlFormatting"]["logicalOperatorNewline"],
              },
            })
          }
        >
          <option value="before">New line before AND / OR</option>
          <option value="after">New line after AND / OR</option>
          <option value="none">Keep on the same line</option>
        </select>
      </SettingRow>
      <SettingRow label="FROM clause:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.fromClauseLayout}
          onChange={(event) =>
            updateEditor({
              sqlFormatting: {
                ...editor.sqlFormatting,
                fromClauseLayout: event.target
                  .value as AppSettings["editor"]["sqlFormatting"]["fromClauseLayout"],
              },
            })
          }
        >
          <option value="newLine">First source on a new line</option>
          <option value="sameLine">First source on the FROM line</option>
        </select>
      </SettingRow>
      <SettingsDivider title="SQL completion" />
      <SettingRow label="Automatic suggestions:">
        <select
          className={selectClass}
          value={editor.sqlCompletion.triggerMode}
          onChange={(event) =>
            updateEditor({
              sqlCompletion: {
                ...editor.sqlCompletion,
                triggerMode: event.target
                  .value as AppSettings["editor"]["sqlCompletion"]["triggerMode"],
              },
            })
          }
          title="Manual keeps Ctrl+Space available; Prefix waits for an identifier; Smart positions also opens after SQL clauses"
        >
          <option value="positional">Smart SQL positions</option>
          <option value="require-prefix">After typing a name</option>
          <option value="manual">Manual (Ctrl+Space)</option>
        </select>
      </SettingRow>
      <SettingRow label="Table alias:">
        <select
          className={selectClass}
          value={editor.sqlCompletion.tableAlias}
          onChange={(event) =>
            updateEditor({
              sqlCompletion: {
                ...editor.sqlCompletion,
                tableAlias: event.target
                  .value as AppSettings["editor"]["sqlCompletion"]["tableAlias"],
              },
            })
          }
        >
          <option value="none">Do not generate</option>
          <option value="initials">Generate initials</option>
        </select>
      </SettingRow>
      <CheckboxLabel
        label="Rank suggestions by recent usage"
        detail="Completion choices are stored locally and never sent to the database"
        checked={editor.sqlCompletion.rankByUsage}
        onChange={() =>
          updateEditor({
            sqlCompletion: {
              ...editor.sqlCompletion,
              rankByUsage: !editor.sqlCompletion.rankByUsage,
            },
          })
        }
      />
      <CheckboxLabel
        label="Insert a space after built-in SQL completions"
        detail="Language-server text stays exact; applies only to local names and keywords"
        checked={editor.sqlCompletion.appendSpace}
        onChange={() =>
          updateEditor({
            sqlCompletion: {
              ...editor.sqlCompletion,
              appendSpace: !editor.sqlCompletion.appendSpace,
            },
          })
        }
      />
      <SettingsDivider title="SQL snippets" />
      <SqlSnippetSettingsEditor
        snippets={editor.sqlCompletion.snippets}
        onCommit={(snippets) =>
          updateEditor({
            sqlCompletion: {
              ...editor.sqlCompletion,
              snippets,
            },
          })
        }
      />
      <SettingsDivider title="Vim" />
      <CheckboxLabel
        label="Enable Vim keybindings"
        detail="Normal, Insert, Visual, command, search, and macro workflows"
        checked={editor.keybindingMode === "vim"}
        onChange={() =>
          updateEditor({
            keybindingMode:
              editor.keybindingMode === "vim" ? "standard" : "vim",
          })
        }
      />
      {editor.keybindingMode === "vim" && (
        <>
          <SettingRow label="Leader key:">
            <SettingsInput
              value={editor.vim.leader}
              onChange={(leader) => {
                const normalized = leader.trim();
                if (normalized && normalized.length <= 16) {
                  updateVim({ leader: normalized });
                }
              }}
              placeholder="\\ or <Space>"
            />
          </SettingRow>
          <CheckboxLabel
            label="Use relative line numbers"
            checked={editor.vim.relativeLineNumbers}
            onChange={() =>
              updateVim({
                relativeLineNumbers: !editor.vim.relativeLineNumbers,
              })
            }
          />
          <SettingRow label="Custom mappings:">
            <div className="min-w-0">
              <textarea
                value={vimMappingDraft}
                onChange={(event) => {
                  const source = event.target.value;
                  const parsed = parseVimMappings(source);
                  setVimMappingDraft(source);
                  setVimMappingErrors(parsed.errors);
                  if (parsed.errors.length === 0) {
                    updateVim({ mappings: parsed.mappings });
                  }
                }}
                placeholder={"nnoremap <leader>f /FROM<Enter>\nimap jj <Esc>"}
                spellCheck={false}
                className={cn(
                  "custom-scrollbar min-h-28 w-[420px] resize-y rounded-[4px] border bg-[hsl(var(--wb-panel-raised))] px-2 py-1.5 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]",
                  vimMappingErrors.length > 0
                    ? "border-[hsl(var(--destructive))]"
                    : "border-[hsl(var(--wb-border))]",
                )}
              />
              <p className="mt-1 max-w-[58ch] text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                Supports map, nmap, imap, vmap and their non-recursive forms.
                Use &lt;leader&gt; in either side of a mapping.
              </p>
              {vimMappingErrors.length > 0 && (
                <div className="mt-1 text-[10px] leading-4 text-[hsl(var(--destructive))]">
                  {vimMappingErrors.join(" ")}
                </div>
              )}
            </div>
          </SettingRow>
        </>
      )}
    </SettingsPanel>
  );
}
