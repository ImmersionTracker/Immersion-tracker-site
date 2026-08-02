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
