(function exposeAnalyticsRest(globalScope) {
  "use strict";

  // Pure PostgREST request builder for supabase/migrations/0002_analytics_events.sql.
  // Same rule as lib/supabase-rest.js: no fetch(), no chrome.* - just
  // (config, input) -> {url, method, headers, body}. Always sends the
  // config's own anon key as the bearer token, never a signed-in user's
  // access token, so analytics stays fully decoupled from account/cloud-sync
  // state - it works (or doesn't) purely based on the user's analytics
  // consent toggle.

  function assertConfig(config) {
    if (!config || typeof config !== "object" || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new TypeError("A valid Supabase config (supabaseUrl, supabaseAnonKey) is required.");
    }
    return config;
  }

  function restUrl(config, table) {
    return new URL(`/rest/v1/${table}`, `${String(config.supabaseUrl).replace(/\/$/, "")}/`).toString();
  }

  function buildInsertEventsRequest(config, { rows } = {}) {
    assertConfig(config);
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) throw new TypeError("At least one analytics event is required to upload.");
    if (safeRows.length > 100) throw new TypeError("At most 100 analytics events may be uploaded in a single batch.");
    const anonKey = String(config.supabaseAnonKey);
    return {
      url: restUrl(config, "analytics_events"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: "return=minimal"
      },
      body: safeRows
    };
  }

  function describeRestError(json, fallback = "Request failed.") {
    const message = json && typeof json === "object" ? String(json.message || json.msg || "") : "";
    return (message || fallback).slice(0, 200);
  }

  const api = { buildInsertEventsRequest, describeRestError };
  globalScope.TrackerAnalyticsRest = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
