-- Supabase grants table privileges to anon/authenticated by default; row level
-- security is what actually decides who sees what. Reproduce those grants so
-- the tests exercise the policies rather than plain table permissions.
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
