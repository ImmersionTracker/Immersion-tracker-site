-- Lets a signed-in user delete their own account without the extension ever
-- holding a service-role key. Deleting a row from auth.users normally
-- requires elevated privileges the anon/authenticated roles don't have, so
-- this wraps it in a `security definer` function: the function runs with its
-- owner's privileges, but the body only ever deletes auth.uid() - the
-- caller's own id - so there is no argument an authenticated client could
-- pass to delete someone else's account.
--
-- tracker_profiles, tracker_devices, and tracker_daily_totals all reference
-- auth.users(id) on delete cascade (see 0001_cloud_foundation.sql), so this
-- one delete also removes every row this account ever wrote in those tables.
-- analytics_events (0002) has no user_id column at all and is unaffected.

begin;

create or replace function public.tracker_delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.tracker_delete_my_account() from public, anon;
grant execute on function public.tracker_delete_my_account() to authenticated;

commit;
