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
- Verify no login or cloud-sync control claims to be active in the local-only release.

## Store submission

- Build a fresh versioned ZIP from source files only.
- Confirm no `.git`, tests, screenshots, drafts, Supabase files, real credentials, or local browser profiles are included.
- Host the privacy policy at a stable public HTTPS URL.
- Complete permission justifications, data-use disclosures, distribution, and reviewer instructions.
- Start with Private or Unlisted testing.

## Before any future cloud release

- Complete every RLS test in `supabase/tests/rls-checklist.md`.
- Update privacy and store disclosures before enabling uploads.
- Verify account deletion and reset-generation behavior.
- Verify only daily aggregate rows reach the database.
