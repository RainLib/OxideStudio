---
name: OxideStudio
description: A precise, compact desktop database workbench.
colors:
  wb-accent: "hsl(216 82% 64%)"
  wb-accent-foreground: "hsl(220 18% 9%)"
  wb-brand: "hsl(276 44% 55%)"
  wb-titlebar: "hsl(288 18% 25%)"
  wb-frame: "hsl(220 8% 10%)"
  wb-panel: "hsl(220 8% 14%)"
  wb-panel-raised: "hsl(220 8% 17%)"
  wb-editor: "hsl(220 8% 12%)"
  wb-grid: "hsl(220 7% 12%)"
  wb-grid-header: "hsl(220 8% 16%)"
  wb-grid-toolbar: "hsl(220 14% 18%)"
  wb-toolbar: "hsl(220 8% 14%)"
  wb-hover: "hsl(220 9% 20%)"
  wb-active: "hsl(218 32% 25%)"
  wb-active-strong: "hsl(218 38% 32%)"
  wb-border: "hsl(220 9% 26%)"
  wb-border-subtle: "hsl(220 9% 19%)"
  wb-text: "hsl(220 14% 88%)"
  wb-text-muted: "hsl(220 10% 66%)"
  wb-error-text: "hsl(0 85% 72%)"
  background: "hsl(222.2 84% 4.9%)"
  foreground: "hsl(210 40% 98%)"
  primary: "hsl(210 40% 98%)"
  primary-foreground: "hsl(222.2 47.4% 11.2%)"
  secondary: "hsl(217.2 32.6% 17.5%)"
  muted-foreground: "hsl(215 20.2% 65.1%)"
  border: "hsl(217.2 32.6% 17.5%)"
  input: "hsl(217.2 32.6% 17.5%)"
  ring: "hsl(212.7 26.8% 83.9%)"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  compact:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
  small:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
  micro:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "9px"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
    letterSpacing: "normal"
  dialog-body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    lineHeight: "20px"
  code:
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace"
    fontSize: "12px"
    lineHeight: "20px"
rounded:
  tree: "3px"
  workbench: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-workbench-primary:
    backgroundColor: "{colors.wb-accent}"
    textColor: "{colors.wb-accent-foreground}"
    rounded: "{rounded.workbench}"
    height: "28px"
    padding: "0 12px"
  button-workbench-ghost:
    textColor: "{colors.wb-text-muted}"
    rounded: "{rounded.workbench}"
    height: "24px"
    padding: "0 8px"
  button-dialog-primary:
    backgroundColor: "{colors.wb-accent}"
    textColor: "{colors.wb-accent-foreground}"
    rounded: "{rounded.workbench}"
    height: "32px"
    padding: "4px 16px"
  button-dialog-outline:
    backgroundColor: "{colors.wb-panel-raised}"
    textColor: "{colors.wb-text}"
    rounded: "{rounded.workbench}"
    height: "32px"
    padding: "4px 16px"
  input-workbench:
    backgroundColor: "{colors.wb-editor}"
    textColor: "{colors.wb-text}"
    rounded: "{rounded.workbench}"
    height: "28px"
    padding: "0 8px"
  tree-row:
    textColor: "{colors.wb-text}"
    rounded: "{rounded.tree}"
    height: "28px"
  badge-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  file-source-toolbar:
    backgroundColor: "{colors.wb-toolbar}"
    textColor: "{colors.wb-text-muted}"
    height: "36px"
    padding: "0 8px"
  file-source-footer:
    textColor: "{colors.wb-text-muted}"
    padding: "0 8px"
  file-source-columns:
    backgroundColor: "{colors.wb-panel-raised}"
    textColor: "{colors.wb-text}"
    rounded: "{rounded.md}"
    width: "320px"
    padding: "12px"
---

# Design System: OxideStudio

## Overview

**Creative North Star: "The Database Workbench"**

