(function exposeSupabaseRest(globalScope) {
  "use strict";

  // Pure PostgREST request builders for the tables in
  // supabase/migrations/0001_cloud_foundation.sql. Same rule as
  // lib/supabase-auth.js: no fetch(), no chrome.*, just (config, input) ->
  // {url, method, headers, body}, so it stays testable from plain node.

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function assertConfig(config) {
    if (!config || typeof config !== "object" || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new TypeError("A valid Supabase config (supabaseUrl, supabaseAnonKey) is required.");
    }
    return config;
  }

  function assertAccessToken(accessToken) {
    const token = String(accessToken || "").trim();
    if (!token) throw new TypeError("An access token is required for this request.");
    return token;
  }

  function assertUserId(userId) {
    const value = String(userId || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(value)) throw new TypeError("A valid user id is required for this request.");
    return value;
  }

  function assertDeviceId(deviceId) {
    const value = String(deviceId || "").trim();
    if (value.length < 8 || value.length > 128) throw new TypeError("A stable device id (8-128 characters) is required.");
    return value;
  }

  function assertGeneration(generation) {
    const value = Math.round(Number(generation));
    if (!Number.isFinite(value) || value < 1) throw new TypeError("A positive data generation is required.");
    return value;
  }

  function restHeaders(config, accessToken, extra = {}) {
    return {
      "Content-Type": "application/json",
      apikey: String(config.supabaseAnonKey),
      Authorization: `Bearer ${assertAccessToken(accessToken)}`,
      ...extra
    };
  }

  function restUrl(config, table, query) {
    const url = new URL(`/rest/v1/${table}`, `${String(config.supabaseUrl).replace(/\/$/, "")}/`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  // Fetches the caller's own tracker_profiles row (RLS already limits this
  // to exactly one row: the signed-in user's). We need data_generation
  // before registering a device or uploading anything, because both those
  // inserts are rejected by RLS unless their `generation` column matches it.
  function buildGetProfileRequest(config, { accessToken, userId } = {}) {
    assertConfig(config);
    return {
      url: restUrl(config, "tracker_profiles", {
        select: "data_generation,plan,pro_expires_at",
        user_id: `eq.${assertUserId(userId)}`
      }),
      method: "GET",
      headers: restHeaders(config, accessToken)
    };
  }

  // Upserts (insert-or-update) this device's row. The primary key is
  // (user_id, device_id), so re-registering the same device after a reset
  // (which bumps data_generation) correctly moves it onto the new
  // generation rather than creating a duplicate row.
  function buildUpsertDeviceRequest(config, { accessToken, userId, deviceId, generation, deviceLabel, now = Date.now() } = {}) {
    assertConfig(config);
    const label = deviceLabel == null ? null : String(deviceLabel).trim().slice(0, 80) || null;
    return {
      url: restUrl(config, "tracker_devices", { on_conflict: "user_id,device_id" }),
      method: "POST",
      headers: restHeaders(config, accessToken, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: {
        user_id: assertUserId(userId),
        device_id: assertDeviceId(deviceId),
        generation: assertGeneration(generation),
        device_label: label,
        disabled_at: null,
        last_seen_at: new Date(Number(now) || Date.now()).toISOString()
      }
    };
  }

  // Batch-upserts daily snapshot rows (already shaped by
  // TrackerCloudContract.toDatabaseRow) against tracker_daily_totals. The
  // primary key covers (user_id, device_id, generation, date_key,
  // language_code, source), so re-uploading the same snapshot - the whole
  // point of the queue's retry path - is a no-op rather than a duplicate.
  // user_id is stamped on here rather than trusted from the caller, since
  // it must always match the signed-in session RLS checks against.
  function buildUpsertDailyTotalsRequest(config, { accessToken, userId, rows } = {}) {
    assertConfig(config);
    const uid = assertUserId(userId);
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) throw new TypeError("At least one row is required to upload.");
    if (safeRows.length > 100) throw new TypeError("At most 100 rows may be uploaded in a single batch.");
    return {
      url: restUrl(config, "tracker_daily_totals", {
        on_conflict: "user_id,device_id,generation,date_key,language_code,source"
      }),
      method: "POST",
      headers: restHeaders(config, accessToken, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: safeRows.map((row) => ({ ...row, user_id: uid }))
    };
  }

  // Calls the security-definer tracker_delete_my_account() RPC (see
  // supabase/migrations/0003_self_account_deletion.sql). Always sends the
  // caller's own access token - the function itself only ever deletes
  // auth.uid(), so there is no argument here that could target another
  // account even if this call were somehow forged.
  function buildDeleteAccountRequest(config, { accessToken } = {}) {
    assertConfig(config);
    return {
      url: restUrl(config, "rpc/tracker_delete_my_account"),
      method: "POST",
      headers: restHeaders(config, accessToken),
      body: {}
    };
  }

  // PostgREST error bodies for REST (not Auth) endpoints use {message, code,
  // details, hint} rather than Auth's {error_code, msg} - kept separate from
  // TrackerSupabaseAuth.parseAuthError so callers don't have to guess which
  // shape applies where.
  function describeRestError(json, fallback = "Request failed.") {
    const message = json && typeof json === "object" ? String(json.message || json.msg || "") : "";
    return (message || fallback).slice(0, 200);
  }

  function parseProfile(rows) {
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || typeof row !== "object") return null;
    const generation = Math.round(Number(row.data_generation));
    if (!Number.isFinite(generation) || generation < 1) return null;
    return { generation, plan: String(row.plan || "free"), proExpiresAt: row.pro_expires_at || null };
  }

  function parseDevice(rows) {
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || typeof row !== "object") return null;
    return {
      deviceId: String(row.device_id || ""),
      generation: Math.round(Number(row.generation)) || 0,
      lastSeenAt: row.last_seen_at ? Date.parse(row.last_seen_at) || 0 : 0
    };
  }

  const api = {
    buildGetProfileRequest,
    buildUpsertDeviceRequest,
    buildUpsertDailyTotalsRequest,
    buildDeleteAccountRequest,
    describeRestError,
    parseProfile,
    parseDevice
  };
  globalScope.TrackerSupabaseRest = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
