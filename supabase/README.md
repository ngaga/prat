# Supabase (this file is in English)

## Environment variables

Add to your project `.env.local` (not committed):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Used by API routes. **Never** expose this to the browser or `NEXT_PUBLIC_*`. |

## Migrations

**Option A – Dashboard**

1. Supabase Dashboard → **SQL Editor**
2. Paste and run `migrations/20250213000000_init.sql`

**Option B – CLI**

```bash
supabase db push
```

## Security model

The database is not queried from the client with anon keys for game data. Next.js API routes (`/api/feature-flags/*`, `/api/players/*`) use the **service role** key on the server.

## Feature flags

Rows live in `feature_flags`. The app reads them via:

- `/api/feature-flags/octopuses`
- `/api/feature-flags/stingrays`

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
