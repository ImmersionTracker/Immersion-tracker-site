// Exercises the real background.js Supabase-auth message handlers (sign up,
// sign in, sign out, forgot-password request + confirm) inside a sandboxed
// vm context with a mocked chrome.* API and a scripted fetch(), instead of
// re-implementing the logic and testing the reimplementation. Also asserts
// the boundary that must never break: raw session tokens live only in their
// own storage key, never inside the exportable `state` blob.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const EXTENSION_ID = "test-extension-id";

function createChromeStorageArea() {
  const data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of list) if (key in data) result[key] = data[key];
      return result;
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async getBytesInUse() {
      return Buffer.byteLength(JSON.stringify(data));
    },
    setAccessLevel() {
      return Promise.resolve();
    },
    QUOTA_BYTES: 10 * 1024 * 1024,
    _dump: () => ({ ...data })
  };
}

// Generic auto-mock: any chrome.* namespace/method this test doesn't care
// about (alarms, notifications, idle, tabs, commands, action, ...) becomes a
// callable no-op that returns a resolved promise, so background.js's
// top-level setup code (alarm creation, listener registration, etc.) can run
// without throwing.
function autoMock() {
  const fn = function autoMockCallable() { return Promise.resolve(undefined); };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      if (!(prop in target)) target[prop] = autoMock();
      return target[prop];
    }
  });
}

function buildChromeMock() {
  const local = createChromeStorageArea();
  const sync = createChromeStorageArea();
  const messageListeners = [];
  const runtime = new Proxy({
    id: EXTENSION_ID,
    lastError: null,
    getURL: (p) => "config-file://" + p,
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onInstalled: { addListener: () => {} },
    sendMessage: () => Promise.resolve(undefined)
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const mock = autoMock();
      target[prop] = mock;
      return mock;
    }
  });
  const storage = new Proxy({ local, sync }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const mock = autoMock();
      target[prop] = mock;
      return mock;
    }
  });
  const chrome = { storage, runtime };
  const proxied = new Proxy(chrome, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const mock = autoMock();
      target[prop] = mock;
      return mock;
    }
  });
  return { chrome: proxied, messageListeners, local, sync };
}

// Scripted fetch(): serves the real config/cloud-config.example.json content
// for the "extension's own packaged file" fetch, and canned Supabase Auth
// responses for every scenario this test exercises.
function buildFetch(script) {
  return async function fetchMock(url, init = {}) {
    if (String(url).startsWith("config-file://")) {
      return { ok: true, json: async () => script.cloudConfig };
    }
    const method = init.method || "GET";
    const key = `${method} ${new URL(url).pathname}${new URL(url).search}`;
    const handler = script.routes[key];
    if (!handler) throw new Error("Unscripted fetch: " + key);
    const body = init.body ? JSON.parse(init.body) : {};
    const result = handler(body, init.headers || {});
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.json };
  };
}

function loadBackground({ chromeMock, fetchMock }) {
  const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
  let context;
  const sandbox = {
    chrome: chromeMock,
    fetch: fetchMock,
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    console,
    Buffer,
    URL,
    Date,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    importScripts(...files) {
      for (const file of files) {
        const code = fs.readFileSync(path.join(root, file), "utf8");
        vm.runInContext(code, context, { filename: file });
      }
    }
  };
  context = vm.createContext(sandbox);
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInContext(source, context, { filename: "background.js" });
  return context;
}

function dispatch(context, chromeMockState, type, extra = {}) {
  return new Promise((resolve) => {
    const listener = chromeMockState.messageListeners[chromeMockState.messageListeners.length - 1];
    const handled = listener({ type, ...extra }, { id: EXTENSION_ID }, resolve);
    if (handled !== true) resolve(undefined);
  });
}

