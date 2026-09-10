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

**What's new.** A directory is kept by more than one person, and everybody's
work lands in the same alphabetical list where it looks like everything else in
it. The bell — in the sidebar on a desk, on the bar on a phone — carries the
number of people who have been added since you last looked, and opens on who
they are, when they arrived and who added them. Your own typing is not counted
back at you.

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
2. Open **SQL Editor** and run the files in `supabase/migrations/`, in order:
   - `0001_initial_schema.sql` — tables, roles and row level security
   - `0002_storage.sql` — the private photo bucket and its policies
   - `0003_atomic_link_writes.sql` — group changes in one statement
   - `0004_office_label.sql` — telling two same-named families apart
   - `0005_updated_by.sql` — who last changed a record
   - `0006_two_step_signin.sql` — an authenticator app, enforced by the database
   - `0007_account_deletion.sql` — letting an owner remove an account outright
   - `0008_gender.sql` — recording whether a person is male or female
3. From **Project Settings → API**, copy the **Project URL** and the
   **anon public** key.

Every one of them is safe to run twice, so re-running after a change is fine.

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

| Role          | Can do                                                             |
| ------------- | ------------------------------------------------------------------ |
| **Owner**     | Everything, including adding, removing and deleting administrators |
| **Editor**    | Add and edit people, families, groups and directories              |
| **Viewer**    | Browse and print; no changes                                       |
| _(no access)_ | A new sign-up, until an owner turns it on                          |

**No access** is the everyday answer for somebody who has stopped helping: it is
reversible, the name stays on the roster, and the role comes back when they do.
**Deleting** an account is for the one that should not exist at all — a stranger
who signed themselves up, a misspelt address, somebody locked out of their own
authenticator app — and only an owner can do it, never to their own account, so
a directory can never be left with nobody able to hand out a role. It removes
the sign-in and nothing else: every family, person and directory that account
entered stays exactly where it is, and so does every photograph it uploaded.

### Signing in with a code as well as a password

Any administrator can add an authenticator app to their own account under
**Settings** — Google Authenticator, Microsoft Authenticator, 1Password, Authy,
whichever they already have — and is then asked for a six-digit code each time
they sign in. It is per account and not per church: one editor can protect their
own sign-in without every Sunday volunteer needing a smartphone.

What makes it worth having is that it is not a screen. The anon key ships in the
browser bundle, so a stolen password can be used against the API directly and
never meet one; `0006_two_step_signin.sql` puts the check inside `is_member()`,
`is_editor()` and `is_owner()` instead, which is where every policy in the
database already asks its question. A session that has only been through a
password reads nothing at all — not a name, not a photograph — on an account
that has an authenticator. An account without one is completely unaffected.

Nobody can lift it for somebody who has lost the phone: taking a factor off
another account needs the service role key, and no browser here ever holds one.
The way back is for an owner to delete the account and for the person to sign up
again.

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
    notifications.ts   who has arrived since a reader last looked
    photos.ts          resize in the browser, upload, signed URLs
    queries.ts         every database read and write
    demo.ts            the invented congregation used by /sample
    mfa.ts             enrolling and answering an authenticator app
    theme.ts           light, dark, or whatever the device asked for
    version.ts         what build this is, and what build is being served
    zoom.ts            holds the app at 1x - no pinch, no double-tap zoom
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

### People and families

A person is created once, on their own record. A family is a grouping laid over
those records: its page lists who is in it, the role each one holds, and the
order they print in, and people are put into it by searching the directory
rather than by being typed in a second time. There is no path that creates a
person as a side effect of filling in a family, so the same person cannot end up
as two records.

A new family has to be saved before it can hold anyone — it needs an id for the
membership to point at. "Create a new person" on a saved family saves the family
first and opens a blank person record already assigned to it; saving that person
returns to the family, ready for the next one.

Membership is applied when the family is saved, the same way groups are. Someone
taken out of a family keeps their record and their address: the family's address
is copied onto them on the way out, or their own card would print with none.

### Photographs

One picture per record, because a record is what prints on a card.

Someone who belongs to a family is pictured by the family portrait — a family
prints once, together, so an individual photo of a member would never appear.
Their edit page shows the family photo and a way through to change it, rather
than an uploader that collects a picture nothing will use. Someone in no family
prints on their own and keeps their own photo, uploader and all.

