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
layout and restore checks, and the row level security suite. Run the same
things locally first:

```
npm run format:check
npm run typecheck
npm run build
npm run sample:pdf -- /tmp/sample.pdf
npm run invariants
npm run restore:check
```

Prettier is not advisory - `format:check` fails the build, and it also fails
the deploy.

History on `main` is linear. Squash when merging.

## Verify in the real app

This app is used on phones, and most of what has gone wrong in it went wrong
at 393px or on iOS specifically. Where a change is something a person would
see or touch, drive the built app in a browser and check the actual behaviour
rather than reasoning about the CSS. `/sample` renders a full directory from
invented data and needs no database, so it is the cheapest page to test on.
