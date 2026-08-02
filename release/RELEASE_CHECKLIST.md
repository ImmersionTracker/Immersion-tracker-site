# Release checklist

## Automated

- Run `npm test`.
- Run the Playwright UI check with the bundled workspace runtime when local Playwright is unavailable.
- Run `npm run screenshots` and inspect all five images.
- Run `npm run validate:release`.
- Confirm the manifest and README versions match.

## Manual extension checks

- Load the unpacked extension in a clean Chrome profile.
- Complete onboarding with a language and with Choose later.
- Test popup Tracker, Insights, Manual, Settings, Account & Plan, and tutorial in dark and light modes.
- Test the full dashboard at 1280x800 and a narrow window.
- Test automatic active/passive tracking and the manual timer across midnight.
- Export JSON and CSV, import a copy, and verify totals remain unchanged.
- Reset all data and confirm both local data and Chrome Sync snapshots are cleared.
- Confirm Account & Plan clearly labels sign-in and cloud sync as optional, and that declining or skipping them leaves local tracking fully unaffected.

## Store submission

- Build a fresh versioned ZIP from source files only.
- Confirm no `.git`, tests, screenshots, drafts, or local browser profiles are included.
- Include `config/cloud-config.json` built against the production Supabase project (anon key only - never a service-role key; the file is gitignored and must never be committed) so optional sign-in works. The packaged `manifest.json` keeps `https://*.supabase.co/*` in `host_permissions` to match; `lib/supabase-auth.js` and `lib/supabase-rest.js` must be included since `background.js` imports them unconditionally.
- Host the privacy policy at a stable public HTTPS URL.
- Complete permission justifications, data-use disclosures, distribution, and reviewer instructions.
- Start with Private or Unlisted testing.

## Cloud release verification

Completed 2026-08-03 against the production Supabase project (`khfizbjmhevmxwtnekvb`), before cloud sync was first enabled in a shipped package:

- All checks in `supabase/tests/rls-checklist.md` passed live using two real, unrelated accounts created and deleted through the Supabase dashboard for the test (no leftover test data): cross-account isolation on select/insert/update/delete, the anon role fully blocked, `plan`/`pro_expires_at`/`entitlement_version`/`data_generation` unwritable by authenticated clients, daily-row inserts gated on device/enabled/generation, upsert-by-primary-key replacing rather than summing, `tracker_reset_my_data()` bumping generation and clearing totals, stale-generation uploads rejected after reset, and account deletion cascading through profile/devices/totals.
- Privacy and store disclosures (`PRIVACY.md`, `STORE_LISTING.md`, this file) were updated to describe cloud sync as live, not pending.
- Account deletion and reset-generation behavior were verified directly against the live database (see above).
- Confirmed only daily aggregate rows (date, language, source, active/passive seconds, session count) reach the database - no titles, URLs, or other content.

Re-run this verification against the production project if the schema, RLS policies, or upload/reset code paths change.

## Analytics release verification

Completed 2026-08-03 against the production Supabase project (`khfizbjmhevmxwtnekvb`), before analytics was first enabled in a shipped package:

- `supabase/migrations/0002_analytics_events.sql` was deployed to production: confirmed the `analytics_events` table exists in the `public` schema with RLS enabled, and that Database > Policies lists exactly one policy (`analytics_events_insert_anon`, `INSERT`, applied to `anon, authenticated`) with no select/update/delete policy for any role - so no role can read a row back, including the one that inserted it.
- Confirmed live that the anon role can insert a row shaped exactly like `lib/analytics-contract.js`'s `toDatabaseRow()` output: three rows inserted during this verification matched the seven-column contract exactly (`target_language`, `platform`, `content_type`, `active_seconds`, `passive_seconds`, `event_date`, `extension_version`) with no extra fields.
- All three verification rows were deleted from the production table afterward; `select count(*) from analytics_events` returned 0 before this release shipped.
- Confirmed only the seven allowlisted columns exist on the table - no titles, URLs, or other content, and no user/device/session identifier of any kind.

Re-run this verification against the production project if the schema, RLS policies, or upload code paths change.

## Self-service account deletion verification

Completed 2026-08-03 against the production Supabase project (`khfizbjmhevmxwtnekvb`), before self-service deletion was first enabled in a shipped package. Ran all six checks in `supabase/tests/self-deletion-checklist.md` using two real throwaway accounts created via the Auth REST API (the same calls `background.js` makes), each given a device and a daily-totals row first:

- Calling `tracker_delete_my_account()` with the anon key alone (no signed-in user) was rejected outright (`42501 permission denied for function tracker_delete_my_account`) - the function has no execute grant for `anon`, so an unauthenticated call never even reaches the `auth.uid() is null` check inside it.
- Account A called the function on itself and got a clean success; a follow-up query as `postgres` confirmed its `auth.users`, `tracker_profiles`, `tracker_devices`, and `tracker_daily_totals` rows were all gone (0 remaining in each).
- Account B (untouched) still had exactly 1 row in `auth.users`, `tracker_profiles`, and `tracker_devices` afterward - deleting one account has no effect on another.
- `analytics_events` row count was identical before and after (0) - it has no `user_id` column for this deletion to cascade from.
- Account A's still-unexpired JWT could no longer read (`200` with an empty array, since RLS has nothing left to match against) or write (`403`, RLS policy violation) anything afterward - functionally equivalent to being rejected, even though the token itself doesn't get server-side revoked immediately.
- Account B was also deleted at the end of this verification so no throwaway accounts were left behind; a final query confirmed 0 matching rows remained in `auth.users` for either test account.

Re-run this verification against the production project if the schema, RLS policies, or this function's body change.
