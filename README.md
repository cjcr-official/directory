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

**Groups.** Tag a family or a person — *Choir*, *Youth Group*, *Deacons* — and
you can print a booklet for just that group later, without picking names again.
Tagging one chorister pulls their whole family into the choir booklet.

**Directories.** A *directory* is a saved recipe for one printable book: who is
in it, and how it looks. Keep a main directory for the whole congregation and as
many small ones as you like for events. The data stays live, so reprinting next
year is one click.

**Printing.** A preview that matches the PDF line for line, then either a
downloaded PDF or a straight browser print. Optional cover page, alphabetical
index, A–Z letter tabs, page numbers, and booklet page ordering for folding and
stapling.

Want to see it? Run the app and open **/sample** — a complete sample directory
built from invented families, with no account and no database.

---

## Setting it up

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

Open the address it prints. The first account to sign up becomes the **owner**;
everyone who signs up after that arrives as a **viewer** until an owner promotes
them. That means you can claim a fresh project without touching a secret key,
and a stranger who finds the URL cannot give themselves access.

### 3. Hosting (Cloudflare)

The build is a folder of static files, so either route works.

**Pages, from GitHub — the easy one.** In the Cloudflare dashboard: *Workers &
Pages → Create → Pages → Connect to Git*, pick this repository, and set

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Every push to your branch redeploys. `public/_redirects` already tells Pages to
serve `index.html` for app routes.

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
single row unless the request carries a signed-in account that has an active
row in `profiles`. Photographs live in a **private** bucket and are served
through short-lived signed URLs. Nothing is readable anonymously, and nothing is
indexed.

Three roles:

| Role | Can do |
| --- | --- |
| **Owner** | Everything, including adding and removing administrators |
| **Editor** | Add and edit people, families, groups and directories |
| **Viewer** | Browse and print; no changes |

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

The important idea is in `src/lib/layout/`. `compose.ts` turns records into a
page model — every box and every line of text placed to the point — and then
**two** renderers consume that same model without changing it: `pdf.ts` writes
it with pdf-lib, and `components/BookPreview.tsx` paints it as HTML. Both
measure text with the same Helvetica metrics, which is why the preview can be
trusted: if a name wraps on screen, it wraps in print.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Typecheck and build into `dist/` |
| `npm run typecheck` | Types only |
| `npm run sample:pdf -- out.pdf` | Render a sample directory, no database needed |
| `npm run seed` | Fill Supabase with demo data |
| `npm run deploy` | Build and push to Cloudflare with Wrangler |

---

## Ideas and next steps

**[docs/IDEAS.md](docs/IDEAS.md)** collects suggestions for making this easy to
run in a real church — a photo day workflow, self-service updates, printing
economics, privacy choices, and what is worth building next.