This name describes the incumbent interface rather than introducing a new identity. OxideStudio is fast, precise, and work-focused: compact navigation, SQL, and results share one working surface. Restrained panel tones and predictable controls keep repeated operations readable.

This scan records the existing workbench primitives and the file-query extension after its fixture-backed desktop UI review. It is not an audit of every application surface. The review disposition is **ship within that UI scope**; native picker, real Tauri IPC, installed-package/platform acceptance, and whole G11 acceptance remain incomplete. No new shipping raster assets belong to this extension.

**Key Characteristics:**

- Compact panels keep navigation, editing, and results close together.
- Tonal layers and subtle rules organize the workbench.
- Source, read-only status, and recovery actions remain explicit.
- Existing appearance preferences govern color, density, type, and motion.

Authority: [src/index.css](src/index.css) owns workbench CSS; [src/theme](src/theme) owns generic theme configuration; [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) supplies CVA and token reuse conventions. The frontmatter records the reviewed default dark palette and default type sizes, retaining the source HSL notation. It is a design reference, not a replacement runtime theme. Light mode and blue/violet/teal/amber overrides remain defined in the existing CSS and theme provider. Where legacy spacing names or comments disagree with workbench CSS, use the component's current CSS; do not propagate an older example as a new rule.

## Colors

Cool charcoal work surfaces use the selected accent for working state; the shell retains its existing purple tint. Following the approved popup unification design, dialogs, menus, selects, popovers and tooltips share the workbench neutral surfaces. `src/styles/overlays.css` and `popupVariants` own their appearance and motion.

### Primary

- **Workbench blue** (`wb-accent`): focus borders, primary workbench actions, progress, and active affordances. Selection backgrounds use `wb-active` and `wb-active-strong` so selection is not confused with a solid action button.
- **Dialog primary** (`primary` / `primary-foreground`): inside `.wb-popup`, aliases of `wb-accent` / `wb-accent-foreground`; controls follow the selected accent in both themes.

### Secondary

- **Shell violet** (`wb-brand` / `wb-titlebar`): inherited frame atmosphere, with existing full, subtle, and off gradient preferences. It does not become a new file-query accent.

### Neutral

- **Charcoal frame, panel, and editor** (`wb-frame`, `wb-panel`, `wb-panel-raised`, `wb-editor`): distinguish outer shell, navigation, raised controls, and editing space.
- **Grid tones** (`wb-grid`, `wb-grid-header`, `wb-grid-toolbar`): preserve the shared result grid's data hierarchy.
- **Workbench text and rules** (`wb-text`, `wb-text-muted`, `wb-border`, `wb-border-subtle`): primary reading, secondary metadata, and structural boundaries.
- **Popup neutrals** (`background`, `foreground`, `secondary`, `muted-foreground`, `border`, `input`, `ring`): within each popup root, mapped to raised workbench panel, text, panel, muted text, border and accent tokens. Body portals receive the same aliases and typography. Tailwind theme aliases resolve inline at each surface.
- **Readable error red** (`wb-error-text`): file-query errors, paired with an actionable message and alert semantics.

**The Token Family Rule.** All application popups extend the workbench token family through the shared popup variants. Preserve each component's layout and interaction responsibility; remove repeated surface colors, shadows and radii from individual consumers. System file pickers retain platform appearance.

## Typography

The shell defaults to UI sans; the sans appearance option selects Inter with system fallbacks, while the mono option selects the existing system monospace stack. These are preferences, not a new font download requirement. Monaco uses the existing JetBrains Mono / Fira Code / Consolas stack and user-configurable editor size.

- **Title:** the shared Dialog title role in the frontmatter; concise, sentence case, with no display or hero treatment.
- **Body and labels:** the workbench's default small UI scale, with medium or semibold weights establishing local hierarchy. CSS remaps small utility sizes to the selected UI font size.
- **Dialog body:** the shared description role; file setup labels use smaller existing control text and helper text.
- **Code:** the existing editor role, with line numbers and the inherited editor options. Keep SQL editable while describing the file snapshot as read-only.

