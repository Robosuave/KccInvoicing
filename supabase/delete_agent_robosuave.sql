-- Totally delete the robosuave@yahoo.com agent user so they can re-sign up fresh.
-- Run this in the Supabase SQL Editor as the owner.

do $$
declare
  target_user_id uuid;
  target_email text := 'robosuave@yahoo.com';
begin
  -- Find the user ID from auth.users
  select id into target_user_id from auth.users where email = target_email;

  if target_user_id is not null then
    -- Remove from business_members
    delete from public.business_members where user_id = target_user_id;
    -- Remove from workspace_members (if present)
    delete from public.workspace_members where user_id = target_user_id;
    -- Delete the auth account (cascades to auth tables)
    delete from auth.users where id = target_user_id;
    raise notice 'Deleted auth user % (%)', target_email, target_user_id;
  else
    raise notice 'No auth user found for %', target_email;
  end if;

  -- Remove any pending invites for this email
  delete from public.business_invites where lower(email) = lower(target_email);
  raise notice 'Cleared invites for %', target_email;
end
$$;

notify pgrst, 'reload schema';
