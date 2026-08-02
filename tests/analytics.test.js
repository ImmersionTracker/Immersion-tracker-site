// Two layers, like the cloud-sync split between cloud-auth.test.js (pure
// contract/rest functions) and cloud-sync.test.js (full background.js wiring
// in a sandboxed vm context): first the pure lib/analytics-contract.js and
// lib/analytics-rest.js builders in plain node, then background.js's actual
// consent gate and upload-queue debounce with a mocked chrome.* and fetch().
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const TrackerAnalyticsContract = require(path.join(root, "lib/analytics-contract.js"));
const TrackerAnalyticsRest = require(path.join(root, "lib/analytics-rest.js"));

function testContractBuildsPrivacySafeEvents() {
  const event = TrackerAnalyticsContract.buildEvent({
    languageCode: "ja", sourceName: "YouTube", activeSeconds: 120, passiveSeconds: 30,
    dateKey: "2026-08-02", extensionVersion: "1.9.2"
  });
  assert.equal(event.platform, "youtube");
  assert.equal(event.contentType, "video");
  assert.equal(event.targetLanguage, "ja");

  const row = TrackerAnalyticsContract.toDatabaseRow(event);
  assert.deepEqual(Object.keys(row).sort(), [
    "active_seconds", "content_type", "event_date", "extension_version", "passive_seconds", "platform", "target_language"
  ]);
  assert(TrackerAnalyticsContract.isPrivacySafeRow(row), "a correctly built row must pass its own safety check");

  // Manual entries: the "source" the user picked (e.g. Reading) is not a
  // known video platform, so it becomes the content type instead, and the
  // platform is reported as "manual" since there is no real site involved.
  const manualEvent = TrackerAnalyticsContract.buildEvent({
    languageCode: "ja", sourceName: "Reading", activeSeconds: 600, passiveSeconds: 0,
    dateKey: "2026-08-02", extensionVersion: "1.9.2"
  });
  assert.equal(manualEvent.platform, "manual");
  assert.equal(manualEvent.contentType, "reading");
}

function testContractRejectsUnsafeRows() {
  const base = TrackerAnalyticsContract.toDatabaseRow(TrackerAnalyticsContract.buildEvent({
    languageCode: "ja", sourceName: "netflix", activeSeconds: 10, passiveSeconds: 10,
    dateKey: "2026-08-02", extensionVersion: "1.9.2"
  }));
  assert.equal(TrackerAnalyticsContract.isPrivacySafeRow({ ...base, title: "leaked title" }), false,
    "a row with any extra key must never be considered safe");
  assert.equal(TrackerAnalyticsContract.isPrivacySafeRow({ ...base, user_id: "abc" }), false,
    "an analytics row must never carry a user or device identifier");
  assert.equal(TrackerAnalyticsContract.isPrivacySafeRow({ ...base, active_seconds: -5 }), false);
  assert.equal(TrackerAnalyticsContract.isPrivacySafeRow({ ...base, event_date: "not-a-date" }), false);

  assert.throws(() => TrackerAnalyticsContract.buildEvent({ languageCode: "not-a-language", sourceName: "youtube", dateKey: "2026-08-02", extensionVersion: "1.9.2" }));
  assert.throws(() => TrackerAnalyticsContract.buildEvent({ languageCode: "ja", sourceName: "youtube", dateKey: "not-a-date", extensionVersion: "1.9.2" }));
  assert.throws(() => TrackerAnalyticsContract.buildEvent({ languageCode: "ja", sourceName: "youtube", dateKey: "2026-08-02", extensionVersion: "not-a-version" }));
}

function testPlanEventsOnlyReportsChangedBuckets() {
  const dailyRecords = {
    "2026-08-02|ja|youtube": { dateKey: "2026-08-02", languageCode: "ja", source: "youtube", activeSeconds: 100, passiveSeconds: 20 },
    "2026-08-02|ja|reading": { dateKey: "2026-08-02", languageCode: "ja", source: "reading", activeSeconds: 300, passiveSeconds: 0 }
  };
  const firstPass = TrackerAnalyticsContract.planEvents(dailyRecords, {}, { extensionVersion: "1.9.2" });
  assert.equal(firstPass.length, 2, "every bucket should be planned the first time it is seen");

  const reported = Object.fromEntries(firstPass.map(({ id, signature }) => [id, signature]));
  const secondPass = TrackerAnalyticsContract.planEvents(dailyRecords, reported, { extensionVersion: "1.9.2" });
  assert.equal(secondPass.length, 0, "unchanged buckets must not be replanned");

  dailyRecords["2026-08-02|ja|youtube"] = { ...dailyRecords["2026-08-02|ja|youtube"], activeSeconds: 250 };
  const thirdPass = TrackerAnalyticsContract.planEvents(dailyRecords, reported, { extensionVersion: "1.9.2" });
  assert.equal(thirdPass.length, 1, "only the bucket whose totals moved should be replanned");
  assert.equal(thirdPass[0].event.activeSeconds, 250);
}

