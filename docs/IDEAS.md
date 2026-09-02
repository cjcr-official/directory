# Ideas and suggestions

You asked for ideas to make this very easy to use. Some are already built —
they are marked — and the rest are ordered by how much they tend to matter in a
real church.

---

## What is already in, and why

**A family is the unit, not a person.** Most church directories are read by
household: you look up the Alvarezes, not Maria. So a family is one card with
everyone listed on it, and a person who is not in a family gets their own card.
Both sort into one alphabetical run by surname, which is what someone flipping
through expects.

**People are made once; a family groups them.** Every person is created on
their own record, with the full form — photo, address, birthday, groups. A
family is a container you then put those people into: its page lists who is in
it, in what order they print, and what each one is to the household. Adding
someone is a search over the directory, not a second place to type a name, so
one person can never end up as two records who happen to share a spelling.

Building a family from scratch is still one screen: create the family, then
"Create a new person" saves it and opens a blank record already inside it, and
saving that person brings you straight back for the next one.

**Only the surname is required.** Everything else — photo, address, phone,
birthday, anniversary — is optional. A directory with gaps is normal; a form
that refuses to save until you find someone's ZIP code is how a project dies.

**Typing a surname fills in the family name.** "Alvarez" suggests "The Alvarez
Family" until you edit it yourself, at which point it stops guessing. If that
name is already taken by another family, the form says so and offers the
head-qualified version — "The Maria Alvarez Family" — in one tap.

**"Goes by".** William prints as Bill without losing the legal first name.

**Groups instead of separate lists.** Tag someone _Choir_ once. An event
directory then says "everyone in the Choir group" and stays correct forever —
add a new chorister in March and the April booklet includes them. Tagging one
member pulls in their whole family, which is almost always what you meant.

**A preview you can trust.** The screen and the PDF are drawn from the very same
layout, measured with the same font metrics. If a name wraps on screen, it wraps
in print. No "download, look, adjust, download again".

**A sample with no account.** `/sample` shows a complete invented directory. Take
it to a committee meeting before anyone types in a real address.

**Photos shrink on the way in.** A phone photo is 4–8 MB and prints at 1.7
inches wide. The browser resizes before uploading, so uploads finish on church
hall wifi and a 200-family PDF builds in seconds.

**A backup you can actually read.** One file, holding spreadsheets, the
photographs as plain JPEGs, and a complete JSON copy. Nothing about restoring it
depends on this app still existing.

**First sign-up owns it.** No secret key, no seeding an admin row by hand — and
the second person to sign up lands as a viewer, so a stranger who finds the URL
cannot promote themselves.

---

## Worth building next

### 1. A photo day workflow

This is where directory projects actually stall. Someone takes 200 photos on a
Sunday and then has to attach each one to the right family.

Build a screen that takes a folder drop, shows each photo beside a search box,
and lets you type three letters of a surname and hit Enter. Two seconds per
photo instead of thirty.

A companion trick: a printed sign-up sheet with a number beside each family, and
you photograph the number card before each family. Then the filenames sort
themselves.

### 2. Let families check their own entry

The information is always slightly wrong, and the person who knows is the
family. A read-only link per family — no login, a long random token, expires
after a month — with an "everything here is right" button and a comment box.
Email it once before print day and half your corrections arrive on their own.

Keep it a _suggestion_, not a direct edit. An administrator approves it. That
way a stale link can never quietly change the book.

### 3. Import from a spreadsheet

Most churches already have a list. A CSV import that maps columns and shows a
preview of what it will create would remove the single biggest reason not to
start. Handle the awkward part properly: rows that share an address should be
offered as one family.

### 4. Print-day extras

- **Birthday and anniversary lists.** You already collect the dates. A one-page
  month-by-month list is the single most requested extra in a church office.
- **A phone-and-email-only list.** Two columns, no photos, four to a page.
  Cheap to print, and the thing people actually pin up.
- **Mailing labels.** Avery 5160 from the same addresses.
- **A blank line at the end of each card.** For handwritten corrections. People
  love this.

### 5. Small quality-of-life wins

- **Duplicate detection** when adding a person who already exists.
- **Archive rather than delete** — already in the data model as _include in
  printed directories_; give it a proper "left the church" reason and a way to
  browse the archive.
- **Undo after save.** Or at least "changed last Tuesday by Anne", which
  matters when three people share the work.
- **Keyboard shortcuts** on the list screens: `/` to search, `n` for new.
- **A "what changed since we last printed" report.** Makes the case for a
  reprint by itself.

---

## Things worth deciding before you print

**How much detail goes in the book?** Every directory is a small privacy
decision. A book with home addresses and children's birthdays is genuinely
useful and also the thing people photograph and text around. Some suggestions:

- Ask once, at sign-up: _may we print your address? your photograph?_ Store it
  as a per-family setting and honour it. (Not built yet — worth adding before a
  first full print run.)
- Consider leaving children's birthdays out of the printed book but keeping them
  in the database for the office birthday list.
- Print a line on the cover or footer: _for church use only, please do not
  reproduce_. The footer field is there for exactly this.

**Who can see what.** Editors can see everything. If you want a volunteer to help
with data entry but not see everyone's address, that needs a fourth role — worth
adding if it comes up, but do not build it speculatively.

**Backups.** Built — see _Backup_ in the app. Supabase keeps its own, but a
monthly file you can hold onto is worth more than a restore procedure you have
never run. Keep it somewhere other than the database.

---

## Running it in practice

**One person owns the data, several can edit.** Give the editor role to whoever
answers the phone in the office — they hear about a move before anyone else.

**Reprint on a schedule, not on demand.** Twice a year is plenty. The directory
being slightly out of date is normal; a rolling "print it again" request is how
the job becomes a chore.

**Keep a directory called "Main" and never delete it.** Change its cover
subtitle each time — _Spring 2026_, _Spring 2027_ — and you have a consistent
book year to year.

**Small booklets are the real win.** The main directory is printed twice a year.
A choir list, a deacons list, a mission trip roster — those get printed monthly,
and they take about a minute each once the groups exist.
