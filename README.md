# Prat

Pirate ship game where you capture “Prats” (like “pirate” without _i_ and _e_). Prats are letter-shaped creatures; they are stronger when bigger or italic.

## Stack

- Next.js 16 + React 19 + TypeScript (`apps/frontend`)
- Phaser.js (2D game)
- Supabase (auth + DB)
- Tailwind CSS
- NestJS (`apps/backend`, **Supabase access**: players, sessions, feature flags)

## Simulation units vs display

The game separates **simulation space** (abstract units, League-of-Legends-style) from **display** (Phaser pixels / browser). All gameplay logic (server, collisions, speed) uses **simulation units**; conversion to pixels happens only for rendering (and the inverse for network inputs).

### Principles

| Principle | Implementation |
|-----------|------------------|
| No screen pixels in server physics | `apps/frontend/src/lib/gameEngine.ts` does not import `displayConstants` |
| Shared spatial constants | `simulationSpace.ts`, `gameBalance.ts` under `apps/frontend/src/lib/` (distances documented as simulation units) |
| Canvas / zoom for display only | `VIEW_WIDTH` / `VIEW_HEIGHT` in `displayConstants.ts` + `GameScene.updateCameraZoom()` (same `apps/frontend/src/…` tree) |
| Single rendering conversion layer | `simulationToDisplay.ts`: `simulationToPhaserPixels`, `phaserPixelsToSimulation` |
| Client boundary | `GameScene`: SSE state → `simulationToPhaserPixels`; `MOVE` / `SHOOT` / `PRAT_CAPTURE` → `phaserPixelsToSimulation` |
| Default ratio | `SIMULATION_UNITS_TO_PHASER_PIXELS = 1` (historically ~1 world unit = 1 Phaser pixel) |

### Key files

- **`apps/frontend/src/lib/simulationSpace.ts`** — World, speeds, radii, player ranges, client tuning (ship speed, arrival threshold, targeting click radius).
- **`apps/frontend/src/lib/gameBalance.ts`** — Progression, prat capture, octopus, etc. (distances in simulation units).
- **`apps/frontend/src/lib/displayConstants.ts`** — Logical canvas resolution + zoom; **not** simulation.
- **`apps/frontend/src/game/simulationToDisplay.ts`** — Single place to change global display ↔ simulation scale without touching the authoritative server.
- **`apps/frontend/src/game/scenes/GameScene.ts`** — Conversions at network ↔ Phaser boundaries.

### Design choices

1. **Name “simulation units”** — Numbers stay on the legacy scale (1 ≈ 1 legacy “world pixel”) for balance; do not mix with CSS pixels.
2. **Max player letter range** — `PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS` (~1102) replaces the old `√(VIEW²)/2` in the engine so logic does not depend on resolution.
3. **Zoom** — Independent of `simulationToDisplay` ratio: zoom fits the camera to the window; ratio is world → Phaser coordinates.
4. **`WorldSpace.ts`** — Legacy inheritance not used elsewhere; the canonical conversion is `simulationToDisplay.ts`.

### Tuning

- **Gameplay**: `apps/frontend/src/lib/simulationSpace.ts` and `apps/frontend/src/lib/gameBalance.ts`.
- **Global rendering** (bigger/smaller on screen without changing the server): `SIMULATION_UNITS_TO_PHASER_PIXELS` in `apps/frontend/src/game/simulationToDisplay.ts` (check Phaser bounds and clamping).

### Caveats

- Phaser / `physics.world.setBounds` stay in coordinates **after** conversion (expected).
- Text sprite font sizes use CSS pixels (outside the “simulation world” model).

## Development