Moving into a family does not delete a photo taken before: it stays on the
record, unused, and comes back if they later print on their own. `personPhotoPath`
in `lib/format.ts` is the single rule, used by the browse lists and matching what
`lib/layout/compose.ts` puts on the page, so screen and print never disagree
about whose face appears.

### Two families, one surname

They stay two records and never merge. Both file under the surname and then sort
on the head of household's first name, so the Johns come before the Roberts; the
record id breaks any remaining tie, which keeps page numbers stable between two
printings of the same book. The index lists people rather than families, so
"Smith, John" and "Smith, Robert" point at their own pages.

What does not resolve itself is the heading on the card. Two families both named
"The Smith Family" print two cards with the same title. So the suggested name
includes the head as soon as there is one — "The John Smith Family" — the family
form warns while a name is still shared with another family, and the families
list marks the rows involved. The printed name stays editable throughout: plenty
of households are "Maria Alvarez & Sam Choi".

### Staying up to date

Added to the Home Screen the app is suspended rather than closed, so one page
load can stay alive for weeks — long enough to be several deploys behind with
nothing on screen to say so.

Each build stamps the commit it came from into the bundle and into
`/version.json`. `components/UpdateGate.tsx` re-reads that file when the app
comes back to the foreground, when the network returns, and every ten minutes
while it is open. A disagreement means this browser is running an older build:
it shows the updating screen and reloads.

It will not reload over the top of someone's typing. If anything inside a form
has been edited since the last navigation, it shows a bar instead and waits —
for the reload button, or for the navigation that means the record was saved.
Search boxes are not forms and do not hold it back. If two reloads in a row
land on the same old version, it stops trying and leaves the bar up, because a
version behind beats a reload loop.

The running build is printed at the bottom of the sidebar, so "which version
are you on?" has an answer.

### What's new

Two or three people keep a directory between them and rarely at the same desk
on the same afternoon. Somebody typed in on Tuesday used to be four names that
had not been there before, in the middle of four hundred that had — the office
found out at the print run, or when the same person was typed in twice.

What counts as new is a fact about a reader rather than about a row, so each
browser keeps a marker per account: the moment through which that person has
been shown everything. The tray is the difference between the marker and the
rows the app is already holding, which is why none of it costs a request.

Three decisions in `src/lib/notifications.ts` are worth knowing about, and
`npm run notifications:check` holds each of them down:

- **The marker is a `created_at` the database wrote**, never a reading from
  the browser's clock. A phone running four minutes fast would otherwise write
  a marker into the future and mark the next four minutes of arrivals read.
- **A first sight is not an unread pile.** A browser with no marker is seeded
  with the newest record there is, so a new phone opens on an empty tray
  rather than on a badge counting the whole congregation.
- **Your own additions are not news.** There is no `created_by` column, so the
  author is read off `updated_by` — which names the person who added a record
  only while nobody has written it since, and `created_at` still matching
  `updated_at` is what says so. A record you added and somebody else has since
  corrected is announced to you as well, which is the harmless direction to be
  wrong in.

Kept on the device, in `localStorage`, like the theme and the column choices.
Two devices are told twice, which is a smaller wrong than a shared office
computer telling the next person to sign in that their news has been read.

The congregation is fetched once, so a second administrator's afternoon used
to be invisible until somebody reloaded the page — and added to the Home
Screen that page can be a week old. While the app is in front of somebody,
`DirectoryContext` asks the one cheap question there is to ask — has anybody
been added since the newest row we hold — and pulls the whole directory in
again only when the answer is yes.

### Light and dark

**Settings** offers three answers, not two: light, dark, or whatever the device
is set to — which is the one most people want, because a phone that turns itself
dark in the evening should take the app with it. The choice is kept on the
device rather than on the account, since the sign-in screen is drawn before
anybody knows who is looking, and the phone in a pocket and the office desktop
are entitled to different answers.

There is one dark palette in `src/styles/app.css`, keyed to a `data-theme`
attribute, and `src/lib/theme.ts` resolves the three-way preference into one of
two answers before React renders anything. A stylesheet can read
`prefers-color-scheme` perfectly well, but only by carrying the whole palette
twice — once for the people who chose dark and once for the people who chose
nothing — and two copies of thirty colours are two copies that drift.
`npm run contrast:check` measures every pair against both palettes, so a green
lifted far enough to look right on a near-black card cannot quietly be too pale
to read on it.

The printed page is the exception, and deliberately: the preview, the cover and
the QR code that sets up an authenticator keep their white ground in both
themes. A proof is a picture of a sheet of paper, and paper does not have a dark
mode.

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
