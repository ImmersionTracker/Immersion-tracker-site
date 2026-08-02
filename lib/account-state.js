(function exposeAccountState(globalScope) {
  "use strict";

  const ACCOUNT_SCHEMA_VERSION = 1;
  const STATUSES = Object.freeze(["guest", "connecting", "authenticated", "expired", "error"]);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function timestamp(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function userId(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return UUID_PATTERN.test(normalized) ? normalized : "";
  }

  function safeError(value) {
    if (!value) return null;
    return {
      code: String(value.code || "account-error").replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "account-error",
      message: String(value.message || "Account connection failed.").replace(/\s+/g, " ").trim().slice(0, 180),
      at: timestamp(value.at) || Date.now()
    };
  }

  function guest() {
    return {
      schemaVersion: ACCOUNT_SCHEMA_VERSION,
      status: "guest",
      provider: "none",
      userId: "",
      sessionExpiresAt: 0,
      lastAuthenticatedAt: 0,
      error: null
    };
  }

  function normalize(value, now = Date.now()) {
    const source = value && typeof value === "object" ? value : {};
    const id = userId(source.userId ?? source.user_id);
    const expiresAt = timestamp(source.sessionExpiresAt ?? source.expires_at);
    let status = STATUSES.includes(source.status) ? source.status : "guest";
    if (status === "authenticated" && (!id || (expiresAt && expiresAt <= Number(now)))) {
      status = id && expiresAt ? "expired" : "guest";
    }
    if (status === "expired" && !id) status = "guest";
    if (status === "guest") return guest();
    return {
      schemaVersion: ACCOUNT_SCHEMA_VERSION,
      status,
      provider: source.provider === "supabase" ? "supabase" : "none",
      userId: id,
      sessionExpiresAt: expiresAt,
      lastAuthenticatedAt: timestamp(source.lastAuthenticatedAt),
      error: status === "error" ? safeError(source.error) : null
    };
  }

  function authenticated({ userId: id, expiresAt, authenticatedAt = Date.now() }, now = Date.now()) {
    return normalize({
      status: "authenticated",
      provider: "supabase",
      userId: id,
      sessionExpiresAt: expiresAt,
      lastAuthenticatedAt: authenticatedAt
    }, now);
  }

  function canUseCloud(value, now = Date.now()) {
    const account = normalize(value, now);
    return account.status === "authenticated" && account.provider === "supabase" && Boolean(account.userId);
  }

  function publicSummary(value, now = Date.now()) {
    const account = normalize(value, now);
    return {
      status: account.status,
      provider: account.provider,
      connected: canUseCloud(account, now),
      sessionExpiresAt: account.sessionExpiresAt,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    };
  }

  const api = {
    ACCOUNT_SCHEMA_VERSION,
    STATUSES,
    guest,
    normalize,
    authenticated,
    canUseCloud,
    publicSummary
  };
  globalScope.TrackerAccountState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
