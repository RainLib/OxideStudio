# Product

## Register

product

## Users

OxideStudio serves developers, database engineers, and technical operators who need a fast desktop client for relational and document/key/search databases. Users work inside query editing, schema browsing, result inspection, mutation review, and AI-assisted troubleshooting workflows.

## Product Purpose

OxideStudio is a Rust/Tauri database studio inspired by Beekeeper Studio. It should provide low-memory desktop performance, Monaco-based editor intelligence, high-volume data grids, lifecycle-safe database connections, extensible provider support, and a shared AI tool surface for in-app assistant, MCP, and CLI adapters.

## Brand Personality

Fast, precise, and work-focused. The interface should feel like a professional developer tool: dense enough for repeated use, calm under pressure, and explicit about safety boundaries before mutations or destructive actions.

## Anti-references

Avoid marketing-page composition inside the app, decorative UI that competes with data, oversized cards for routine workflows, provider-specific hard-coding that makes new databases require broad UI rewrites, and AI assistant flows that bypass approval, audit, or active workspace context.

## Design Principles

- Optimize for task flow: schema navigation, query execution, result editing, and metadata inspection should stay visible and close to the editor.
- Prefer extensible capability models over driver-name branching so PostgreSQL, MySQL, Redis, MongoDB, Elasticsearch, and future providers share the same UI contracts.
- Treat AI as an operator over explicit tools, not a separate shortcut path around database safety.
- Keep dense surfaces readable with consistent panels, restrained states, and predictable controls.
- Make failures actionable: connection, LSP, query, and assistant errors should explain what failed and what the user can do next.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Preserve keyboard-first editor and navigation workflows, expose focus states, avoid motion that does not communicate state, and keep destructive operations behind explicit confirmation or approval.
