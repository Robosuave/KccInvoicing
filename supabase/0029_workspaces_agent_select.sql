-- 0029: let agents SELECT the workspace row of their assigned business.
--
-- Root cause of "Cannot read properties of null (reading 'id')" on agent sign-in:
-- ensureWorkspace() joined business_members -> businesses -> workspaces in one
-- query. Agents could read business_members (self read) and businesses
-- ("businesses member select"), but had NO SELECT policy on workspaces, so the
-- nested workspaces join came back null and refresh() crashed on ws.id.
--
-- This adds a permissive SELECT policy for agents on exactly the workspace(s)
-- holding their assigned business(es). Existing workspace-member policies are
-- untouched (permissive policies OR together). Idempotent: safe to re-run.

drop policy if exists "workspaces agent select" on public.workspaces;
create policy "workspaces agent select" on public.workspaces
  for select to authenticated using (
    public.is_workspace_member(workspaces.id)
    or exists (
      select 1 from public.businesses b
      where b.workspace_id = workspaces.id
        and public.is_business_member(b.id)
    )
  );
