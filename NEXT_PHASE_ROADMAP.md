# Next-phase roadmap

This roadmap is intentionally staged for a small extension with no current users. It avoids building a large backend before the local product has been tested in public.

## Product decisions already made

- Local daily totals are never deleted to pressure an upgrade. Free may show a shorter analytics window later, but export and locally stored totals remain intact.
- Free supports one active target language at a time. Switching languages preserves older language data.
- Pro adds advanced analytics, combined multi-language views, and database sync.
- Pro Analytics remains unlocked for everyone during beta.
- No AI features, email summaries, encrypted-backup claims, playlists, or study-project organization.
- Titles, URLs, manual action labels, and remembered video choices remain local-only.

## Recommended commercial shape

- Beta: free, with Pro Analytics unlocked.
- Free after beta: tracking, goals, manual entries, local backup/export, one active language, and recent overview analytics.
- Pro: full-period analytics, multi-language views, and Supabase daily-total sync.
- Initial price target: EUR 2.99 monthly or EUR 24.99 yearly. Do not hard-code prices until taxes, store geography, refund handling, and payment fees are reviewed.
- No lifetime plan initially; it creates long-term service obligations before costs are known.

## Stage 1 — trusted local beta

Status: current phase.

1. Test automatic tracking on every supported service with real playback.
2. Publish privately or unlisted to a small trusted group.
3. Measure only user-reported issues; do not add third-party analytics yet.
4. Confirm the local migration and daily snapshot contract remain stable.
5. Fix detection and onboarding friction before creating accounts.

Exit gate: at least several weeks of stable local use and no unexplained total divergence.

## Stage 2 — development Supabase project

1. Create separate development and production Supabase projects.
2. Apply `supabase/migrations/0001_cloud_foundation.sql` to development.
3. Use email one-time codes for the first account flow. This is simpler than redirect-heavy magic links and does not imply marketing email.
4. Package the Supabase browser client locally; never load remote JavaScript.
5. Build a small adapter behind `lib/cloud-contract.js`.
6. Register one stable local device ID after sign-in.
7. Upload daily snapshots in batches of at most 100 and upsert on the full snapshot primary key.
8. Keep the feature behind a development-only flag.

Exit gate: two-user RLS checklist passes and no service-role credential exists in extension files.

## Stage 3 — offline and multi-device correctness

Test these cases before showing cloud sync publicly:

1. Same snapshot retried repeatedly.
2. Two devices recording the same date and source.
3. One device offline for several days.
4. Session edits and deleted local totals.
5. Reset while another device is offline.
6. Sign-out and sign-in as another user on the same browser profile.
7. Expired session and failed refresh.
8. Account data export and tracker-data reset.
9. Permanent account deletion through a trusted server endpoint.

Exit gate: aggregate totals remain correct and pre-reset generations cannot return.

## Stage 4 — payment and real entitlements

1. Select a payment provider only after account sync works.
2. Use hosted checkout; do not handle card data in the extension.
3. A trusted webhook updates `tracker_profiles.plan`, expiry, and entitlement version.
4. The extension reads entitlements but can never write them.
5. Provide a customer billing portal and clear cancellation status.
6. Keep a short offline grace period for already-verified Pro access, but require the server for cloud operations.

Exit gate: webhook replay, cancellation, refund, expiry, and duplicate-event tests pass.

## Stage 5 — public Pro release

Before enabling cloud sync:

1. Update `PRIVACY.md` and Chrome Web Store disclosures to name Supabase, authentication data, database storage, retention, deletion, and payment processing.
2. Add terms of service and a stable support channel.
3. Show sign-in, sync state, last successful sync, pending changes, and disconnect controls in Account & Plan.
4. Provide server-side account deletion and confirm its completion.
5. Publish to a small percentage of users first and keep a kill switch for cloud sync.

## Explicitly postponed

- AI functionality of any kind.
- Email summaries or engagement campaigns.
- Playlists and study-project organization.
- Custom report builders.
- Team, classroom, or social features.
- A separate mobile application.
