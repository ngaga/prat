-- Lifetime prat captures (same persistence pattern as kills_octopus / kills_stingray)
alter table players add column if not exists prats_captured_total integer not null default 0;
