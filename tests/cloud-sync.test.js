// Exercises the upload-queue drain path and the three-month sync trial
// clock inside a sandboxed vm context with a mocked chrome.* API and a
// scripted fetch() - same approach as tests/cloud-auth.test.js, extended to
// cover: snapshots getting queued as local tracking data changes, a batch
// actually uploading to tracker_daily_totals, a failed upload being retried
// rather than dropped, the trial gate pausing uploads (while local tracking
// keeps working) once it expires, and a server-side generation bump
// invalidating the local queue/remoteRevisions instead of silently skipping
// re-uploads under the old generation.
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
    _dump: () => ({ ...data }),
    _set: (key, value) => { data[key] = value; }
  };
}

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

// Real setTimeout with the delay forced to 0: this keeps scheduleUploadDrain()
// on the macrotask queue (so it only fires after the update that scheduled it
// has fully finished writing state - matching production ordering) without
// tests actually waiting out the real 4-second coalescing delay.
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
    setTimeout: (fn) => setTimeout(fn, 0),
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

async function waitFor(predicate, { timeout = 2000, interval = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
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

  const session = (overrides = {}) => ({
    access_token: "access-token-1",
    refresh_token: "refresh-token-1",
    expires_in: 3600,
    user: { id: "123e4567-e89b-42d3-a456-426614174000", email: "melis@example.com" },
    ...overrides
  });

  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const profileQuery = new URLSearchParams({ select: "data_generation,plan,pro_expires_at", user_id: `eq.${userId}` }).toString();
  const deviceQuery = new URLSearchParams({ on_conflict: "user_id,device_id" }).toString();
  const totalsQuery = new URLSearchParams({ on_conflict: "user_id,device_id,generation,date_key,language_code,source" }).toString();

  let profileGeneration = 1;
  let uploadedBatches = [];
  let failNextUpload = false;

  const routes = {
    "POST /auth/v1/signup": (body) => ({ status: 200, json: session({ user: { id: userId, email: body.email } }) }),
    [`GET /rest/v1/tracker_profiles?${profileQuery}`]: () => ({ status: 200, json: [{ data_generation: profileGeneration, plan: "beta", pro_expires_at: null }] }),
    [`POST /rest/v1/tracker_devices?${deviceQuery}`]: (body) => ({ status: 201, json: [{ ...body }] }),
    [`POST /rest/v1/tracker_daily_totals?${totalsQuery}`]: (body) => {
      if (failNextUpload) {
        failNextUpload = false;
        return { status: 500, json: { message: "simulated upload failure" } };
      }
      uploadedBatches.push(body);
      return { status: 200, json: [] };
    }
  };

  const { chrome: chromeMock, messageListeners, local } = buildChromeMock();
  const fetchMock = buildFetch({ cloudConfig, routes });
  const context = loadBackground({ chromeMock, fetchMock });
  const state = { messageListeners };
  const call = (type, extra) => dispatch(context, state, type, extra);

  const readTrackerState = async () => (await local.get("japaneseImmersionTrackerState")).japaneseImmersionTrackerState;

  // 1. Signing up registers the device and starts the trial clock - not a
  // separately-clicked "activate sync" step.
  const signUp = await call("cloudSignUp", { email: "melis@example.com", password: "correct-horse-1" });
  assert.equal(signUp.ok, true, JSON.stringify(signUp));

  const accountAfterSignUp = await call("getAccountState");
  assert.equal(accountAfterSignUp.cloud.deviceRegistered, true);
  assert.equal(accountAfterSignUp.trial.active, true);
  assert(accountAfterSignUp.trial.startedAt > 0, "trial should start on first successful device registration");
  assert(accountAfterSignUp.trial.daysRemaining >= 85 && accountAfterSignUp.trial.daysRemaining <= 92,
    `expected ~3 calendar months remaining right after activation, got ${accountAfterSignUp.trial.daysRemaining}`);

  // 2. Logging tracked time queues a privacy-safe snapshot and the queue
  // drains on its own shortly after, with no extra message needed.
  const logged = await call("addCustomImmersion", {
    languageCode: "ja", date: "2026-07-30", source: "reading", action: "Manga", mode: "active", seconds: 600
  });
  assert.equal(logged.ok, true, JSON.stringify(logged));

  await waitFor(async () => (await readTrackerState()).cloud.lastUploadAt > 0);
  assert.equal(uploadedBatches.length, 1, "exactly one batch should have been uploaded");
  const uploadedRow = uploadedBatches[0][0];
  assert.equal(uploadedRow.language_code, "ja");
  assert.equal(uploadedRow.source, "reading");
  assert.equal(uploadedRow.user_id, userId, "rows must be stamped with the signed-in user id before upload");
  assert.equal("title" in uploadedRow, false, "uploaded rows must never carry a readable title");
  assert.equal("action" in uploadedRow, false, "uploaded rows must never carry the manual-entry action/description");

  let trackerState = await readTrackerState();
  assert.deepEqual(trackerState.cloud.queue, {}, "queue should be empty once the batch is confirmed uploaded");
  assert(Object.keys(trackerState.cloud.remoteRevisions).length > 0, "confirmed snapshots should be remembered so they are not re-uploaded");

  // 3. A failed upload is retried, not silently dropped.
  failNextUpload = true;
  const logged2 = await call("addCustomImmersion", {
    languageCode: "ja", date: "2026-07-31", source: "reading", action: "Manga", mode: "active", seconds: 300
  });
  assert.equal(logged2.ok, true, JSON.stringify(logged2));
  await waitFor(async () => Boolean((await readTrackerState()).cloud.lastError));
  trackerState = await readTrackerState();
  const retriedEntry = Object.values(trackerState.cloud.queue)[0];
  assert.ok(retriedEntry, "a failed upload must stay queued for retry, not disappear");
  assert.equal(retriedEntry.attempts, 1);
  assert(retriedEntry.nextAttemptAt > Date.now(), "a failed entry should back off before retrying");
  assert.equal(uploadedBatches.length, 1, "the failed attempt must not be counted as an upload");

  // 4. Once the trial has expired, draining is paused - but local tracking
  // (addCustomImmersion itself, which already succeeded above) is untouched.
  await local._set("japaneseImmersionTrackerState", {
    ...trackerState,
    cloud: { ...trackerState.cloud, trialExpiresAt: Date.now() - 1000 }
  });
  const pausedDrain = await context.drainUploadQueue();
  assert.equal(pausedDrain.ok, false);
  assert.equal(pausedDrain.reason, "trial-expired");
  assert.equal(uploadedBatches.length, 1, "no upload should happen once the trial has expired");

  const stillLogsLocally = await call("addCustomImmersion", {
    languageCode: "ja", date: "2026-08-01", source: "reading", action: "Manga", mode: "active", seconds: 120
  });
  assert.equal(stillLogsLocally.ok, true, "local tracking must keep working after the sync trial ends");

  // 5. A forced drain (e.g. a future manual "sync now") still works even
  // past trial expiry, since the gate is meant to pause automatic syncing,
  // not lock the account out.
  const forced = await context.drainUploadQueue({ force: true });
  assert.equal(forced.ok, true);
  assert(forced.uploaded >= 1);

  // 6. A server-side reset (generation bump) must invalidate the local
  // queue/remoteRevisions instead of leaving them pointing at deleted data.
  trackerState = await readTrackerState();
  assert(Object.keys(trackerState.cloud.remoteRevisions).length > 0);
  profileGeneration = 2;
  const rawSession = (await local.get("japaneseImmersionTrackerAccountSessionV1")).japaneseImmersionTrackerAccountSessionV1;
  await context.registerDevice({
    accessToken: rawSession.accessToken,
    userId: rawSession.userId,
    email: rawSession.email
  });
  trackerState = await readTrackerState();
  assert.equal(trackerState.cloud.generation, 2);
  // The stale generation-1 bookkeeping must be gone, and - since local data
  // still exists and now outranks the (empty) confirmed-remote index - it
  // gets immediately replanned for re-upload under generation 2, rather
  // than staying stuck thinking it was already synced.
  assert.deepEqual(trackerState.cloud.remoteRevisions, {}, "a generation bump must clear stale remote-revision bookkeeping");
  const requeued = Object.values(trackerState.cloud.queue);
  assert(requeued.length > 0, "local data should be replanned for upload once the stale generation is cleared");
  assert(requeued.every((entry) => entry.payload.generation === 2), "replanned uploads must use the new generation, not the stale one");
  assert(trackerState.cloud.trialStartedAt > 0, "an existing trial must not restart on re-registration");

  console.log("Cloud upload-queue and trial-clock checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
