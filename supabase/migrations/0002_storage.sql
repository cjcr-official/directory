-- ===========================================================================
-- Church Directory - photo storage
--
-- Member photographs are personal data, so the bucket is PRIVATE. The app
-- reads them with short-lived signed URLs created for the signed-in
-- administrator; nothing is served to the open internet.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'directory-photos',
  'directory-photos',
  false,
  10485760,                                  -- 10 MB ceiling; the app resizes to ~200 KB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Any active administrator may view a photo; only editors and owners may add,
-- replace, or remove one.
drop policy if exists directory_photos_read on storage.objects;
create policy directory_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'directory-photos' and public.is_member());

drop policy if exists directory_photos_insert on storage.objects;
create policy directory_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'directory-photos' and public.is_editor());

drop policy if exists directory_photos_update on storage.objects;
create policy directory_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'directory-photos' and public.is_editor())
  with check (bucket_id = 'directory-photos' and public.is_editor());

drop policy if exists directory_photos_delete on storage.objects;
create policy directory_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'directory-photos' and public.is_editor());
