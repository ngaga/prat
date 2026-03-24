-- Ghost mode progress (same persistence pattern as exp / level)
alter table players add column if not exists is_ghost boolean not null default false;
alter table players add column if not exists ghost_prats_captured integer not null default 0;
