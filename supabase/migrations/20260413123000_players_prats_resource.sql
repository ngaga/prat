-- Persist spendable projectile resource so reconnect keeps progression.
alter table players add column if not exists prats integer not null default 0;
