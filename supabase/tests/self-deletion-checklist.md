# Required checks for tracker_delete_my_account() before enabling self-service deletion

Requires `supabase/migrations/0003_self_account_deletion.sql` deployed. Use two
real, throwaway accounts created through the extension itself (not the
dashboard), so the check exercises the exact RPC call `background.js` makes.

1. Calling the function while unauthenticated (anon key, no bearer user
   token) fails - `auth.uid()` is null, so the function raises rather than
   deleting anything.
2. A signed-in user calling the function deletes their own row from
   `auth.users`, and that row is confirmed gone (not just soft-marked) via
   the dashboard's Authentication > Users list or a direct query as the
   `postgres` role.
3. That deletion cascades: the account's `tracker_profiles`,
   `tracker_devices`, and `tracker_daily_totals` rows are all gone
   afterward - confirm 0 rows remain in each for that user id.
4. A second, unrelated signed-in account is unaffected: its `auth.users`
   row, profile, devices, and daily totals all still exist after account one
   deletes itself.
5. `analytics_events` is untouched by this function (it has no `user_id`
   column to cascade from) - row count before and after is identical.
6. After deletion, the deleted account's old access token can no longer be
   used for anything (a request with it is rejected as unauthenticated,
   not as "authenticated but empty").
