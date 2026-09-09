-- ---------------------------------------------------------------------------
-- Deleting an account, which only an owner can do
-- ---------------------------------------------------------------------------
--
-- Until now an account could be switched off but never removed. "No access"
-- covers most of what a church needs - the Sunday volunteer who has moved
-- away, the treasurer between terms - and it is the right default, because it
-- is reversible and it keeps the name on the roster.
--
-- What it does not cover is the account that should not exist at all. Sign-up
-- is open to anyone who reaches the app, so the roster collects strangers,
-- typos and second attempts by the same person under a misspelt address; and
-- somebody who has lost the phone with their authenticator app on it has no
-- way back in, because nothing in the browser can take a factor off an account
-- (that needs the service role key, and no browser here ever holds one). The
-- answer to all of those is the same: delete the account, and let them sign up
-- again if they should have one.
--
-- Only an owner. Sending somebody back to no access is already limited to
-- owners; this is the same decision with no undo, so it cannot be looser. And
-- never your own account, which is not squeamishness: an owner deleting
-- themselves is how a directory ends up with nobody who can grant a role, the
-- same lockout the Administrators screen already guards against for the last
-- owner. Taken together, those two rules mean there is always at least one
-- active owner left, because the caller is one and the caller is never the
-- account being removed.
--
-- The row in public.profiles is not the account. It is a mirror of one, and
-- deleting it alone would leave the sign-in behind: the person could still
-- sign in, land on "your account is not set up", and never be able to register
-- that email address again. So this deletes the account itself, in auth.users,
-- and the profile follows through the foreign key it was declared with.
--
-- What is deliberately not deleted is anything they wrote. The families,
-- people and directories they entered are the congregation's records, not
-- theirs; updated_by was declared "on delete set null" in 0005 exactly so that
-- removing an account cannot take a single record with it. The photographs
-- likewise - see the line about storage below.
--
-- security definer, because auth.users belongs to Supabase's own auth role and
-- no policy of ours governs it. That makes the checks inside this function the
-- entire boundary, which is why they come first and why the row level security
-- suite tries this as a stranger, a viewer, an editor and an owner.
--
-- Safe to run more than once.

create or replace function public.delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can delete an account.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account. Ask another owner to do it.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'That account no longer exists.'
      using errcode = 'no_data_found';
  end if;

  -- Photographs are uploaded by whoever was at the keyboard, and storage
  -- records that person on the object. Letting the delete reach them would
  -- mean losing every portrait an editor uploaded on the day their account was
  -- tidied away - so the ownership is released first and the files stay
  -- exactly where the directory expects to find them. Storage has spelled that
  -- column differently over the years and has not always let anyone but its
  -- own role write it, so a project where this cannot be done is allowed to
  -- carry on: releasing the photographs is a kindness, and removing an account
  -- that should not exist is the job.
  begin
    update storage.objects set owner = null where owner = p_user_id;
  exception when insufficient_privilege or undefined_table or undefined_column then
    null;
  end;

  delete from auth.users where id = p_user_id;
end;
$$;

comment on function public.delete_account(uuid) is
  'Deletes an administrator account outright, cascading to public.profiles. Owners only, never your own, and never anything the account wrote.';

-- EXECUTE is granted to PUBLIC by default, which would include anon - a
-- signed-out visitor. The checks inside would refuse them, but a function that
-- deletes accounts is not one to leave callable by the internet on the
-- strength of its first line.
revoke all on function public.delete_account(uuid) from public;
grant execute on function public.delete_account(uuid) to authenticated;