**pnpm** monorepo: Next.js frontend in `apps/frontend`, NestJS API in `apps/backend`.

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` runs Next (port **3000**) and Nest together. **Game** routes (`/api/game/stream`, `/api/game/input`) stay on Next; **database-backed** APIs go through Nest. Frontend only: `pnpm dev:frontend`. API only: `pnpm dev:backend`.

If your IDE sets `PORT` (e.g. **10000** for a preview), Nest binds to that port. The frontend dev script (`apps/frontend/scripts/dev.sh`) copies `PORT` into `NEXT_PUBLIC_NEST_PORT`, then clears `PORT` so Next still uses **3000**, while the browser calls Nest on the same port (e.g. `http://127.0.0.1:10000`). Override with `NEXT_PUBLIC_BACKEND_URL` or `BACKEND_URL` if needed.

```bash
pnpm run build
```

### Environment (per app)

Use **two** local env files (standard for monorepos): copy each `**/.env.example` to **`.env.local`** in the same folder. Do **not** put service-role secrets in the frontend file.

| App | File | Role |
|-----|------|------|
| Next | `apps/frontend/.env.local` | Only `NEXT_PUBLIC_*` (and optional non-public vars for server components if you add any). See `apps/frontend/.env.example`. |
| Nest | `apps/backend/.env.local` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `FRONTEND_ORIGIN`. See `apps/backend/.env.example`. |

A root `.env.local` is **not** required; you can delete it after migrating into the two files above.

## Deployment

### Render (SSL included)

The app needs **two Web Services**: Nest (`prat-api`) and Next (`prat-web`). The root `render.yaml` defines both (Blueprint). Alternatively create them manually with the commands below.

**1. Backend (`prat-api` or your name)**

| Setting | Value |
|---------|--------|
| Root directory | *(repo root, empty)* |
| Build | `corepack enable && pnpm install && pnpm run build:backend` |
| Start | `pnpm run start:backend` |
| Health check path | `/api/feature-flags/octopuses` |

**Environment (backend)**

| Variable | Notes |
|----------|--------|
| `NODE_VERSION` | `20` |
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | Supabase project URL (not secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret; server only |

Optional: `FRONTEND_ORIGIN` = comma-separated list of allowed origins (e.g. `https://prat-web.onrender.com`). If omitted in production, CORS reflects the browser `Origin` header so cross-origin calls from the Next app still work.

**2. Frontend (`prat-web`)**

| Setting | Value |
|---------|--------|
| Build | `corepack enable && pnpm install && pnpm run build` |
| Start | `pnpm run start` |

**Environment (frontend)**

| Variable | Notes |
|----------|--------|
| `NODE_VERSION` | `20` |
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL as Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable / anon key |
| `NEXT_PUBLIC_BACKEND_URL` | **HTTPS URL of the API service**, e.g. `https://prat-api.onrender.com` (no trailing slash). Set this **after** the API service is live. |

**Order:** Deploy the API first, copy its public URL, add `NEXT_PUBLIC_BACKEND_URL` on the web service, then redeploy the web service so Next bakes the correct public URL into the client bundle.

### Free hostname + Cloudflare

- Render gives each service a URL like `https://<service-name>.onrender.com`.
- You can point a custom domain at either service in the Render dashboard.

### Local variable cheat sheet

**`apps/frontend/.env.local`** — example:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=xxx
# Optional in local dev if dev.sh sets NEXT_PUBLIC_NEST_PORT:
# NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:3001
```

**`apps/backend/.env.local`** — example:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
```

Without Supabase client keys in the frontend, the game can run solo without realtime multiplayer. With keys + service role + Nest running, persistence and flags work.

### Ko-fi

Set `NEXT_PUBLIC_KOFI_USERNAME` or edit `apps/frontend/src/components/KofiButton.tsx`.

### Background music

Add `apps/frontend/public/sounds/music.mp3` (properly licensed). Playback starts on first click or keypress (browser autoplay policy).

### Multiplayer (Supabase)

1. Create a project on [Supabase](https://supabase.com)
2. Copy URL and anon / publishable key from Settings > API
3. On Render: set `SUPABASE_*` on the API service and `NEXT_PUBLIC_*` on the web service (and `NEXT_PUBLIC_BACKEND_URL` after the API URL is known)