The compact, small, and micro entries record incumbent 11px, 10px, and 9px source sizes; the default body/label entries are not an exhaustive ramp. Workbench text buttons declare 11px. In `src/index.css`, `.workbench-shell` remaps `text-xs`, `text-[11px]`, and `text-[12px]` to the selected UI size (12px default), `text-[10px]` to the small setting (11px default), and `text-[9px]` to the extra-small setting (10px default). Existing explorer metadata uses the 9px declaration. Shared Dialog and Popover portals now apply the workbench scale through .wb-popup: ordinary labels and text-sm/text-xs utilities use the selected UI size, while 9px/10px utility declarations use the small setting. Dialog titles default to 14px and descriptions to 12px. The source footer declares 10px, while its column action uses the existing 11px workbench text button. Preserve this contextual scale rather than making all text match the default body role.

The follow-up's single detector run reported 34 advisory font-ramp findings and zero primary findings against the earlier reference. This documentation records the source-backed compact scale; it does not claim a detector rerun or a UI font change. See [detector.json](.impeccable/review/file-query-intelligence/detector.json).

Use the existing UI and editor settings rather than fixing all text to one size. Code, paths, and editable content retain text selection; application chrome follows the current global selection behavior.

## Layout

The desktop shell fills the window and contains independently scrolling or resizing panels. Its workspace track uses narrow gutters (4px), panel headers generally use a compact height (32px), and the status bar remains small (22px). Comfortable density raises the existing toolbar minimum height (36px). These current workbench values supersede older generic token examples for this shell.

Use the existing spacing scale in the frontmatter for control gaps and padding. Small icon/text gaps also use established half steps (6px); tree children indent by one conventional step (16px). Truncate long source paths in constrained controls and retain the full value in their title. Keep scrolling within the panel that owns its content.

The file-query setup reuses a centered configuration Dialog capped at 480px with 20px content padding and provider/CSV choices above its footer. Standard dialogs default to 440px; complex windows retain their dedicated dimensions and `layout="custom"`. A ready query tab places its source/run strip, flexible Monaco content and source/limit footer in the normal workspace. The source footer and 320px column Popover retain their feature-specific layout, available-height constraints and collision handling.

Container queries already simplify editor controls at 560px, 420px, and 320px; secondary editor status hides below a window width of 1100px. These are local adaptation rules, not mobile product commitments. The file-query review covered desktop windows at 1280×720 and 1000×700; phone acceptance was outside this scope.

The file-import history/recovery Dialog extends the same desktop panel model: a saved-item navigation pane beside flexible selected detail, with header and footer kept outside the independently scrolling panes. Its local geometry is capped at 880px wide and the viewport minus 32px, with a 220px navigation column and a viewport-minus-32px height cap. The column-mapping disclosure owns its additional bounded scroll region. These dimensions belong to this surface, not to every Dialog. Within this Dialog, use thin, transparent-track scrollbars with inherited muted-foreground thumbs at 55% opacity; the WebKit fallback is 8px with rounded thumbs and full muted-foreground on hover. This keeps long reviews readable without a bright foreign scrollbar.

## Elevation & Depth

Workbench depth is primarily tonal and structural: editor versus panel tones, one-pixel inset rules, and restrained active outlines. Existing shell gradients remain at the frame. Monaco completion widgets use an opaque raised panel and a short shadow; the source column inspector uses the shared Popover's medium shadow with workbench raised-panel colors. Shared Dialogs retain their established large shadow and dark overlay. Cards are available library primitives, not the default unit for editor composition.

Exact shadow snippets and motion values are captured in [.impeccable/design.json](.impeccable/design.json). The file extension adds no new elevation style. Respect the existing reduced-motion preference and system media query; state changes and busy text remain understandable when animation is disabled.