function testRestBuildsInsertOnlyRequest() {
  const config = { supabaseUrl: "https://sample.supabase.co", supabaseAnonKey: "anon-key-1" };
  const row = TrackerAnalyticsContract.toDatabaseRow(TrackerAnalyticsContract.buildEvent({
    languageCode: "ja", sourceName: "youtube", activeSeconds: 60, passiveSeconds: 0,
    dateKey: "2026-08-02", extensionVersion: "1.9.2"
  }));
  const request = TrackerAnalyticsRest.buildInsertEventsRequest(config, { rows: [row] });
  assert.equal(request.method, "POST");
  assert(request.url.endsWith("/rest/v1/analytics_events"));
  assert.equal(request.headers.Authorization, "Bearer anon-key-1", "analytics must always use the anon key, never a signed-in user's token");
  assert.equal(request.headers.apikey, "anon-key-1");
  assert.deepEqual(request.body, [row]);
  assert.throws(() => TrackerAnalyticsRest.buildInsertEventsRequest(config, { rows: [] }));
}

// --- Integration: background.js's consent gate and debounced drain ---

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
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    async getBytesInUse() { return Buffer.byteLength(JSON.stringify(data)); },
    setAccessLevel() { return Promise.resolve(); },
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
    getManifest: () => ({ version: "1.9.2" }),
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
    const key = `${method} ${new URL(url).pathname}`;
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

async function runIntegration() {
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

  let uploadedBatches = [];
  const routes = {
    "POST /rest/v1/analytics_events": (body) => { uploadedBatches.push(body); return { status: 200, json: [] }; }
  };

  const { chrome: chromeMock, messageListeners, local } = buildChromeMock();
  const fetchMock = buildFetch({ cloudConfig, routes });
  const context = loadBackground({ chromeMock, fetchMock });
  const state = { messageListeners };
  const call = (type, extra) => dispatch(context, state, type, extra);
  const readTrackerState = async () => (await local.get("japaneseImmersionTrackerState")).japaneseImmersionTrackerState;

  // 1. Consent is off by default - tracking must never send anything.
  const loggedWhileOff = await call("addCustomImmersion", {
    languageCode: "ja", date: "2026-08-02", source: "youtube", action: "", mode: "active", seconds: 300
  });
  assert.equal(loggedWhileOff.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(uploadedBatches.length, 0, "no analytics event may be sent before the user opts in");

  // 2. Turning consent on and then logging more time queues and sends an
  // anonymous event containing only the allowed fields.
  const consentResponse = await call("setPreferences", { preferences: { analyticsConsent: true } });
  assert.equal(consentResponse.ok, true);
  const loggedWhileOn = await call("addCustomImmersion", {
    languageCode: "ja", date: "2026-08-02", source: "youtube", action: "", mode: "active", seconds: 120
  });
  assert.equal(loggedWhileOn.ok, true);

  await waitFor(async () => uploadedBatches.length > 0);
  assert.equal(uploadedBatches.length, 1, "exactly one analytics batch should have been sent");
  const sentRow = uploadedBatches[0][0];
  assert.deepEqual(Object.keys(sentRow).sort(), [
    "active_seconds", "content_type", "event_date", "extension_version", "passive_seconds", "platform", "target_language"
  ]);
  assert.equal(sentRow.target_language, "ja");
  assert.equal(sentRow.platform, "youtube");
  assert.equal(sentRow.content_type, "video");
  assert.equal(sentRow.extension_version, "1.9.2");
  assert.equal("user_id" in sentRow, false);
  assert.equal("device_id" in sentRow, false);
  assert.equal("title" in sentRow, false);

  let trackerState = await readTrackerState();
  assert.deepEqual(trackerState.analytics.queue, {}, "the queue should be empty once the batch is confirmed sent");
  assert(Object.keys(trackerState.analytics.reported).length > 0, "a sent bucket should be remembered so it is not immediately re-sent");

  // 3. Turning consent back off must drop anything still queued, and further
  // tracking must not send anything either.
  await call("setPreferences", { preferences: { analyticsConsent: false } });
  await call("addCustomImmersion", {
    languageCode: "ja", date: "2026-08-03", source: "netflix", action: "", mode: "passive", seconds: 200
  });
  await context.drainAnalyticsQueue();
  assert.equal(uploadedBatches.length, 1, "no further analytics events may be sent once consent is withdrawn");
  trackerState = await readTrackerState();
  assert.deepEqual(trackerState.analytics.queue, {}, "withdrawing consent should drop anything still queued");

  console.log("Analytics consent gate and upload-queue checks passed.");
}

testContractBuildsPrivacySafeEvents();
testContractRejectsUnsafeRows();
testPlanEventsOnlyReportsChangedBuckets();
testRestBuildsInsertOnlyRequest();
console.log("Analytics contract and REST builder checks passed.");

runIntegration().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
