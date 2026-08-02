const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const AccountState = require(path.join(root, "lib", "account-state.js"));
const CloudContract = require(path.join(root, "lib", "cloud-contract.js"));
const CloudConfig = require(path.join(root, "lib", "cloud-config.js"));
const Entitlements = require(path.join(root, "lib", "entitlements.js"));
const SupabaseRest = require(path.join(root, "lib", "supabase-rest.js"));

(function accountStateNeverStoresCredentials() {
  const now = Date.UTC(2026, 7, 1, 10, 0, 0);
  const account = AccountState.authenticated({
    userId: "123e4567-e89b-42d3-a456-426614174000",
    expiresAt: now + 3600000,
    authenticatedAt: now
  }, now);
  assert.equal(AccountState.canUseCloud(account, now), true);
  assert.equal("accessToken" in account, false);
  assert.equal("refreshToken" in account, false);
  assert.deepEqual(Object.keys(AccountState.publicSummary(account, now)).sort(), [
    "connected", "lastAuthenticatedAt", "provider", "sessionExpiresAt", "status"
  ]);
  assert.equal(AccountState.normalize(account, now + 7200000).status, "expired");
  assert.equal(AccountState.authenticated({ userId: "not-a-user", expiresAt: now + 1 }, now).status, "guest");
})();

(function serverEntitlementsAreBoundedByPlanAndExpiry() {
  const now = Date.UTC(2026, 7, 1);
  const free = Entitlements.normalizeServer({ plan: "free", features: { cloud_sync: true } }, now);
  assert.equal(Entitlements.has(free, "cloud_sync", now), false);
  assert.equal(Entitlements.has(free, "pro_analytics", now), false);

  const pro = Entitlements.normalizeServer({
    plan: "pro",
    expiresAt: now + 86400000,
    features: { cloud_sync: true, multiple_languages: true }
  }, now);
  assert.equal(Entitlements.has(pro, "cloud_sync", now), true);
  assert.equal(Entitlements.has(pro, "multiple_languages", now), true);
  assert.equal(Entitlements.has(pro, "custom_reports", now), false);
  assert.equal(Entitlements.normalize(pro, now + 172800000).plan, "free");

  const localImport = Entitlements.normalizeLocal({ plan: "pro", features: { cloud_sync: true } });
  assert.equal(localImport.plan, "beta");
  assert.equal(localImport.features.cloud_sync, false);
})();

(function cloudConfigurationFailsClosed() {
  const example = JSON.parse(fs.readFileSync(path.join(root, "config", "cloud-config.example.json"), "utf8"));
  assert.equal(CloudConfig.isReady(example), false);
  assert(CloudConfig.normalize(example).errors.includes("missing-anon-key"));

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const serviceRole = `${encode({ alg: "HS256" })}.${encode({ role: "service_role" })}.signature`;
  const unsafe = CloudConfig.normalize({
    enabled: true,
    supabaseUrl: "https://sample.supabase.co",
    supabaseAnonKey: serviceRole,
    authRedirectUrl: "https://extension-id.chromiumapp.org/supabase-auth",
    contractVersion: 1
  });
  assert.equal(unsafe.enabled, false);
  assert(unsafe.errors.includes("service-role-key-forbidden"));

  const anon = `${encode({ alg: "HS256" })}.${encode({ role: "anon" })}.signature`;
  assert.equal(CloudConfig.isReady({
    enabled: true,
    supabaseUrl: "https://sample.supabase.co",
    supabaseAnonKey: anon,
    authRedirectUrl: "https://extension-id.chromiumapp.org/supabase-auth",
    contractVersion: 1
  }), true);
})();

(function snapshotsAreIdempotentAndPrivacySafe() {
  const record = {
    dateKey: "2026-08-01",
    languageCode: "ja",
    source: "youtube",
    activeSeconds: 123.7,
    passiveSeconds: 45.2,
    sessionCount: 2,
    revision: 4,
    updatedAt: Date.UTC(2026, 7, 1, 12)
  };
  const options = { deviceId: "device_12345678", generation: 2 };
  const first = CloudContract.createSnapshot(record, options);
  const second = CloudContract.createSnapshot(record, options);
  assert.deepEqual(first, second);
  assert.equal(first.activeSeconds, 124);
  assert.equal(first.passiveSeconds, 45);
  assert(first.snapshotId.includes("device_12345678|2|2026-08-01|ja|youtube"));

  const row = CloudContract.toDatabaseRow(first);
  assert.equal(CloudContract.isPrivacySafeRow(row), true);
  assert.equal(Object.keys(row).some((key) => /title|url|action/i.test(key)), false);
  assert.equal(CloudContract.isPrivacySafeRow({ ...row, title: "Readable title" }), false);
  assert.equal(CloudContract.isPrivacySafeRow({ ...row, url: "https://example.com" }), false);
  assert.equal(CloudContract.isPrivacySafeRow({ ...row, active_seconds: -1 }), false);
  assert.equal(CloudContract.isPrivacySafeRow({ ...row, client_updated_at: "not-a-date" }), false);
  assert.throws(() => CloudContract.createSnapshot(record, { deviceId: options.deviceId, generation: 0 }), /generation/i);
})();

