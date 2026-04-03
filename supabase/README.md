# Supabase (this file is in English)

## Environment variables

Use **`apps/backend/.env.local`** (not committed) for server secrets. See `apps/backend/.env.example`.

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Used by the **Nest** backend. **Never** expose this to the browser or `NEXT_PUBLIC_*`. |
| `SUPABASE_URL` | Supabase project URL on the backend. |

## Migrations

**Option A – Dashboard**

1. Supabase Dashboard → **SQL Editor**
2. Paste and run `migrations/20250213000000_init.sql`

**Option B – CLI**

```bash
supabase db push
```

## Security model

The database is not queried from the client with anon keys for game data. The **Nest** app (`apps/backend`, prefix `/api`) uses the **service role** key on the server for flags, players, and game sessions.

## Feature flags

Rows live in `feature_flags`. The frontend reads them via the Nest base URL, e.g.:

- `{BACKEND}/api/feature-flags/octopuses`
- `{BACKEND}/api/feature-flags/stingrays`
- `{BACKEND}/api/feature-flags/server` (bundled, used by the in-process game engine refresh loop)

The game server (`gameEngine`) refreshes the same flag keys so octopus/stingray spawns match the database.

### Toggle octopuses (`octopuses_enabled`)

```sql
update feature_flags set value = false where key = 'octopuses_enabled';
-- turn on:
update feature_flags set value = true where key = 'octopuses_enabled';
```

### Toggle stingrays (`stingrays_enabled`)

```sql
update feature_flags set value = false where key = 'stingrays_enabled';
-- turn on:
update feature_flags set value = true where key = 'stingrays_enabled';
```

If `stingrays_enabled` is missing, run `migrations/20250213120000_stingrays_feature_flag.sql`.
