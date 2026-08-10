# DBX Upstream Delta -- 2026-08-11

## Baseline refresh

- ChartDB `origin/main`: `c24936a402bb3e24b4858f05282d69a04fcfe25b`.
- DBX `origin/main`: `2e9ed477a48ceabd7fbe9319db6bac6c096abae9`.
- The functional DBX delta since the previous audit is
  `1b37e9748 feat(xugu): expose object type members in schema tree`.

## Confirmed alignment gap

DBX represents explicitly expandable Xugu `TYPE` objects and lazily loads
their attributes, functions, and procedures. Its implementation spans:

- `agents/drivers/xugu/{main.go,type_members.go,package_members.go}`
- `apps/desktop/src/lib/sidebar/xuguTypeMembers.ts`
- `apps/desktop/src/stores/connectionStore.ts`
- `apps/desktop/src/components/sidebar/{SidebarTreeRuntimeHost,TreeItem}.vue`

OxideStudio now exposes a backward-compatible `SchemaObjects` metadata request
and a runtime `schemaObjects` capability in
`src-tauri/crates/oxide-driver-protocol/src/lib.rs`. The host's
`SchemaObjectInfo.membersExpandable` field is explicit and defaults to false,
so existing packages and non-Xugu object types stay unchanged. A Xugu sidecar
still needs to implement the request before the UI can expose an expander.
The Explorer now requests descriptor objects for all relational drivers;
unsupported built-ins and old sidecars return an empty list, while new capable
packages can display their object descriptors without another driver-name
branch.

## Implementation boundary

Do not mark every renderer type node as expandable. The next phase adds a
keyboard-accessible, explicitly marked lazy tree expansion with loading and
error states after the Xugu sidecar implements the capability. Real Xugu
validation remains deferred with the broader database verification work.
