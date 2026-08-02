# Required RLS checks before deployment

Use two unrelated authenticated test users, A and B. Do not test only with the Supabase dashboard service role because it bypasses row-level security.

1. User A can select only A's profile, devices, and current-generation daily rows.
2. User B cannot select, insert, update, or delete any row owned by A.
3. The anon role cannot read or modify any tracker table.
4. An authenticated client cannot change `plan`, `pro_expires_at`, `entitlement_version`, or `data_generation` directly.
5. A daily row is rejected unless its device belongs to the same user, is enabled, and has the current generation.
6. Retrying the same primary key replaces the snapshot rather than adding seconds.
7. Calling `tracker_reset_my_data()` deletes old totals and increments the generation.
8. A device using the old generation cannot upload old rows after a reset.
9. Deleting an auth user cascades through profile, device, and total rows.
10. Database logs and error reporting contain no titles or URLs.
