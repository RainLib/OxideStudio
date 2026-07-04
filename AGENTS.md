# Repository Guidelines

## Project Structure & Module Organization

OxideStudio is a Tauri desktop app with a React frontend and Rust backend. Frontend code lives in `src/`: `components/` for reusable UI, `components/workspace/` and `components/connection/` for feature views, `pages/` for route-level screens, `store/` for Zustand state, `services/` for Tauri and LSP clients, `hooks/` for React logic, and `styles/` plus `theme/` for design primitives. Rust code, Tauri config, capabilities, icons, and bundled binaries live in `src-tauri/`. Project documentation is under `docs/`; static web assets are in `public/`.

## Build, Test, and Development Commands

- `npm install`: install frontend and Tauri CLI dependencies.
- `npm run dev`: start the Vite web dev server only.
- `npm run tauri dev`: run the full desktop app with Rust compilation and Vite.
- `npm run build`: type-check with `tsc` and build the frontend.
- `npm run tauri build`: build production desktop bundles.
- `npm run preview`: preview the built frontend.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run Rust tests when backend tests are present.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings; unused locals and parameters are build failures. Prefer the `@/` path alias for imports from `src`. React components use PascalCase filenames, hooks use `useXxx.ts`, and Zustand stores use `useXxxStore.ts`. Follow the CVA style system in `docs/STYLE_GUIDE.md`: prefer variants from `src/styles/variants/`, combine classes with `cn()`, and avoid hard-coded colors or repeated inline Tailwind blocks.

## Testing Guidelines

There is currently no frontend test script or established test directory. When adding tests, colocate them near the code or use a clear `tests/` directory, name files `*.test.ts` or `*.test.tsx`, and add the matching package script. For Rust logic, prefer standard `#[test]` or async Tokio tests and run them with the Cargo command above.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `feat:`, `fix:`, and scoped forms like `refactor(lsp):`. Keep commits focused and imperative, for example `feat(lsp): queue documents before initialization`. Pull requests should describe the user-visible change, note frontend/backend impact, link related issues, include screenshots or recordings for UI changes, and list the validation commands run.

## Security & Configuration Tips

Do not commit database credentials, local connection strings, or generated build artifacts. Review `src-tauri/capabilities/default.json` when adding commands or permissions, and keep bundled binaries in `src-tauri/binaries/` versioned intentionally.
