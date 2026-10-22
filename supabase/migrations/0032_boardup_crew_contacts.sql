-- 0032: board-up crew contacts (Aquick).
--
-- Each crew member gets a saved phone number and email address. The Aquick
-- job form auto-fills "Text to" / "Email to" when a crew member is picked,
-- and the job PDF prints the owner's contact block at the end.
--
-- Editable by the workspace owner and by Dan (4831104x@gmail.com), who is
-- master on Aquick alongside the owner. Readable by anyone who can access
-- the business (the form needs it for the crew picker + auto-fill).

create table if not exists public.boardup_crew (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

alter table public.boardup_crew enable row level security;

-- Owner of the workspace, or Dan on a business he can access, may manage
-- crew contacts. (plpgsql so SECURITY DEFINER is honored; see 0012.)
create or replace function public.can_manage_boardup_crew(b_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w_id uuid;
  u_email text := lower(auth.jwt() ->> 'email');
begin
  select b.workspace_id into w_id from public.businesses b where b.id = b_id;
  if w_id is null then return false; end if;
  if public.is_workspace_owner(w_id) then return true; end if;
  if u_email = '4831104x@gmail.com' and public.can_access_business(b_id) then
    return true;
  end if;
  return false;
end;
$$;

drop policy if exists "boardup_crew read" on public.boardup_crew;
create policy "boardup_crew read"
  on public.boardup_crew for select
  using (public.can_access_business(business_id));

drop policy if exists "boardup_crew manage" on public.boardup_crew;
create policy "boardup_crew manage"
  on public.boardup_crew for all
  using (public.can_manage_boardup_crew(business_id))
  with check (public.can_manage_boardup_crew(business_id));

-- Seed the current crew names for Aquick Board-up (phone/email are filled in
-- the app's crew editor). Dan's email is known, so prefill it: it's the
-- default "Email to" address on new jobs.
insert into public.boardup_crew (business_id, name, phone, email, sort_order)
select b.id, n.name, '', n.email, n.ord
from public.businesses b
cross join (values
  ('Rob', '', 1),
  ('Dan', '4831104x@gmail.com', 2),
  ('Dale', '', 3)
) as n(name, email, ord)
where b.display_name = 'Aquick Board-up'
  and not exists (
    select 1 from public.boardup_crew c
    where c.business_id = b.id and c.name = n.name
  );

notify pgrst, 'reload schema';
