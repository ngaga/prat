-- Independent toggle for stingrays (raies), same pattern as octopuses_enabled.
-- Idempotent: dashboards or DBs that never ran 20250213120000_stingrays_feature_flag.sql get the row.
insert into feature_flags (key, value) values ('stingrays_enabled', true)
  on conflict (key) do nothing;
