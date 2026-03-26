-- If an earlier revision of 20250326120000_game_sessions.sql created these columns, drop them.
alter table game_sessions drop column if exists ip_address;
alter table game_sessions drop column if exists user_agent;
alter table game_sessions drop column if exists total_duration_seconds;