(function uploadPlanningAndRetriesAreDeterministic() {
  const records = {
    a: { dateKey: "2026-08-01", languageCode: "ja", source: "youtube", activeSeconds: 60, revision: 2, updatedAt: 1 },
    b: { dateKey: "2026-08-02", languageCode: "ja", source: "reading", activeSeconds: 120, revision: 5, updatedAt: 2 }
  };
  const options = { deviceId: "device_12345678", generation: 1, now: 10 };
  const snapshots = Object.values(records).map((record) => CloudContract.createSnapshot(record, options));
  const remote = { [snapshots[0].snapshotId]: 2, [snapshots[1].snapshotId]: 4 };
  const planned = CloudContract.planUploads(records, remote, options);
  assert.equal(planned.length, 1);
  assert(planned[0].snapshotId.includes("reading"));

  const queued = CloudContract.mergeQueue({}, planned, 1000);
  const replaced = CloudContract.mergeQueue(queued, planned, 2000);
  assert.equal(Object.keys(replaced).length, 1, "re-queuing a snapshot must replace the same queue entry");
  assert.equal(replaced[planned[0].snapshotId].queuedAt, 1000);
  assert.equal(CloudContract.readyBatch(replaced, 1999).length, 0);
  assert.equal(CloudContract.readyBatch(replaced, 2000).length, 1);
  const retried = CloudContract.retryEntry(replaced[planned[0].snapshotId], new Error("temporary failure"), 1000);
  assert.equal(retried.attempts, 1);
  assert(retried.nextAttemptAt > 1000);
})();

(function supabaseDraftContainsRequiredSafetyControls() {
  const sql = fs.readFileSync(path.join(root, "supabase", "migrations", "0001_cloud_foundation.sql"), "utf8").toLowerCase();
  for (const requirement of [
    "enable row level security",
    "force row level security",
    "auth.uid() = user_id",
    "tracker_reset_my_data",
    "data_generation",
    "contract_version",
    "revoke all",
    "to authenticated"
  ]) assert(sql.includes(requirement), `Supabase draft is missing: ${requirement}`);
  assert(!/\b(title|url|session_title|video_title)\b/.test(sql), "cloud schema must not contain readable title or URL columns");
})();

(function uploadRequestsStayAlignedWithTheRlsChecklistAssumptions() {
  // supabase/tests/rls-checklist.md item 6 ("retrying the same primary key
  // replaces the snapshot rather than adding seconds") only holds if the
  // client's on_conflict target actually matches the table's real primary
  // key. This guards against the SQL and the REST request builder drifting
  // apart silently - a mismatch here would turn every retried upload into a
  // duplicate row instead of an idempotent replace.
  const sql = fs.readFileSync(path.join(root, "supabase", "migrations", "0001_cloud_foundation.sql"), "utf8");
  const totalsPk = /create table if not exists public\.tracker_daily_totals[\s\S]*?primary key \(([^)]+)\)/.exec(sql);
  assert(totalsPk, "could not find tracker_daily_totals primary key in the migration");
  const expectedTotalsPk = totalsPk[1].replace(/\s+/g, "");

  const config = {
    supabaseUrl: "https://sample.supabase.co",
    supabaseAnonKey: "anon-key"
  };
  const totalsRequest = SupabaseRest.buildUpsertDailyTotalsRequest(config, {
    accessToken: "token",
    userId: "123e4567-e89b-42d3-a456-426614174000",
    rows: [{
      device_id: "device_12345678", generation: 1, date_key: "2026-08-01", language_code: "ja",
      source: "reading", active_seconds: 1, passive_seconds: 0, session_count: 1, revision: 1,
      client_updated_at: "2026-08-01T00:00:00.000Z", contract_version: 1
    }]
  });
  const onConflict = new URL(totalsRequest.url).searchParams.get("on_conflict");
  assert.equal(onConflict, expectedTotalsPk, "buildUpsertDailyTotalsRequest's on_conflict must match tracker_daily_totals's real primary key");

  // Every row must be stamped with the caller's own session user id, even if
  // a bogus one sneaks into the payload - RLS enforces this server-side too,
  // but the client should never even try to send someone else's id.
  const spoofed = SupabaseRest.buildUpsertDailyTotalsRequest(config, {
    accessToken: "token",
    userId: "123e4567-e89b-42d3-a456-426614174000",
    rows: [{ ...totalsRequest.body[0], user_id: "00000000-0000-4000-8000-000000000000" }]
  });
  assert.equal(spoofed.body[0].user_id, "123e4567-e89b-42d3-a456-426614174000",
    "rows must always be stamped with the authenticated session's own user id");

  const devicesPk = /create table if not exists public\.tracker_devices[\s\S]*?primary key \(([^)]+)\)/.exec(sql);
  assert(devicesPk, "could not find tracker_devices primary key in the migration");
  const deviceRequest = SupabaseRest.buildUpsertDeviceRequest(config, {
    accessToken: "token", userId: "123e4567-e89b-42d3-a456-426614174000", deviceId: "device_12345678", generation: 1
  });
  assert.equal(new URL(deviceRequest.url).searchParams.get("on_conflict"), devicesPk[1].replace(/\s+/g, ""),
    "buildUpsertDeviceRequest's on_conflict must match tracker_devices's real primary key");
})();

console.log("Next-phase account, entitlement, cloud-contract, and SQL checks passed.");