## Shapes

Small rectangular controls dominate. Workbench fields and buttons use the compact corner role; tree rows are slightly tighter. Within popups, Buttons and Inputs use 4px corners, menus and tooltips use 6px, and Dialog uses 8px. Generic controls elsewhere keep their existing defaults. Badges are fully rounded. Preserve these component families rather than applying one radius to every surface.

Thin borders divide panels, headers, and forms. The source toolbar is a full-width strip with a lower rule, not a floating pill or oversized card. Icons use the existing library and compact control sizes; no illustration or raster treatment is needed for this workflow.

## Components

### Buttons

Workbench primary buttons use accent fill, compact height, and a slight brightness increase on hover. Text and icon buttons use muted text with a hover surface; disabled buttons reduce opacity and suppress pointer actions. Icon buttons have accessible labels or titles. Keep Run/Cancel contextual to the active query.

The shared Button provides default, outline, secondary, ghost, destructive, and link variants via CVA. File setup uses its existing default and outline styles; missing-driver recovery uses small outline and ghost actions. Preserve shared hover/active treatments and the visible two-pixel focus ring with its offset.

### Inputs / Fields

Workbench fields use an editor ground, a thin workbench border, and accent focus border. Generic Input uses the dialog family and shared focus ring. File-query native select controls are compact (32px) with the generic input border and focus ring; their provider and CSV-header labels remain visible. Disable configuration choices while preparing a snapshot.

### Navigation

Existing workbench tree rows use compact height, hover feedback, truncation, and an explicit selected surface. Flat explorer mode reduces row height (22px). Project Files retains its own compact rows (24px), muted resting text, active selection ground, and per-depth indentation (14px); do not silently replace those with the generic explorer geometry. Preserve the project's menu and text-open behavior: supported dataset entries expose Query data file alongside the applicable Open as text action. The independent command palette entry remains Open Data File for SQL.

### Chips / Cards

The library Badge provides compact bordered, fully rounded status tags. It is not substituted for the file editor's explicit source/read-only text. The library Card retains its larger radius, border, and small shadow; use the existing panel/form primitives for dense workbench content instead of wrapping routine editing in cards.

### File query workspace

The source strip shows a lock icon, filename, and Read-only snapshot. Run uses the current SQL or selection; Cancel replaces it during execution. A separate Run current statement action uses the caret's statement. Reopen requests a fresh snapshot, retaining SQL while releasing the previous session. Setup has loading, missing-provider, preparing/cancel, and actionable error states. Do not hide those states behind decorative success imagery.

The footer names source format/size and the read-only, 1,000-row, 20-second query limits. Its column-count button opens **Snapshot columns**, a two-column **Column / Inferred type** table with wrapping cell values and thin row rules. This is source metadata acquired with `LIMIT 0` before the initial query and stored independently of result columns. An ended session retains that preview as **Last snapshot columns**, shows **Session closed**, hides the live intelligence icon, and adds an inline ended-session message with **Reopen file…**.

The scoped SQL-intelligence status uses a 12px spinner, check, or alert icon with localized status semantics and title text. It distinguishes starting, ready, and unavailable; unavailable explicitly says queries remain available. Formatting reports an actionable error until intelligence is ready and clears its owned prior error only after a real successful formatting response. Keep this feedback local to the active file tab and document, without suggesting complete DuckDB diagnostics or grammar support.

File-query setup, source/footer labels, commands, sidebar actions, and accessible popup/status names have English and Chinese copy. Examples include **Snapshot columns / 快照列信息**, **Last snapshot columns / 上次快照列信息**, **Inferred type / 推断类型**, and **SQL intelligence unavailable; queries remain available / SQL 辅助不可用，仍可运行查询**. Counts and snapshot size follow the selected locale; user filenames, column names, and SQL stay content. This records scoped translations, not whole-app localization.

