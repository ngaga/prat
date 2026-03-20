insert into feature_flags (key, value) values ('stingrays_enabled', true)
  on conflict (key) do nothing;
