(function exposeCloudConfig(globalScope) {
  "use strict";

  const CONFIG_VERSION = 1;

  function decodeJwtPayload(value) {
    const part = String(value || "").split(".")[1];
    if (!part) return null;
    try {
      const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
      const json = typeof atob === "function"
        ? decodeURIComponent([...atob(normalized)].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))
        : typeof Buffer !== "undefined"
          ? Buffer.from(normalized, "base64").toString("utf8")
          : "";
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function validate(value) {
    const source = value && typeof value === "object" ? value : {};
    const errors = [];
    let url = null;
    try { url = new URL(String(source.supabaseUrl || "")); } catch { errors.push("invalid-supabase-url"); }
    if (url && (url.protocol !== "https:" || !/\.supabase\.co$/i.test(url.hostname))) errors.push("untrusted-supabase-url");

    const key = String(source.supabaseAnonKey || "").trim();
    if (!key || /YOUR_|PLACEHOLDER/i.test(key)) errors.push("missing-anon-key");
    const payload = decodeJwtPayload(key);
    if (payload?.role === "service_role" || /^sb_secret_/i.test(key)) errors.push("service-role-key-forbidden");
    if (key && !payload && !/^sb_publishable_[a-z0-9_-]+$/i.test(key) && !/YOUR_|PLACEHOLDER/i.test(key)) {
      errors.push("unrecognized-public-key-format");
    }

    let redirect = null;
    try { redirect = new URL(String(source.authRedirectUrl || "")); } catch { errors.push("invalid-auth-redirect"); }
    if (redirect && redirect.protocol !== "https:") errors.push("insecure-auth-redirect");
    if (Number(source.contractVersion) !== CONFIG_VERSION) errors.push("contract-version-mismatch");
    return [...new Set(errors)];
  }

  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    const errors = validate(source);
    return {
      enabled: source.enabled === true && errors.length === 0,
      provider: "supabase",
      supabaseUrl: String(source.supabaseUrl || "").trim().replace(/\/$/, ""),
      supabaseAnonKey: String(source.supabaseAnonKey || "").trim(),
      authRedirectUrl: String(source.authRedirectUrl || "").trim(),
      contractVersion: CONFIG_VERSION,
      errors
    };
  }

  function disabled() {
    return normalize({
      enabled: false,
      provider: "supabase",
      supabaseUrl: "",
      supabaseAnonKey: "",
      authRedirectUrl: "",
      contractVersion: CONFIG_VERSION
    });
  }

  function isReady(value) {
    return normalize(value).enabled;
  }

  const api = { CONFIG_VERSION, decodeJwtPayload, validate, normalize, disabled, isReady };
  globalScope.TrackerCloudConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