async function run() {
  const anonKey = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.` +
    `${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.sig`;
  const cloudConfig = {
    enabled: true,
    provider: "supabase",
    supabaseUrl: "https://sample.supabase.co",
    supabaseAnonKey: anonKey,
    authRedirectUrl: `https://${EXTENSION_ID}.chromiumapp.org/supabase-auth`,
    contractVersion: 1
  };

  const now = () => Date.now();
  const session = (overrides = {}) => ({
    access_token: "access-token-1",
    refresh_token: "refresh-token-1",
    expires_in: 3600,
    user: { id: "123e4567-e89b-42d3-a456-426614174000", email: "melis@example.com" },
    ...overrides
  });

  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const expectedDeviceId = "11111111-1111-4111-8111-111111111111"; // fixed by the mocked crypto.randomUUID
  const profileQuery = new URLSearchParams({ select: "data_generation,plan,pro_expires_at", user_id: `eq.${userId}` }).toString();
  const deviceQuery = new URLSearchParams({ on_conflict: "user_id,device_id" }).toString();
  let deviceUpserts = [];

  const routes = {
    "POST /auth/v1/signup": (body) => body.password.length < 8
      ? { status: 400, json: { error_code: "weak_password", msg: "Password should be at least 8 characters." } }
      : { status: 200, json: session({ user: { id: "123e4567-e89b-42d3-a456-426614174000", email: body.email } }) },
    [`GET /rest/v1/tracker_profiles?${profileQuery}`]: () => ({ status: 200, json: [{ data_generation: 1, plan: "beta", pro_expires_at: null }] }),
    [`POST /rest/v1/tracker_devices?${deviceQuery}`]: (body, headers) => {
      deviceUpserts.push({ body, headers });
      return { status: 201, json: [{ ...body }] };
    },
    "POST /auth/v1/token?grant_type=password": (body) => body.password === "correct-horse-1"
      ? { status: 200, json: session({ user: { id: "123e4567-e89b-42d3-a456-426614174000", email: body.email } }) }
      : { status: 400, json: { error_code: "invalid_credentials", msg: "Invalid login credentials" } },
    "POST /auth/v1/logout?scope=local": () => ({ status: 204, json: {} }),
    "POST /auth/v1/recover": () => ({ status: 200, json: {} }),
    "POST /auth/v1/verify": (body) => body.token === "654321"
      ? { status: 200, json: session() }
      : { status: 403, json: { error_code: "otp_expired", msg: "Token has expired or is invalid" } },
    "PUT /auth/v1/user": (body, headers) => headers.Authorization === "Bearer access-token-1" && body.password.length >= 8
      ? { status: 200, json: { id: "123e4567-e89b-42d3-a456-426614174000" } }
      : { status: 401, json: { msg: "Invalid token" } }
  };

  const { chrome: chromeMock, messageListeners, local } = buildChromeMock();
  const fetchMock = buildFetch({ cloudConfig, routes });
  const context = loadBackground({ chromeMock, fetchMock });
  const state = { messageListeners };
  const call = (type, extra) => dispatch(context, state, type, extra);

  // 1. Sign-up with a too-short password is rejected before ever reaching state.
  const weakSignUp = await call("cloudSignUp", { email: "melis@example.com", password: "short" });
  assert.equal(weakSignUp.ok, false);
  assert.equal(weakSignUp.error.code, "invalid-input");

  // 2. Real sign-up succeeds and leaves the account authenticated.
  const signUp = await call("cloudSignUp", { email: "melis@example.com", password: "correct-horse-1" });
  assert.equal(signUp.ok, true, JSON.stringify(signUp));
  assert.equal(signUp.account.status, "authenticated");
  assert.equal(signUp.account.connected, true);
  assert.equal("accessToken" in signUp.account, false, "public account summary must never carry tokens");
  assert.equal(signUp.email, "melis@example.com", "UI needs the email to display who's signed in");
  assert.equal("email" in signUp.account, false, "email belongs at the response level, not inside the shared account-state shape");

  // 3. getAccountState reflects that without needing another network round-trip.
  const stateAfterSignUp = await call("getAccountState");
  assert.equal(stateAfterSignUp.account.status, "authenticated");
  assert.equal(stateAfterSignUp.cloudReady, true);
  assert.equal(stateAfterSignUp.email, "melis@example.com");

  // 4. The raw session lives in its own storage key, and the exportable
  // tracker state has no trace of it - this is the privacy boundary that
  // matters most here.
  const stored = await local.get(null);
  assert.ok(stored.japaneseImmersionTrackerAccountSessionV1.accessToken, "session key should hold the real token");
  const trackerState = stored.japaneseImmersionTrackerState || {};
  assert.equal(JSON.stringify(trackerState).includes("access-token-1"), false, "tracker state must never contain the access token");
  assert.equal(JSON.stringify(trackerState).includes("refresh-token-1"), false, "tracker state must never contain the refresh token");

  // 5. Sign out clears the session locally even though the mocked logout call succeeds.
  const signOut = await call("cloudSignOut");
  assert.equal(signOut.ok, true);
  assert.equal(signOut.account.status, "guest");
  const afterSignOut = await local.get("japaneseImmersionTrackerAccountSessionV1");
  assert.equal(afterSignOut.japaneseImmersionTrackerAccountSessionV1, undefined);

  // 6. Sign-in: wrong password surfaces a clean error, not a thrown exception.
  const badSignIn = await call("cloudSignIn", { email: "melis@example.com", password: "wrong-password" });
  assert.equal(badSignIn.ok, false);
  assert.equal(badSignIn.error.code, "invalid_credentials");

  // 7. Sign-in: correct password re-authenticates.
  const goodSignIn = await call("cloudSignIn", { email: "melis@example.com", password: "correct-horse-1" });
  assert.equal(goodSignIn.ok, true);
  assert.equal(goodSignIn.account.status, "authenticated");

  // 8. Forgot password: request always reports success (no email enumeration).
  const resetRequest = await call("cloudRequestPasswordReset", { email: "anyone@example.com" });
  assert.equal(resetRequest.ok, true);

  // 9. Forgot password: wrong code is rejected without changing anything.
  const badConfirm = await call("cloudConfirmPasswordReset", { email: "melis@example.com", code: "000000", newPassword: "new-password-1" });
  assert.equal(badConfirm.ok, false);
  assert.equal(badConfirm.error.code, "otp_expired");

  // 10. Forgot password: right code + new password signs the user back in.
  const goodConfirm = await call("cloudConfirmPasswordReset", { email: "melis@example.com", code: "654321", newPassword: "new-password-1" });
  assert.equal(goodConfirm.ok, true);
  assert.equal(goodConfirm.account.status, "authenticated");

  console.log("Cloud auth wiring checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
