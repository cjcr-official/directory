-- ---------------------------------------------------------------------------
-- How each family's or person's photograph sits in its frame
-- ---------------------------------------------------------------------------
--
-- A directory decides once whether its portraits are cropped to fill the frame
-- or shown whole. That is right for most of a congregation and wrong for the
-- family of five photographed side by side: cropped to a portrait, the two at
-- the ends are cut in half. The office needs to say "show this one whole"
-- about that one photograph without changing the other two hundred.
--
-- Nullable, and null means "as the directory says" - which is every row today
-- and nearly every row afterwards. Only the photographs somebody has looked at
-- and chosen for carry a value. Constrained to the same two words the
-- directory's own setting uses.
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists photo_fit text
    check (photo_fit in ('fill', 'fit'));

alter table public.people
  add column if not exists photo_fit text
    check (photo_fit in ('fill', 'fit'));

comment on column public.households.photo_fit is
  'fill (crop to the frame), fit (show the whole photo), or null to follow the directory.';

comment on column public.people.photo_fit is
  'fill (crop to the frame), fit (show the whole photo), or null to follow the directory.';
