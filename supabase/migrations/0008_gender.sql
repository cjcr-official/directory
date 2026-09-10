-- ---------------------------------------------------------------------------
-- Whether a person is recorded as male or female
-- ---------------------------------------------------------------------------
--
-- A church office keeps this for the ordinary reasons a church office does:
-- the men's breakfast list, who to ask to serve, a name tag that wants to be
-- one colour or another. It has been kept on paper alongside the directory
-- rather than in it, which is the usual sign that a field is missing.
--
-- Nullable, and null is a real answer rather than a gap to be filled in. Most
-- of a directory's fields are optional on purpose - a record with holes in it
-- is normal, and a form that will not save until every box is full is how a
-- directory stops being kept up to date. Nobody is required to say.
--
-- Constrained rather than free text, because the whole value of the column is
-- being able to ask for one group or the other, and "M", "m", "Male" and
-- "male" typed by four volunteers over three years cannot be asked anything.
-- The check is spelt the same way household_role is, for the same reason.
-- ---------------------------------------------------------------------------

alter table public.people
  add column if not exists gender text
    check (gender in ('male', 'female'));

comment on column public.people.gender is
  'male, female, or null where it has not been recorded. Never required.';

-- Asked for as a whole group at a time - every man, every woman - rather than
-- one person at a time, so the index is on the column alone. Partial, because
-- the nulls are never what is being looked for and there is no sense carrying
-- them.
create index if not exists people_gender_idx
  on public.people (gender)
  where gender is not null;
