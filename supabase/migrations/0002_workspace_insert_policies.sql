-- Allow first-time setup: authenticated users can create a workspace
-- and add themselves as its owner. (0001 only had SELECT policies.)

create policy "users can create workspaces"
  on public.workspaces for insert
  to authenticated
  with check (true);

create policy "users can add own membership"
  on public.workspace_members for insert
  to authenticated
  with check (user_id = auth.uid());
