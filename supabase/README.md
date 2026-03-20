# Supabase setup

## Environment variables

Add to `.env.local`:

- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for API routes, never exposed to client)

## Migrations

Run the migration:

1. Go to Supabase Dashboard > SQL Editor
2. Execute the contents of `migrations/20250213000000_init.sql`

Or with Supabase CLI: `supabase db push`

## Access

Database access is restricted: only the service role can read/write. The game uses API routes (`/api/feature-flags/*`, `/api/players/*`) that run server-side with the service role key.

## Feature flags

Keys live in table `feature_flags`. The game reads them via API routes (`/api/feature-flags/octopuses`, `/api/feature-flags/stingrays`). The authoritative game server (`gameEngine`) polls the same keys so spawns stay in sync.

### Octopuses (`octopuses_enabled`)

```sql
update feature_flags set value = false where key = 'octopuses_enabled';
-- enable:
update feature_flags set value = true where key = 'octopuses_enabled';
```

### Stingrays (`stingrays_enabled`)

```sql
update feature_flags set value = false where key = 'stingrays_enabled';
-- enable:
update feature_flags set value = true where key = 'stingrays_enabled';
```

Run migration `20250213120000_stingrays_feature_flag.sql` if the `stingrays_enabled` row is missing.
