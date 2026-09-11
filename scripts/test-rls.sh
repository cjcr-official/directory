#!/usr/bin/env bash
#
# Runs the row level security tests against a throwaway PostgreSQL database.
#
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:rls
#
# The app ships its Supabase anon key inside the browser bundle, so these
# policies are the whole boundary between a stranger and the congregation's
# addresses. This applies the real migration files - not a copy - and then tries
# to break in as an anonymous visitor, a self-signed-up stranger, an editor and
# a viewer, checks that the author stamped on a row is the account that
# actually wrote it rather than the one the caller asked for, and then tries the
# two doors 0006 and 0007 added: a password on an account that also has an
# authenticator app, and deleting somebody else's account.
set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run() {
  psql -v ON_ERROR_STOP=1 -q "$DB_URL" -f "$ROOT/supabase/$1"
}

echo "Applying Supabase stand-ins…"
run tests/00_supabase_stubs.sql

echo "Applying migrations…"
run migrations/0001_initial_schema.sql
run migrations/0002_storage.sql
run migrations/0003_atomic_link_writes.sql
run migrations/0004_office_label.sql
run migrations/0005_updated_by.sql
run migrations/0006_two_step_signin.sql
run migrations/0007_account_deletion.sql
run migrations/0008_gender.sql
run migrations/0009_background_checks.sql
run tests/01_grants.sql

echo "Running row level security tests…"
run tests/02_rls_test.sql