Both project files and the independent command route into this setup and reuse the normal SQL/results surface. Keep this composition scoped to the [six-block file-query surface brief](.impeccable/surfaces/src-components-workspace-projectfilessidebar-tsx.md); it is not a required arrangement for every screen. Implementation sources are [FileQueryStatusBar.tsx](src/features/file-query/FileQueryStatusBar.tsx), [FileQueryEditor.tsx](src/features/file-query/FileQueryEditor.tsx), and [FileQueryOpenDialog.tsx](src/features/file-query/FileQueryOpenDialog.tsx), with shared [Popover](src/components/ui/popover.tsx), [Dialog](src/components/ui/dialog.tsx), and [locale messages](src/i18n/messages.ts). See the [initial review](.impeccable/review/file-query-finish-review.md) and [follow-up review](.impeccable/review/file-query-intelligence/finish-review.md) for their precise evidence boundaries. The ten English/Chinese captures at 1280×720 and 1000×700 use synthetic file/LSP fixtures; native picker, Tauri integration, installed-package/platform, and whole G11 acceptance remain outside this documentation's claim.

### File import preparation / recovery

Keep ordinary import as the default. Eligible native-file previews for existing local SQLite tables add the explicit **Prepare resumable…** action. CSV and JSON/XLSX previews retain their existing workbench tokens; the history/recovery Dialog uses the shared workbench popup, Button, and Input family. It adds no palette, type role, shadow, or shipping raster asset.

**Background Tasks → File imports** opens project-scoped saved preparations and jobs. Selected rows have a filled active surface, hover and visible keyboard focus, plus explicit pressed state. The detail pane names source, target, write mode, and recorded counts before actions. Keep preparation and publication visibly separate: active preparation offers **Cancel preparation** with private-data cleanup copy; interrupted preparation offers **Continue preparation** and **Discard preparation** with recheck and removal explanations. Closing the Dialog keeps active work running while the app remains open.

The shared transfer review presents target identity, row counts, mapping disclosure, warnings, and typed confirmation before **Start import** or **Resume import**. Publication has its own state and unavailable pause/cancel controls; requested actions and failures use status/alert text. Preserve the footer's recovery instructions: reopen Background Tasks after quitting and manually refresh the table after publication, keeping unsaved edits. These are visible workflow distinctions, not a claim that desktop integration has been accepted.

Sources: [FileImportJobsDialog.tsx](src/features/table-import/FileImportJobsDialog.tsx), [fileImportJobs.css](src/features/table-import/fileImportJobs.css), [useFileImportJobs.ts](src/features/table-import/useFileImportJobs.ts), [ResumableTransferReview.tsx](src/features/table-transfer/ui/ResumableTransferReview.tsx), and the [file-import surface brief](.impeccable/surfaces/src-features-table-import.md). The finish review's ship disposition covers the scrollbar fix within synthetic browser captures of real components at 1280×720 and 1000×700, using a mock native bridge. It does not establish native picker/IPC, installed-package/platform acceptance, whole G11 acceptance, or global localization; this new flow currently uses English copy. The [file-import detector](.impeccable/review/file-import-detector.json) reported zero primary findings and two advisory existing 13px preview headings. Those headings are not additions to the normative type ramp.

## Do's and Don'ts

### Do:

- **Do** reuse existing workbench classes, CVA variants, and `cn()` composition before adding local styling.
- **Do** retain appearance preferences and theme-aware token references in implementation.
- **Do** keep source identity, read-only state, and recovery actions legible beside the working context.
- **Do** preserve keyboard access, visible focus, and meaningful status/error text.

### Don't:

- **Don't** introduce a new palette or display font for a local workbench extension.
- **Don't** use oversized cards or decorative marketing composition for routine query work.
- **Don't** replace existing theme variables with hard-coded color copies from this reference.
- **Don't** treat fixture screenshots as proof of native picker, IPC, packaged desktop, or whole G11 acceptance.
