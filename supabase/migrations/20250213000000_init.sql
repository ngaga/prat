-- Feature flags table for runtime configuration
create table if not exists feature_flags (
  key text primary key,
  value boolean not null default true
);

alter table feature_flags enable row level security;

insert into feature_flags (key, value) values ('octopuses_enabled', true)
  on conflict (key) do nothing;

-- Players table for persistent level and experience
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  exp integer not null default 0,
  level integer not null default 1,
  kills_octopus integer not null default 0,
  kills_stingray integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table players enable row level security;
