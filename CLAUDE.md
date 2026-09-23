# Working on this repository

## Ship the whole way, every time

A change is not finished when it is pushed, and not finished when a pull
request is open. It is finished when it is running on the live site.

So the loop is always: branch, commit, push, open a pull request, merge it,
let the deploy run, and confirm the deploy actually landed. Do not stop at the
pull request and wait to be asked - the ask is standing.

The one thing that still needs a person is a destructive or irreversible
change: a database migration that drops or rewrites data, a secret rotation,
anything that cannot be undone by deploying the previous commit. Say so and
wait. Everything else goes all the way out.

## How a change reaches the site

`.github/workflows/deploy.yml` deploys to Cloudflare on a push to `main`, and
on nothing else. A commit sitting on a branch - or in an open pull request -
is invisible to anyone using the app, however green its checks are. Merging is
what deploys.

The whole run takes about forty seconds.

## Confirm the deploy, do not assume it

The deploy job **succeeds without deploying** when the Cloudflare and Supabase
secrets are missing: the `Check the deploy secrets are set` step quietly sets
`ready=false` and the Build and Deploy steps are skipped. A green tick on the
workflow therefore does not mean the site changed.

Check the job's steps and confirm `Deploy to Cloudflare` actually ran.

To undo a bad deploy, revert the commit on `main` and let the deploy run
again. There is no separate rollback.

## Before pushing

CI runs formatting, types, the build, a real render of the sample book, the
layout, restore, batching, name and contrast checks, the bundle-size budget,
and the row level security suite. Run the same
things locally first:

```
npm run format:check
npm run typecheck
npm run build
npm run sample:pdf -- /tmp/sample.pdf
npm run checks
npm run bundle:check
```

`checks` is the layout invariants, the restore decisions, backup coverage,
request batching, name matching and colour contrast — all pure, all fast, none
of them needing a database or a browser.

Prettier is not advisory - `format:check` fails the build, and it also fails
the deploy.

History on `main` is linear. Squash when merging.

## Verify in the real app

This app is used on phones, and most of what has gone wrong in it went wrong
at 393px or on iOS specifically. Where a change is something a person would
see or touch, drive the built app in a browser and check the actual behaviour
rather than reasoning about the CSS. `/sample` renders a full directory from
invented data and needs no database, so it is the cheapest page to test on.

## A migration is not applied by merging it

A file in `supabase/migrations/` is SQL sitting in a repository the church
office cannot run. Deploying does not apply it. Somebody has to open the
Supabase dashboard, go to the SQL editor, paste it in and press Run - and
until they do, the screen that needs it is broken in a way the deploy cannot
explain.

So when a change needs one, print the whole of the SQL in the reply, in plain
text, in the order it has to run, as well as committing the file. Do not link
to it, summarise it or say which file it is in: paste it, and say what stays
broken until it has been run. Every time.

## A change to the data is a change to the backup

Whenever a change adds, removes or renames a table or a column, saves
photographs somewhere new, or adds a directory setting that points at
artwork, update the backup in the same pull request. Don't leave it for later
or wait to be asked. A backup that quietly misses the new thing is found out
on the day a restore is needed, which is the worst possible day.

`npm run backup:check`, part of `checks`, reads the migrations and fails
until each new table, column, photo folder and artwork setting is covered or
is written down in `src/lib/backupSpec.ts` as left out on purpose. Passing it
is the minimum. The work is:

- **A new table of directory data:** add it to `DIRECTORY_TABLES`. Read it
  into `directory.json` in `src/lib/backup.ts`, read it back in
  `src/lib/restorePlan.ts`, decide in `selectRows` what "add back what is
  missing" does with it, write it in `src/lib/restore.ts`, and add it to
  `replace_directory` in a new migration. A table that isn't directory data
  goes in `OUTSIDE_BACKUP` with the reason.
- **A new column on families or people:** add it to `FAMILY_COLUMNS` or
  `PERSON_COLUMNS` so it's in the spreadsheet, or to `NOT_IN_SPREADSHEET`
  with the reason. `directory.json` and the restore pick it up by themselves,
  but give it a readable name in `FIELD_NAMES` in `restorePlan.ts` so the
  list of edited records says what changed.
- **A column on any other directory table:** check that restore and
  `replace_directory` still write it. They copy whole rows, so they usually
  do.
- **A new place photographs are saved:** add the folder to `PHOTO_FOLDERS` in
  `src/lib/photoFolders.ts`. A new setting that points at artwork goes in
  `COVER_PATH_KEYS`.
- **A new migration:** it goes in the list in `scripts/test-rls.sh` and the two
  lists in `README.md` and `docs/DEPLOY.md`.

Then add restore checks in `scripts/restore-check.ts` for the new data coming
back, and say in the pull request what the backup now covers.
