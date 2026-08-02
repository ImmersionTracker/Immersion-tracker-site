# Required RLS checks before deployment

Use two unrelated authenticated test users, A and B. Do not test only with the Supabase dashboard service role because it bypasses row-level security.

Requires a deployed development Supabase project running `supabase/migrations/0001_cloud_foundation.sql` - this checklist cannot be completed against the undeployed draft, and isn't run by `npm test`. Two things about it *are* covered automatically, though, and re-verified on every test run: `npm run test:foundation` statically checks that `lib/supabase-rest.js`'s upload/device request builders target the exact same primary-key columns as the migration (protects item 6 and 8 from silent client/schema drift) and that every uploaded row is always stamped with the caller's own session `user_id` (protects item 2 from a client-side bug, though RLS is the real backstop). Everything below still needs a real run against two live test accounts before cloud sync ships to real users.

1. User A can select only A's profile, devices, and current-generation daily rows.
2. User B cannot select, insert, update, or delete any row owned by A.
3. The anon role cannot read or modify any tracker table.
4. An authenticated client cannot change `plan`, `pro_expires_at`, `entitlement_version`, or `data_generation` directly.
5. A daily row is rejected unless its device belongs to the same user, is enabled, and has the current generation.
6. Retrying the same primary key (via the real upload-queue drain path, `TrackerSupabaseRest.buildUpsertDailyTotalsRequest`) replaces the snapshot rather than adding seconds.
7. Calling `tracker_reset_my_data()` deletes old totals and increments the generation.
8. A device using the old generation cannot upload old rows after a reset - confirm this both directly (raw REST call with a stale `generation`) and through the extension itself (a signed-in second device that hasn't reconnected since the reset should have its queued uploads rejected until it re-registers).
9. Deleting an auth user cascades through profile, device, and total rows.
10. Database logs and error reporting contain no titles or URLs.
