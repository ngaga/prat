-- Feature flags table for runtime configuration
create table if not exists feature_flags (
  key text primary key,
  value boolean not null default true
);

-- Enable public read access (no auth required for flags)
alter table feature_flags enable row level security;

create policy "Allow public read" on feature_flags
  for select using (true);

-- Insert default: octopuses enabled
insert into feature_flags (key, value) values ('octopuses_enabled', true)
  on conflict (key) do nothing;
