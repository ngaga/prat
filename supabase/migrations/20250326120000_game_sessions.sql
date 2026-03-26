-- Per-play sessions (analytics): start/end, IP, user agent, deltas for the session
create table if not exists game_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id),
  started_at timestamptz default now(),
  ended_at timestamptz,
  ip_address inet,
  user_agent text,
  total_duration_seconds integer,
  actions_count integer default 0,
  exp_gained integer default 0,
  kills_octopus integer default 0,
  kills_stingray integer default 0,
  ghost_prats_captured integer default 0,
  disconnected_unexpectedly boolean default false
);

alter table game_sessions enable row level security;

create index if not exists game_sessions_player_id_started_at_idx
  on game_sessions (player_id, started_at desc);
