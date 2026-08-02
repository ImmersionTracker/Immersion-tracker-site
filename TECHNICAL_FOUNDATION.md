# Data and Pro Analytics foundation

## Product decisions

- Daily totals are stored locally for as long as the extension remains installed or until the user resets them.
- A Free plan may limit which advanced views are available later, but it must not delete older local totals to manufacture an upgrade reason.
- Pro Analytics is enabled for everyone during beta. The entitlement path already supports turning it off later.
- Free uses one active target language at a time. Switching never deletes older language records. Multi-language workspaces and combined-language analytics are planned Pro features, not active features in this version.
- Accounts and database login are not presented as available before the Supabase phase. The current UI identifies itself as a local beta profile.
- Chrome Sync keeps its existing, compact behavior. The new detailed daily history is never added to Chrome Sync.
- No account, payment, Supabase connection, upload queue, or cloud sync is implemented in this phase.

## Canonical local record

`state.dailyRecords` is the new storage-independent analytics source. It is a map keyed by a deterministic ID made from date, language, and source.

```json
{
  "id": "2026-08-01|ja|youtube",
  "dateKey": "2026-08-01",
  "languageCode": "ja",
  "source": "youtube",
  "activeSeconds": 1800,
  "passiveSeconds": 900,
  "sessionCount": 2,
  "createdAt": 1785582000000,
  "updatedAt": 1785583800000,
  "revision": 3,
  "schemaVersion": 1
}
```

The record contains no title or URL. Readable titles remain in `state.sessions`, local-only, capped to the latest ten entries. `dailySessionCounts` is a small internal counter map used to preserve session counts while the legacy and canonical paths run side by side.

Dates are recorded using the device's current local calendar date at the time the activity occurs. Saved dates are not recalculated if the user later travels to another timezone.

## Compatibility path

The existing `languageRecords` and `sourceTotals` remain temporarily because tracking, exports, and the current Chrome Sync implementation already depend on them. Every state update now follows this sequence:

1. Apply the existing tracking mutation.
2. Keep daily source aggregates permanently; only readable History is capped.
3. Project the legacy daily totals into `dailyRecords`.
4. Compare active and passive totals for every language/date.
5. Save only if the two paths agree exactly.

If they differ, the write is rejected with `canonical-divergence`. This makes disagreement visible without risking silent data loss. Once the new path has been proven in normal use, tracking mutations can be moved behind the data service one operation at a time.

## Migration flow

Migration from state version 8 to version 9 is staged and local:

1. Read the existing state and retain an untouched backup under a separate local-storage key.
2. Run the conversion against a normalized copy.
3. Normalize equivalent source labels and combine collisions instead of overwriting them. Represent known source totals normally. If old six-month compaction already removed a source breakdown, preserve the remaining time under the honest source label `compacted`.
4. Derive session counts only from genuine retained sessions. Missing counts stay zero; no sessions or timestamps are invented.
5. Diff old and new active/passive totals for every language/date, allowing only sub-millisecond floating-point noise. If an old source split is internally larger than its authoritative daily total, proportionally repair that source split, record the repair count, and preserve the daily total exactly.
6. Write a staged version and read it back.
7. Run the same diff again before promoting it to primary state.
8. Keep the backup through the next successful startup verification, then remove it. Reset All Data removes migration backups too.

There are no users to migrate remotely today, but this path also protects development data and makes future schema changes safer.

## Shared analytics

`lib/tracker-analytics.js` contains pure functions. They do not call Chrome storage or modify state. The functions calculate:

- selected and previous period totals;
- daily averages and active/passive split;
- current and longest streaks;
- daily trends and source totals;
- weekly totals and goal consistency;
- best day, best week, and most-used source.

The real Pro Analytics dashboard uses these functions against local `dailyRecords`. Source rows can open related entries from the latest ten readable local sessions. Older daily totals remain useful even when their readable title is no longer retained.

## Entitlements

`lib/entitlements.js` is the single feature-checking path. Current defaults are:

- `free`: enabled;
- `pro_analytics`: enabled during beta;
- future cloud features: disabled.

This is only a product/UI gate. When paid plans exist, Supabase or another trusted server must be authoritative; a local flag alone is not payment security.

## Storage boundary

`TrackerData.ChromeStorageAdapter` isolates Chrome Local Storage from the data model. A future Supabase adapter can map the same canonical records without changing the analytics functions. The future database should store per-device daily snapshots and sum them at query time; that avoids unsafe additive retries when sync is eventually implemented.

## Next-phase preparation

The next phase is still disabled, but its storage-independent preparation now exists:

- `lib/account-state.js` defines a credential-free public account state. Supabase access and refresh tokens are deliberately not part of tracker state or exports.
- `lib/cloud-contract.js` converts canonical daily records into privacy-safe, idempotent device snapshots and provides deterministic upload planning, queue replacement, batching, and retry backoff.
- `lib/cloud-config.js` fails closed on placeholders, non-HTTPS endpoints, unknown public-key formats, and any Supabase service-role or secret key.
- `lib/entitlements.js` distinguishes local beta access from server-authoritative Free/Pro entitlements. Local data can never enable cloud sync.
- `supabase/migrations/0001_cloud_foundation.sql` is an undeployed development draft with RLS, device generations, and reset protection.
- `NEXT_PHASE_ROADMAP.md` defines the staged account, sync, payment, and disclosure gates.

Before enabling a backend:

1. Decide account and sign-in experience.
2. Decide Free/Pro pricing and exactly which views are gated.
3. Design device identity recovery and duplicate-device handling.
4. Implement server-authoritative entitlements and payment webhooks.
5. Add an idempotent upload queue, conflict rules, deletion flow, and account export.
6. Test multi-device and offline behavior before inviting users.

The Supabase SQL remains a planning draft only and is not run or referenced by the extension.
