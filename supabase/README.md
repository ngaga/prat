# Supabase setup

## Feature flags

Run the migration in your Supabase project:

1. Go to Supabase Dashboard > SQL Editor
2. Execute the contents of `migrations/20250213000000_create_feature_flags.sql`

Or with Supabase CLI: `supabase db push`

### Disable octopuses

```sql
update feature_flags set value = false where key = 'octopuses_enabled';
```

### Enable octopuses

```sql
update feature_flags set value = true where key = 'octopuses_enabled';
```
