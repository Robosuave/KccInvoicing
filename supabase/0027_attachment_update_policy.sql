-- 0027_attachment_update_policy.sql
-- The app uploads timesheets with upsert:true, which issues an UPDATE when the
-- object already exists (Replace flow, or a retry after an interrupted upload).
-- The bucket had INSERT/SELECT/DELETE policies but no UPDATE policy, so those
-- updates were denied. Safe to re-run (DROP IF EXISTS guard).

drop policy if exists "attachments member update" on storage.objects;
create policy "attachments member update"
  on storage.objects for update to authenticated
  using (bucket_id = 'invoice-attachments'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'invoice-attachments'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
