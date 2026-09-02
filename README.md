# Church Directory

A directory app for a congregation: keep people and families in one place, then
print an alphabetical book — landscape paper, folded down the middle, **three
records on each half, six families to a sheet**.

- **Database** — Supabase (Postgres, Auth and file storage)
- **Web app** — a static React app, hosted on Cloudflare
- **Backend definition** — the SQL that builds the database lives in this repo,
  under `supabase/migrations/`, so the whole thing is versioned in GitHub

There is no server of your own to run or pay for. The app talks to Supabase
directly from the browser, and the PDF is built in the browser too — so member
photographs never pass through a third machine.

---

## What it does

**People and families.** First and last name, email, phone, photograph, and
optionally a date of birth, an anniversary and an address. People can be grouped
into a family, which then prints as one card with everyone listed on it. A person
who is not in a family gets their own card.

**Groups.** Tag a family or a person — _Choir_, _Youth Group_, _Deacons_ — and
you can print a booklet for just that group later, without picking names again.
Tagging one chorister pulls their whole family into the choir booklet.

**Directories.** A _directory_ is a saved recipe for one printable book: who is
in it, and how it looks. Keep a main directory for the whole congregation and as
many small ones as you like for events. The data stays live, so reprinting next
year is one click.

**Backups.** One button downloads the whole directory as a ZIP: the records as
CSVs that open in any spreadsheet, every photograph as an ordinary JPEG, and a
`directory.json` complete enough to rebuild from. Editors can delete a family and
there is no undo, so this is what turns a bad click into an annoyance. Once a
month, and again before a print run.

**Printing.** A preview that matches the PDF line for line, then either a
downloaded PDF or a straight browser print. Optional cover page, alphabetical
index, A–Z letter tabs, page numbers, and booklet page ordering for folding and
stapling.

Want to see it? Run the app and open **/sample** — a complete sample directory
built from invented families, with no account and no database.

---

## Setting it up

**[docs/DEPLOY.md](docs/DEPLOY.md) is the step-by-step version** — Supabase,
Cloudflare, and the check that proves a stranger cannot read your congregation's
addresses. What follows is the short form.

### 1. The database (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the two files in `supabase/migrations/`, in
   order:
   - `0001_initial_schema.sql` — tables, roles and row level security
   - `0002_storage.sql` — the private photo bucket and its policies
3. From **Project Settings → API**, copy the **Project URL** and the
   **anon public** key.

Both files are safe to run twice, so re-running after a change is fine.

### 2. The app (locally)

```bash
npm install
cp .env.example .env.local     # then paste in your two values
npm run dev
```

Before deploying, run `npm run verify`. It connects with the anon key — the same
key the browser gets — and reports whether the schema is in place and whether a
stranger can read anything. Do not go live until it passes.

Open the address it prints. The first account to sign up becomes the **owner**,
so you can claim a fresh project without touching a secret key.

Every account created after that starts with **no access at all** — it can sign
in and see nothing until an owner grants it a role under _Administrators_. Sign-up
is open to anyone who reaches the app, so this is the line that keeps the
congregation's details private.

### 3. Hosting (Cloudflare)

The build is a folder of static files, so either route works.

**Pages, from GitHub — the easy one.** In the Cloudflare dashboard: _Workers &
Pages → Create → Pages → Connect to Git_, pick this repository, and set

| Setting               | Value                                         |
| --------------------- | --------------------------------------------- |
| Build command         | `npm run build`                               |
| Output directory      | `dist`                                        |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Every push to your branch redeploys. Turn on the project's Single Page
Application setting so a refresh on `/families` does not 404 — the Workers route
gets that from `wrangler.jsonc` instead.

**Or from your machine:**

```bash
npx wrangler login
npm run deploy
```

> The two `VITE_` values are read **at build time** and baked into the bundle.
> After changing them in Cloudflare, trigger a fresh deploy.

