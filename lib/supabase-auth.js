(function exposeSupabaseAuth(globalScope) {
  "use strict";

  // Pure request builders for the Supabase Auth REST API. This file never
  // calls fetch() itself and never touches chrome.* storage - it only turns
  // (config, input) into a plain {url, method, headers, body} descriptor that
  // background.js executes. Keeping it side-effect free means it can be
  // required and tested from plain node, matching the rest of lib/.

  const MIN_PASSWORD_LENGTH = 8;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function assertConfig(config) {
    if (!config || typeof config !== "object" || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new TypeError("A valid Supabase config (supabaseUrl, supabaseAnonKey) is required.");
    }
    return config;
  }

  function assertEmail(email) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) throw new TypeError("Enter a valid email address.");
    return normalized;
  }

  function assertPassword(password) {
    const value = String(password || "");
    if (value.length < MIN_PASSWORD_LENGTH) {
      throw new TypeError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    return value;
  }

  function assertRecoveryCode(token) {
    const value = String(token || "").trim();
    if (!value || value.length < 4 || value.length > 32) throw new TypeError("Enter the code from your email.");
    return value;
  }

  function baseHeaders(config, bearer) {
    return {
      "Content-Type": "application/json",
      apikey: String(config.supabaseAnonKey),
      Authorization: `Bearer ${String(bearer || config.supabaseAnonKey)}`
    };
  }

  function authUrl(config, path, query) {
    const url = new URL(`/auth/v1/${path}`, `${String(config.supabaseUrl).replace(/\/$/, "")}/`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  function buildSignUpRequest(config, { email, password } = {}) {
    assertConfig(config);
    return {
      url: authUrl(config, "signup"),
      method: "POST",
      headers: baseHeaders(config),
      body: { email: assertEmail(email), password: assertPassword(password) }
    };
  }

  function buildSignInRequest(config, { email, password } = {}) {
    assertConfig(config);
    return {
      url: authUrl(config, "token", { grant_type: "password" }),
      method: "POST",
      headers: baseHeaders(config),
      body: { email: assertEmail(email), password: assertPassword(password) }
    };
  }

  function buildRefreshRequest(config, { refreshToken } = {}) {
    assertConfig(config);
    const token = String(refreshToken || "").trim();
    if (!token) throw new TypeError("A refresh token is required.");
    return {
      url: authUrl(config, "token", { grant_type: "refresh_token" }),
      method: "POST",
      headers: baseHeaders(config),
      body: { refresh_token: token }
    };
  }

  function buildSignOutRequest(config, { accessToken } = {}) {
    assertConfig(config);
    const token = String(accessToken || "").trim();
    if (!token) throw new TypeError("An access token is required to sign out.");
    return {
      url: authUrl(config, "logout", { scope: "local" }),
      method: "POST",
      headers: baseHeaders(config, token),
      body: {}
    };
  }

  function buildRequestPasswordResetRequest(config, { email } = {}) {
    assertConfig(config);
    return {
      url: authUrl(config, "recover"),
      method: "POST",
      headers: baseHeaders(config),
      body: { email: assertEmail(email) }
    };
  }

  // Exchanges the 6-character code from the "Reset password" email for a
  // short-lived session, without ever opening a browser redirect. The access
  // token from this response is then used to actually set the new password.
  function buildVerifyRecoveryRequest(config, { email, token } = {}) {
    assertConfig(config);
    return {
      url: authUrl(config, "verify"),
      method: "POST",
      headers: baseHeaders(config),
      body: { type: "recovery", email: assertEmail(email), token: assertRecoveryCode(token) }
    };
  }

  function buildUpdatePasswordRequest(config, { accessToken, password } = {}) {
    assertConfig(config);
    const token = String(accessToken || "").trim();
    if (!token) throw new TypeError("An access token is required to change the password.");
    return {
      url: authUrl(config, "user"),
      method: "PUT",
      headers: baseHeaders(config, token),
      body: { password: assertPassword(password) }
    };
  }

  // Normalizes a Supabase Auth token/signup/verify JSON response into the
  // shape lib/account-state.js expects. Throws if the response doesn't look
  // like a session (e.g. signup with email confirmation still pending).
  function parseSession(response, now = Date.now()) {
    const accessToken = String(response?.access_token || "").trim();
    const refreshToken = String(response?.refresh_token || "").trim();
    const userId = String(response?.user?.id || "").trim();
    if (!accessToken || !refreshToken || !userId) return null;
    const expiresAtSeconds = Number(response?.expires_at);
    const expiresInSeconds = Number(response?.expires_in);
    const expiresAt = Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
      ? Math.floor(expiresAtSeconds * 1000)
      : Number(now) + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : 3600 * 1000);
    return {
      accessToken,
      refreshToken,
      userId,
      email: normalizeEmail(response?.user?.email),
      expiresAt,
      authenticatedAt: Number(now)
    };
  }

  function parseAuthError(response, fallback = "Something went wrong. Try again.") {
    const message = String(response?.msg || response?.error_description || response?.message || "").trim();
    const code = String(response?.error_code || response?.code || response?.error || "").trim();
    return {
      code: code || "auth-error",
      message: message || fallback
    };
  }

  const api = {
    MIN_PASSWORD_LENGTH,
    normalizeEmail,
    buildSignUpRequest,
    buildSignInRequest,
    buildRefreshRequest,
    buildSignOutRequest,
    buildRequestPasswordResetRequest,
    buildVerifyRecoveryRequest,
    buildUpdatePasswordRequest,
    parseSession,
    parseAuthError
  };
  globalScope.TrackerSupabaseAuth = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
