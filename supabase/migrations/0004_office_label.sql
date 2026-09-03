-- ---------------------------------------------------------------------------
-- Telling two families with the same name apart, in the office
-- ---------------------------------------------------------------------------
--
-- A congregation has two Johnston families. The printed card shows a
-- photograph, the members and an address, so a reader can tell them apart -
-- but three screens in the app show a family by its name and nothing else:
-- the family a person belongs to, the Family column on the people list, and
-- the checklist when a directory is hand-picked. In all three, "The Johnston
-- Family" appears twice with no way to know which is which, and the wrong one
-- gets picked.
--
-- This is a short label the office writes for itself - "2", "Tim & Sue",
-- "Elm St", whatever they will recognise. It shows in those three places and
-- nowhere else. It is never printed, never in the PDF, and never in the index:
-- the book is for the congregation, and the congregation does not need the
-- office's filing note.
--
-- Nullable, because almost every family will never need one.
--
-- Safe to run more than once, and safe to run before or after the app that
-- uses it - the app writes it only when the column is there and carries on
-- without it when it is not.

alter table public.households
  add column if not exists office_label text;

comment on column public.households.office_label is
  'Short admin-only label to tell same-named families apart. Never printed.';
