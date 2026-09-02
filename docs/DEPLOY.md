# Going live

Two accounts, both free to start: Supabase holds the data, Cloudflare serves the
app. About half an hour, once.

Work through it in order — the app cannot be deployed usefully until the
database exists.

---

## 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and create a project. Any
   region near your church is fine. **Save the database password somewhere
   safe** — it is shown once.
2. Wait for the project to finish provisioning (a minute or two).
3. Open **SQL Editor** in the sidebar, then **New query**.
4. Paste the entire contents of `supabase/migrations/0001_initial_schema.sql`
   and run it. It should report success with no rows.
5. New query again. Paste `supabase/migrations/0002_storage.sql` and run it.

Both files are safe to run twice, so if you are unsure whether one took, run it
again.

> **What these do.** The first creates the tables and — more importantly — the
> row level security policies that stop anyone reading the directory without an
> account. The second creates the private bucket the photographs live in.

---

## 2. Get your two keys

**Project Settings → API**, and copy:

| Field           | Goes by                  |
| --------------- | ------------------------ |
| **Project URL** | `VITE_SUPABASE_URL`      |
| **anon public** | `VITE_SUPABASE_ANON_KEY` |

There is a third key on that page, **service_role**. Never put it in this app,
in `.env.local`, in GitHub, or in Cloudflare. It bypasses every security policy
in step 1. It is only for `npm run seed`, run from your own machine.

---

## 3. Check it before you deploy

On your own computer:

```bash
git clone https://github.com/cjcr-official/directory
cd directory
npm install
cp .env.example .env.local     # paste the two values into it
npm run verify
```

`npm run verify` connects with the anon key — the same key the browser gets — and
tells you whether the tables exist and, crucially, whether a stranger can read
your congregation's addresses. Do not deploy until it says so:

```
[  ok  ] Row level security blocks anonymous reads
         A stranger sees nothing.

Everything checks out. You are ready to deploy.
```

Want to see the app first? `npm run dev` and open the address it prints.

---

## 4. Put it on Cloudflare

Either route works. The first needs no command line.

### Route A — connect the repository (easiest)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Pick this repository and the `main` branch.
3. Build settings:

   | Setting                | Value           |
   | ---------------------- | --------------- |
   | Framework preset       | None            |
   | Build command          | `npm run build` |
   | Build output directory | `dist`          |

4. Add two environment variables, for **Production** and **Preview** both:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Save and deploy.

Every push to `main` redeploys, and `public/_headers` sets the security headers.

One extra step on this route: Pages does not fall back to `index.html` on its
own, so refreshing a page like `/families` would 404. In the project's
**Settings → Build → Single Page Application**, turn the SPA fallback on. (The
Actions route below needs nothing — `wrangler.jsonc` already declares it.)

### Route B — GitHub Actions

`.github/workflows/deploy.yml` deploys on every push to `main`, but only after
formatting, types and the layout engine pass. Add four repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret                   | Where it comes from                                                         |
| ------------------------ | --------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase → Settings → API                                                   |
| `VITE_SUPABASE_ANON_KEY` | Same page, the "anon public" key                                            |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare dashboard sidebar                                                |

Without them the job skips rather than deploying an app pointed at nothing.

> The two `VITE_` values are read **at build time** and baked into the bundle.
> After changing either, trigger a fresh deploy — editing the variable alone
> changes nothing.

---

## 5. Claim it, and prove it is locked

1. Open your new address. You should see the sign-in screen.
2. Choose **Create the first account**. This one becomes the **owner**.
3. Add a family, so there is something to protect.
4. **Now the check that matters.** In a private window, create a second account
   with a different email. It should sign in and see _nothing_ — a "waiting for
   access" screen, no names, no addresses.
5. Back as the owner, open **Administrators**. The second account is listed with
   no access. Grant it a role, or leave it.

If step 4 shows any directory data, stop and re-run
`supabase/migrations/0001_initial_schema.sql`.

---

## 6. Before the first print run

- Take a backup (**Backup** in the sidebar) and put it somewhere that is not
  Supabase.
- Decide what goes in the printed book. Home addresses and children's birthdays
  are useful _and_ are what gets photographed and passed around. See
  [IDEAS.md](IDEAS.md).
- Read [PRINTING.md](PRINTING.md) before sending anything to a printer,
  especially if you are folding it into a booklet.

---

## If something is wrong

**"Connect your database" instead of a sign-in screen** — the two `VITE_`
variables were not set at build time. Set them and redeploy.

**A route 404s on refresh** — the single-page-app fallback is off. On the
Actions route that comes from `not_found_handling` in `wrangler.jsonc`; on the
Pages route it is a setting in the project's build configuration.

**Sign-in works but every screen is empty** — expected for a new account that has
not been granted a role. Sign in as the owner and check Administrators.

**`npm run verify` cannot reach the project** — `VITE_SUPABASE_URL` should be the
Project URL (`https://something.supabase.co`), not the database connection
string.