### 4. Something to look at (optional)

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
npm run seed
```

Fills the database with an invented congregation and two directories. Add
`--clear` to wipe first. The service role key bypasses row level security — run
this from your own machine, and never put it in `.env.local` or Cloudflare.

---

## Is the data safe?

The anon key ships inside the browser bundle. That is how Supabase is designed
to work, and it is not what protects anything.

What protects the congregation's details is **row level security**, defined in
`supabase/migrations/0001_initial_schema.sql`. Every table refuses to return a
single row unless the request carries a signed-in account that has an _active_
row in `profiles` — and new sign-ups are created inactive, so having an account
is not the same as having access. Photographs live in a **private** bucket and
are served through short-lived signed URLs. Nothing is readable anonymously, and
nothing is indexed.

These policies are tested, not just written. `npm run test:rls` applies the
real migration files to a throwaway PostgreSQL database and then tries to break
in — as an anonymous visitor, as a stranger who signed themselves up, and as an
editor trying to promote themselves. CI runs it on every push. If you change a
policy, run it.

```bash
# needs a local postgres, or point DATABASE_URL at any throwaway database
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:rls
```

The browser side is locked down too: a Content Security Policy in `index.html`
allows scripts only from the app itself and network calls only to Supabase, and
`public/_headers` adds the header-only pieces on Cloudflare.

Three roles:

| Role          | Can do                                                   |
| ------------- | -------------------------------------------------------- |
| **Owner**     | Everything, including adding and removing administrators |
| **Editor**    | Add and edit people, families, groups and directories    |
| **Viewer**    | Browse and print; no changes                             |
| _(no access)_ | A new sign-up, until an owner turns it on                |

---

## The printed format

One sheet of landscape paper, folded down the middle, makes four book pages when
printed double-sided. Each half-page carries three records, so:

```
        one sheet of Letter paper, landscape
  ┌──────────────────────┬──────────────────────┐
  │  The Abernathy Family│  The Caldwell Family │
  ├──────────────────────┼──────────────────────┤
  │  The Alvarez Family  │  The Chen Family     │   3 records per half
  ├──────────────────────┼──────────────────────┤   × 2 halves
  │  Marcus Bennett      │  The Delgado Family  │   = 6 records per sheet
  └──────────────────────┴──────────────────────┘
                    fold here
```

Everything about that is adjustable per directory — records per half, halves per
sheet, paper size, text size, and which details each card shows.

See **[docs/PRINTING.md](docs/PRINTING.md)** for how to actually get it out of a
printer, including booklet folding.

---

## How it is put together

```
supabase/migrations/   the database: tables, roles, row level security, storage
src/
  lib/
    layout/
      settings.ts      what a directory looks like, and its defaults
      metrics.ts       Helvetica text measurement + word wrapping
      compose.ts       records -> positioned pages (the layout engine)
      pdf.ts           draws the composed pages with pdf-lib
    entries.ts         families + individuals -> one alphabetical list
    format.ts          names, phones, dates, addresses, sort keys
    photos.ts          resize in the browser, upload, signed URLs
    queries.ts         every database read and write
    demo.ts            the invented congregation used by /sample
  components/          shared UI, and the preview renderer
  pages/               one file per screen
scripts/
  sample-book.ts       render a sample PDF from the command line
  seed.ts              fill a Supabase project with demo data
```

Formatting is Prettier, checked in CI (`npm run format`). There is no ESLint
yet: `typescript-eslint` still caps at TypeScript 5, and this project is on the
TypeScript 7 compiler. The strict compiler flags — `strict`, `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch` — cover much of the same
ground in the meantime.

The important idea is in `src/lib/layout/`. `compose.ts` turns records into a
page model — every box and every line of text placed to the point — and then
**two** renderers consume that same model without changing it: `pdf.ts` writes
it with pdf-lib, and `components/BookPreview.tsx` paints it as HTML. Both
measure text with the same Helvetica metrics, which is why the preview can be
trusted: if a name wraps on screen, it wraps in print.

### Commands

| Command                         | What it does                                   |
| ------------------------------- | ---------------------------------------------- |
| `npm run dev`                   | Local dev server                               |
| `npm run build`                 | Typecheck and build into `dist/`               |
| `npm run typecheck`             | Types only                                     |
| `npm run test:rls`              | Prove the database policies keep strangers out |
| `npm run sample:pdf -- out.pdf` | Render a sample directory, no database needed  |
| `npm run seed`                  | Fill Supabase with demo data                   |
| `npm run deploy`                | Build and push to Cloudflare with Wrangler     |

---

## Ideas and next steps

**[docs/IDEAS.md](docs/IDEAS.md)** collects suggestions for making this easy to
run in a real church — a photo day workflow, self-service updates, printing
economics, privacy choices, and what is worth building next.
