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

OxideStudio currently exposes `SchemaObjectInfo` as a flat, descriptor-only
schema-object list in `src-tauri/src/core/protocol.rs` and
`src/services/tauri/types.ts`. Its external-driver schema protocol does not
yet carry a typed-member capability or a parent-type-scoped metadata request.

## Implementation boundary

Do not mark every renderer type node as expandable. The next phase must first
extend the external-driver metadata contract, then add a keyboard-accessible,
explicitly marked lazy tree expansion with loading and error states. Real Xugu
validation remains deferred with the broader database verification work.
