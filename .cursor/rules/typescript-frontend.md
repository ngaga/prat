---
description: Next.js, React, and Phaser conventions for this monorepo
globs: "**/*.{ts,tsx}"
alwaysApply: false
---

# TypeScript and frontend

## Stack

This repo is a pnpm monorepo. Next.js lives in `apps/frontend` (App Router under `apps/frontend/src/app` where applicable), with React, TypeScript, Tailwind CSS, Phaser for the game client, and Supabase for backend data when present. A NestJS app may exist under `apps/backend`.

## Conventions

- Match existing import style and component patterns in neighboring files.
- Keep game logic in dedicated modules or Phaser scenes; avoid bloating route handlers or page components.
- Prefer extending existing helpers in `apps/frontend/src/lib/` over duplicating logic.

## API and server code

Supabase persistence goes through **Nest** (`apps/backend`). Remaining Next route handlers are under `apps/frontend/src/app/api/game/` only. Align patterns in `apps/frontend/src/lib/` (naming, error responses, typing).
