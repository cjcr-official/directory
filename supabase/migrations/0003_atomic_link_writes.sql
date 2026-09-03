-- ---------------------------------------------------------------------------
-- Replacing a record's groups, and a directory's selection, in one statement
-- ---------------------------------------------------------------------------
--
-- Setting a record's groups was a delete followed by an insert, sent from the
-- browser as two separate requests. Between them the record has no groups at
-- all, and a connection that drops in that gap - a phone on church wifi, which
-- is where this app is used - leaves it that way. The groups are gone, nothing
-- on screen says so, and the next backup records the loss as fact.
--
-- Each function below does both halves in one statement, inside the single
-- transaction a function body already runs in, so either the new set lands or
-- the old one stays.
--
-- security invoker, deliberately and importantly. Every one of these tables is
-- protected by a policy requiring public.is_editor(); a definer function would
-- run with the owner's rights and hand a viewer a way straight past it.
-- Invoker keeps the caller's own rights, so the same policies still decide.
--
-- Safe to run more than once, and safe to run before or after the app that
-- uses it - the app asks for these and falls back to its old two statements
-- when they are not here yet.

create or replace function public.set_household_tags(p_household_id uuid, p_tag_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.household_tags where household_id = p_household_id;

  if p_tag_ids is not null and array_length(p_tag_ids, 1) is not null then
    insert into public.household_tags (household_id, tag_id)
    select p_household_id, tag_id
    from unnest(p_tag_ids) as tag_id
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.set_person_tags(p_person_id uuid, p_tag_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.person_tags where person_id = p_person_id;

  if p_tag_ids is not null and array_length(p_tag_ids, 1) is not null then
    insert into public.person_tags (person_id, tag_id)
    select p_person_id, tag_id
    from unnest(p_tag_ids) as tag_id
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.set_project_tags(p_project_id uuid, p_tag_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.project_tags where project_id = p_project_id;

  if p_tag_ids is not null and array_length(p_tag_ids, 1) is not null then
    insert into public.project_tags (project_id, tag_id)
    select p_project_id, tag_id
    from unnest(p_tag_ids) as tag_id
    on conflict do nothing;
  end if;
end;
$$;

-- The hand-picked selection of a directory. Order matters here, so the entries
-- arrive as a JSON array and keep the position they came in.
create or replace function public.set_project_entries(p_project_id uuid, p_entries jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.project_entries where project_id = p_project_id;

  if p_entries is not null and jsonb_array_length(p_entries) > 0 then
    insert into public.project_entries (project_id, entry_type, ref_id, position)
    select
      p_project_id,
      element ->> 'entry_type',
      (element ->> 'ref_id')::uuid,
      (ordinality - 1)::integer
    from jsonb_array_elements(p_entries) with ordinality as t (element, ordinality)
    on conflict (project_id, entry_type, ref_id) do nothing;
  end if;
end;
$$;

grant execute on function public.set_household_tags(uuid, uuid[]) to authenticated;
grant execute on function public.set_person_tags(uuid, uuid[]) to authenticated;
grant execute on function public.set_project_tags(uuid, uuid[]) to authenticated;
grant execute on function public.set_project_entries(uuid, jsonb) to authenticated;
