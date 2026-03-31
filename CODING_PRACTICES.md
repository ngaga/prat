# Coding practices — Prat

Reference for humans and assistants (similar to a detailed `AGENTS.md`). Repositories such as [dust-tt/dust](https://github.com/dust-tt/dust) often keep the root light and point at local, unversioned docs; here everything lives in this file so a fresh clone stays reproducible.

## Language: code and versioned documentation

- **Code**: all source (identifiers, technical strings, developer-facing errors, etc.) is written in **English**.
- **README files**: `README.md` and other markdown docs in the repo (unless you explicitly agree otherwise for a rare exception) are in **English**, so contributors and tooling see a single language.

## General principles

- **Scoped changes**: only change what the task needs; no opportunistic refactors or unrelated files.
- **Consistency**: match naming, types, imports, and comment depth in the files you touch.
- **Clarity**: prefer straightforward control flow over many special cases.

## Game architecture

- **Simulation vs display**: gameplay and server logic use **simulation units**; Phaser/CSS pixels are for rendering and for inputs converted at the boundary. Do not mix the two.
- **Key files**: under `apps/frontend/src/`: `lib/simulationSpace.ts`, `lib/gameBalance.ts`, `game/simulationToDisplay.ts`, with the client boundary in `game/scenes/GameScene.ts`. See `README.md` for the section on simulation units and display.

## TypeScript, React, Next.js

- **Types**: honor the type system; avoid `any` except for small, documented cases.
- **App Router**: API routes under `apps/frontend/src/app/api/`; follow Next.js 16 conventions for handlers and dynamic segments.
- **Lint**: `pnpm run lint` from repo root (ESLint in `apps/frontend`; `eslint-config-next`: core-web-vitals + TypeScript). Alternatively `pnpm --filter frontend lint`.

## Naming

- **No opaque acronyms in code**: prefer full, explicit names (`gameSession` over ambiguous abbreviations).
- **Constants**: `SCREAMING_SNAKE` for shared constants; stay consistent with existing code.

## Comments

- **Comments**: in **English** (same rule as code), short and useful—explain why or non-obvious pitfalls, not what the next line obviously does.
- **No emojis** in code or comments.

## Database (Supabase)

- **Security**: no secrets in the repo; document environment variables in the README (in English).

### Migrations: never rewrite history

**Do not change a migration file after it has been applied** (production or any shared environment). The rule is often stated as: *never modify a migration that has been applied*. Applied migrations are **immutable**.

**Why it matters**

- **Checksums**: Supabase (and similar tools) record each file’s hash. Editing an applied file changes the hash and the tooling reports a mismatch or refuses to proceed.
- **Drift**: if one environment ran the old file and another runs a modified file, schemas diverge and bugs become environment-specific.
- **Reproducibility**: `supabase db reset` (or a clean clone) replays migrations from scratch. Altering old files breaks the guarantee that everyone gets the same final schema.

**Correct approach: forward-only fixes**

- Keep the mistaken migration as-is once it has run anywhere that matters.
- Add a **new** migration that fixes the schema (`ALTER TABLE …`, `DROP COLUMN`, etc.).
- Prefer **idempotent** SQL where it helps (`drop column if exists`, `add column if not exists`) so replays and multiple environments stay safe.

**Style**

- Prefer **one clear concern per migration** and **descriptive filenames** (e.g. `20250326140000_remove_redundant_duration_column.sql`), not generic names like `fix.sql` or `update.sql`.
- Optional: document a manual **down** path in comments if your team uses that pattern; Supabase migrations are typically forward-only.

## API and multiplayer

- Validate inputs in route handlers; return clear errors without leaking sensitive details.
- Reuse existing helpers (e.g. `gameSessions.ts`) instead of duplicating logic.

## Review and delivery

- **Diffs**: every line should serve the request; avoid redundant comments or overly defensive blocks.
- **Commits / PRs**: full sentences; describe what changed and why.

## For assistants (Cursor / AI)

- Read this file first for repository conventions.
- If generic advice conflicts with this document or the repo READMEs, **this document and the READMEs win** for this project.
