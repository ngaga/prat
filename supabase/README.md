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

Modify via Supabase Dashboard (SQL Editor) or Dashboard table editor:

### Disable octopuses

```sql
update feature_flags set value = false where key = 'octopuses_enabled';
```

### Enable octopuses

```sql
update feature_flags set value = true where key = 'octopuses_enabled';
```
