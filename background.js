importScripts(
  "lib/tracker-data.js", "lib/tracker-analytics.js", "lib/entitlements.js",
  "lib/cloud-config.js", "lib/cloud-contract.js", "lib/account-state.js", "lib/supabase-auth.js",
  "lib/supabase-rest.js", "lib/analytics-contract.js", "lib/analytics-rest.js"
);

const LOCAL_STATE_KEY = "japaneseImmersionTrackerState";
const DEVICE_ID_KEY = "japaneseImmersionTrackerDeviceId";
// Raw Supabase session tokens live in their own storage key - deliberately
// never part of `state`, so they can never end up in JSON/CSV exports, Chrome
// Sync, or the canonical-data reconciliation path.
const ACCOUNT_SESSION_KEY = "japaneseImmersionTrackerAccountSessionV1";
const MIGRATION_BACKUP_KEY = "japaneseImmersionTrackerMigrationBackupV8";
const MIGRATION_STAGE_KEY = "japaneseImmersionTrackerMigrationStageV9";
const SYNC_RECORD_PREFIX = "jitRecordV2:";
const SYNC_SOURCE_TOTAL_PREFIX = "jitSourceTotalsV1:";
const SYNC_DECISION_PREFIX = "jitDecisionV2:";
const SYNC_RESET_KEY = "jitResetV2";
const SYNC_GOALS_KEY = "jitGoalsV1";
const SYNC_ALARM = "jitSyncV2";
const MANUAL_ALARM = "jitManualTimerV1";
const HOTKEY_GUIDE_REQUEST_KEY = "jitShowHotkeysRequestedAt";
const DECISION_BUCKETS = 16;
const MAX_CONTENT_DECISIONS_PER_BUCKET = 30;
const MAX_SOURCE_DECISIONS_PER_BUCKET = 30;
const MAX_SOURCE_LEARNING_ENTRIES = 300;
const MAX_LEARNED_CONTENTS_PER_SOURCE = 20;
const SYNC_MONTH_RETENTION = 6;
const STORAGE_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TARGET_LANGUAGE = { code: "ja", name: "Japanese" };
const WEEKLY_REVIEW_ALARM = "litWeeklyReviewV1";
const CLOUD_UPLOAD_ALARM = "jitCloudUploadV1";
// Cloud sync is a separate, optional 3-month trial that starts the first
// time a device successfully registers against Supabase - not at sign-up.
// Local tracking is never gated by this; only the upload queue is.
const CLOUD_TRIAL_MONTHS = 3;
const LANGUAGE_NAMES = {
  auto: "Automatic (Pro)",
  ja: "Japanese", en: "English", sv: "Swedish", es: "Spanish", fr: "French",
  de: "German", it: "Italian", pt: "Portuguese", ko: "Korean", zh: "Chinese",
  ru: "Russian", uk: "Ukrainian", ar: "Arabic", hi: "Hindi", tr: "Turkish",
  pl: "Polish", nl: "Dutch", da: "Danish", no: "Norwegian", fi: "Finnish",
  vi: "Vietnamese", th: "Thai", id: "Indonesian", ms: "Malay",
  tl: "Filipino / Tagalog", el: "Greek", he: "Hebrew", fa: "Persian / Farsi",
  bn: "Bengali", ur: "Urdu", cs: "Czech", ro: "Romanian", hu: "Hungarian",
  bg: "Bulgarian", hr: "Croatian", sr: "Serbian", sk: "Slovak", sl: "Slovenian",
  et: "Estonian", lv: "Latvian", lt: "Lithuanian", is: "Icelandic",
  sw: "Swahili", ca: "Catalan", eu: "Basque", gl: "Galician", cy: "Welsh", ga: "Irish",
  ka: "Georgian", hy: "Armenian", am: "Amharic", km: "Khmer", lo: "Lao",
  my: "Burmese", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam"
};

function normalizeLanguageCode(value) {
  const code = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (code === "auto") return "auto";
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ? code.slice(0, 24) : "ja";
}

function normalizeTargetLanguage(value) {
  const input = typeof value === "string" ? { code: value } : (value || {});
  const code = normalizeLanguageCode(input.code || DEFAULT_TARGET_LANGUAGE.code);
  const canonicalName = LANGUAGE_NAMES[code] || LANGUAGE_NAMES[code.split("-")[0]];
  const name = String(canonicalName || input.name || code.toUpperCase())
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 50);
  return { code, name: name || code.toUpperCase() };
}

function opaqueStorageKey(key) {
  const input = String(key || "");
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  const opaque = (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0");
  return "h:" + opaque;
}

function decisionStorageKey(languageCode, key) {
  return normalizeLanguageCode(languageCode) + "|" + opaqueStorageKey(key);
}

function normalizeDecision(value) {
  if (value === "target" || value === "japanese") return "target";
  if (value === "not-target" || value === "not-japanese") return "not-target";
  return null;
}

function normalizeGoalCountingMode(value) {
  return value === "active" ? "active" : "both";
}

function normalizeGoalDisplayMode(value) {
  return value === "active" || value === "passive" ? value : "both";
}

const emptyState = () => ({
  version: TrackerData.SCHEMA_VERSION,
  records: {},
  languageRecords: {},
  sourceTotals: {},
  dailyRecords: {},
  dailySessionCounts: {},
  sessions: {},
  lastDeletedSession: null,
  notificationState: {},
  manualTimer: null,
  preferences: {
    autoMinimizeEnabled: true,
    autoMinimizeSeconds: 5,
    overlayPosition: null,
    componentOrder: ["session", "calendar-goals", "insights", "manual", "completed", "history"],
    collapsedComponents: {
      session: false,
      "calendar-goals": false,
      insights: true,
      manual: true,
      completed: true,
      history: true
    },
    uiLayoutVersion: 2,
    historyLimit: 5,
    notificationsEnabled: true,
    fullyManualEnabled: false,
    analyticsConsent: false,
    goalCountingMode: "both",
    goalDisplayMode: "both",
    theme: "dark",
    onboardingCompleted: false,
    lastManualSource: "reading",
    lastManualAction: "",
    lastManualMode: "active",
    customManualCategories: [],
    targetLanguage: { ...DEFAULT_TARGET_LANGUAGE },
    targetLanguageDeferred: false,
    languageNames: { ja: "Japanese" },
    goals: {
      daily: { enabled: true, minutes: 360 },
      weekly: { enabled: true, minutes: 900 },
      monthly: { enabled: false, minutes: 3600 },
      yearly: { enabled: false, minutes: 42000 }
    }
  },
  decisions: {
    content: {},
    source: {}
  },
  sourceLearning: {},
  sync: {
    dirtyMonths: {},
    lastSyncedAt: 0,
    lastResetSeen: 0
  },
  maintenance: {
    lastCompactedAt: 0,
    detailCutoffDate: "",
    privacyDecisionMigration: 0
  },
  // Cloud-sync bookkeeping only - never raw tokens (those stay in
  // ACCOUNT_SESSION_KEY, outside this exportable state entirely). Shape
  // matches TrackerCloudContract.createCloudState() plus the trial fields.
  cloud: { ...TrackerCloudContract.createCloudState({}), trialStartedAt: 0, trialExpiresAt: 0 },
  // Optional, consent-based analytics bookkeeping - entirely separate from
  // `cloud` above and gated by its own preferences.analyticsConsent toggle,
  // never by whether the user is signed in or has cloud sync on.
  analytics: TrackerAnalyticsContract.createAnalyticsState({}),
  dataModel: {
    schemaVersion: TrackerData.SCHEMA_VERSION,
    source: "canonical-daily-totals"
  },
  entitlements: TrackerEntitlements.normalize()
});

let stateQueue = Promise.resolve();
let syncQueue = Promise.resolve();
let dashboardCache = { at: 0, languageCode: "", records: null };
let lastStorageWriteError = null;
const liveStatus = {};
let automaticOwnerTabId = null;
const localDataAdapter = new TrackerData.ChromeStorageAdapter(chrome.storage.local, LOCAL_STATE_KEY);
let dataReady = null;

function restrictStorageAccess() {
  try {
    chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => null);
    chrome.storage.sync.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => null);
  } catch {
    // Older Chrome versions may not expose storage access-level controls.
  }
}

restrictStorageAccess();

function chooseAutomaticOwnerTabId() {
  const candidates = Object.entries(liveStatus)
    .filter(([, status]) =>
      status?.languageState === "confirmed" &&
      status?.countingEligible &&
      status?.playing &&
      !status?.trackingPaused &&
      !status?.tabMuted
    )
    .sort((a, b) => {
      if (Boolean(a[1].activeImmersion) !== Boolean(b[1].activeImmersion)) {
        return a[1].activeImmersion ? -1 : 1;
      }
      return (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0);
    });
  const current = candidates.find(([id]) => Number(id) === automaticOwnerTabId);
  if (current?.[1]?.activeImmersion) return automaticOwnerTabId;
  return candidates.length ? Number(candidates[0][0]) : null;
}

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(value) {
  const dateKey = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const timestamp = new Date(dateKey + "T12:00:00").getTime();
  return Number.isFinite(timestamp) && localDateKey(timestamp) === dateKey ? dateKey : "";
}

function normalizeStoredDecisionMap(value) {
  const normalized = {};
  for (const [storedKey, decision] of Object.entries(value || {})) {
    const separator = storedKey.indexOf("|");
    const languageCode = separator > 0 ? storedKey.slice(0, separator) : "ja";
    const rawKey = separator > 0 ? storedKey.slice(separator + 1) : storedKey;
    const key = rawKey.startsWith("h:")
      ? normalizeLanguageCode(languageCode) + "|" + rawKey
      : decisionStorageKey(languageCode, rawKey);
    const safeDecision = normalizeDecision(decision);
    if (safeDecision) normalized[key] = safeDecision;
  }
  return normalized;
}

function normalizeOpaqueDecisionKey(storedKey, fallbackLanguageCode = "ja") {
  const value = String(storedKey || "").trim();
  if (!value) return "";
  const separator = value.indexOf("|");
  const languageCode = separator > 0 ? value.slice(0, separator) : fallbackLanguageCode;
  const rawKey = separator > 0 ? value.slice(separator + 1) : value;
  return rawKey.startsWith("h:")
    ? normalizeLanguageCode(languageCode) + "|" + rawKey
    : decisionStorageKey(languageCode, rawKey);
}

function normalizeStoredSourceLearning(value) {
  const normalized = {};
  for (const [storedSourceKey, entry] of Object.entries(value || {})) {
    const separator = String(storedSourceKey || "").indexOf("|");
    const storedLanguageCode = separator > 0 ? String(storedSourceKey).slice(0, separator) : "ja";
    const languageCode = normalizeLanguageCode(entry?.languageCode || storedLanguageCode);
    const sourceKey = normalizeOpaqueDecisionKey(storedSourceKey, languageCode);
    if (!sourceKey) continue;
    const confirmedContents = Object.fromEntries(
      Object.entries(entry?.confirmedContents || {})
        .map(([storedContentKey, confirmedAt]) => [
          normalizeOpaqueDecisionKey(storedContentKey, languageCode),
          Number(confirmedAt) || Date.now()
        ])
        .filter(([contentKey]) => Boolean(contentKey))
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_LEARNED_CONTENTS_PER_SOURCE)
    );
    if (!Object.keys(confirmedContents).length) continue;
    normalized[sourceKey] = {
      confirmedContents,
      languageCode,
      updatedAt: Math.max(...Object.values(confirmedContents))
    };
  }
  return pruneDecisionEntries(normalized, MAX_SOURCE_LEARNING_ENTRIES);
}

function deriveSourceTotals(languageRecords) {
  const totals = {};
  for (const [languageCode, records] of Object.entries(languageRecords || {})) {
    totals[languageCode] = {};
    for (const record of Object.values(records || {})) {
      for (const [source, values] of Object.entries(record?.sites || {})) {
        totals[languageCode][source] ||= { active: 0, passive: 0 };
        totals[languageCode][source].active += Number(values?.active) || 0;
        totals[languageCode][source].passive += Number(values?.passive) || 0;
      }
    }
  }
  return totals;
}

function pruneSessionHistory(state, limit = 10) {
  const retained = Object.entries(state.sessions || {})
    .sort((a, b) => (Number(b[1]?.lastAt) || 0) - (Number(a[1]?.lastAt) || 0))
    .slice(0, limit);
  state.sessions = Object.fromEntries(retained.map(([id, session]) => {
    const sanitized = { ...session };
    delete sanitized.contentKey;
    return [id, sanitized];
  }));
}

function monthKeyFromDateKey(dateKey) {
  return String(dateKey || "").slice(0, 7);
}

function normalizeState(stored, options = {}) {
  if (!stored || typeof stored !== "object") return emptyState();
  const defaults = emptyState();
  const storedGoals = stored.preferences?.goals || {};
  const legacyRecords = stored.records || {};
  const languageRecords = stored.languageRecords && typeof stored.languageRecords === "object"
    ? stored.languageRecords
    : Object.keys(legacyRecords).length
      ? { ja: legacyRecords }
      : {};
  const sourceTotals = stored.sourceTotals && typeof stored.sourceTotals === "object"
    ? stored.sourceTotals
    : deriveSourceTotals(languageRecords);
  const normalizedSessionsState = { sessions: stored.sessions || {} };
  pruneSessionHistory(normalizedSessionsState);
  const validComponentIds = ["session", "calendar-goals", "insights", "manual", "completed", "history"];
  const oldIdMap = { "session-goals": "session", calendar: "calendar-goals" };
  const migratedOrder = (stored.preferences?.componentOrder || [])
    .map((id) => oldIdMap[id] || id)
    .filter((id, index, items) => validComponentIds.includes(id) && items.indexOf(id) === index);
  const hasCurrentLayout = Number(stored.preferences?.uiLayoutVersion) >= 2;
  const onboardingCompleted = stored.preferences?.onboardingCompleted == null
    ? true
    : stored.preferences.onboardingCompleted === true;
  const normalized = {
    ...defaults,
    version: options.targetVersion || TrackerData.SCHEMA_VERSION,
    records: {},
    languageRecords,
    sourceTotals,
    sessions: normalizedSessionsState.sessions,
    lastDeletedSession: stored.lastDeletedSession || null,
    notificationState: stored.notificationState || {},
    manualTimer: stored.manualTimer ? { ...stored.manualTimer, action: normalizeManualAction(stored.manualTimer.action), languageCode: normalizeLanguageCode(stored.manualTimer.languageCode || "ja") } : null,
    preferences: {
      ...defaults.preferences,
      ...(stored.preferences || {}),
      targetLanguage: normalizeTargetLanguage(stored.preferences?.targetLanguage),
      targetLanguageDeferred: stored.preferences?.targetLanguageDeferred === true ||
        normalizeTargetLanguage(stored.preferences?.targetLanguage).code === "und",
      componentOrder: [
        ...(migratedOrder.length ? migratedOrder : defaults.preferences.componentOrder),
        ...validComponentIds.filter((id) => !migratedOrder.includes(id))
      ].filter((id, index, items) => items.indexOf(id) === index),
      collapsedComponents: hasCurrentLayout &&
        stored.preferences?.collapsedComponents &&
        typeof stored.preferences.collapsedComponents === "object"
          ? Object.fromEntries(validComponentIds.map((id) => [id, stored.preferences.collapsedComponents[id] === true]))
          : { ...defaults.preferences.collapsedComponents },
      uiLayoutVersion: 2,
      historyLimit: Number(stored.preferences?.historyLimit) === 10 ? 10 : 5,
      notificationsEnabled: stored.preferences?.notificationsEnabled !== false,
      fullyManualEnabled: stored.preferences?.fullyManualEnabled === true,
      analyticsConsent: stored.preferences?.analyticsConsent === true,
      goalCountingMode: normalizeGoalCountingMode(stored.preferences?.goalCountingMode),
      goalDisplayMode: normalizeGoalDisplayMode(stored.preferences?.goalDisplayMode),
      theme: stored.preferences?.theme === "light" ? "light" : "dark",
      overlayPosition: stored.preferences?.overlayPosition?.custom === true &&
        Number.isFinite(Number(stored.preferences.overlayPosition.left)) &&
        Number.isFinite(Number(stored.preferences.overlayPosition.top))
          ? {
              custom: true,
              left: Math.max(0, Number(stored.preferences.overlayPosition.left)),
              top: Math.max(0, Number(stored.preferences.overlayPosition.top)),
              viewportWidth: Math.max(0, Number(stored.preferences.overlayPosition.viewportWidth) || 0),
              viewportHeight: Math.max(0, Number(stored.preferences.overlayPosition.viewportHeight) || 0)
            }
          : null,
      onboardingCompleted,
      lastManualAction: normalizeManualAction(stored.preferences?.lastManualAction),
      customManualCategories: normalizeCustomCategories(stored.preferences?.customManualCategories),
      languageNames: {
        ja: "Japanese",
        ...(stored.preferences?.languageNames || {}),
        [normalizeTargetLanguage(stored.preferences?.targetLanguage).code]:
          normalizeTargetLanguage(stored.preferences?.targetLanguage).name
      },
      goals: Object.fromEntries(
        Object.entries(defaults.preferences.goals).map(([period, goal]) => [
          period,
          { ...goal, ...(storedGoals[period] || {}) }
        ])
      )
    },
    decisions: {
      content: normalizeStoredDecisionMap(stored.decisions?.content),
      source: normalizeStoredDecisionMap(stored.decisions?.source)
    },
    sourceLearning: normalizeStoredSourceLearning(stored.sourceLearning),
    sync: {
      ...emptyState().sync,
      ...(stored.sync || {})
    },
    maintenance: {
      ...emptyState().maintenance,
      ...(stored.maintenance || {})
    },
    dataModel: {
      ...emptyState().dataModel,
      ...(stored.dataModel || {})
    },
    cloud: {
      ...TrackerCloudContract.createCloudState(stored.cloud),
      trialStartedAt: Number(stored.cloud?.trialStartedAt) || 0,
      trialExpiresAt: Number(stored.cloud?.trialExpiresAt) || 0
    },
    analytics: TrackerAnalyticsContract.createAnalyticsState(stored.analytics),
    entitlements: TrackerEntitlements.normalize(stored.entitlements)
  };
  if (!options.skipCanonical) {
    normalized.dailyRecords = stored.dailyRecords && typeof stored.dailyRecords === "object"
      ? stored.dailyRecords
      : TrackerData.buildFromLegacy(normalized, { migration: true, deriveSessionCounts: true });
    normalized.dailySessionCounts = stored.dailySessionCounts && typeof stored.dailySessionCounts === "object"
      ? stored.dailySessionCounts
      : Object.fromEntries(Object.entries(normalized.dailyRecords).map(([id, record]) => [
          id, Math.max(0, Math.floor(Number(record?.sessionCount) || 0))
        ]));
  }
  return normalized;
}

function compactOldHistory(state, now = Date.now(), force = false) {
  state.maintenance ||= { lastCompactedAt: 0, detailCutoffDate: "" };
  if (!force && now - (Number(state.maintenance.lastCompactedAt) || 0) < STORAGE_MAINTENANCE_INTERVAL_MS) {
    return { changed: false, cutoffDate: "" };
  }

  let removedSessions = 0;
  const sessionCount = Object.keys(state.sessions || {}).length;
  pruneSessionHistory(state, 10);
  removedSessions = Math.max(0, sessionCount - Object.keys(state.sessions).length);

  state.maintenance.lastCompactedAt = now;
  state.maintenance.detailCutoffDate = "";
  return { changed: Boolean(removedSessions), cutoffDate: "", compactedDays: 0, removedSessions };
}

async function initializeCanonicalData() {
  const raw = await localDataAdapter.read();
  if (!raw) {
    await localDataAdapter.write(emptyState());
    return;
  }

  const alreadyCanonical = Number(raw.version) >= TrackerData.SCHEMA_VERSION &&
    raw.dailyRecords && typeof raw.dailyRecords === "object";
  if (alreadyCanonical) {
    const normalized = normalizeState(raw);
    const differences = TrackerData.diffTotals(normalized, normalized.dailyRecords);
    if (differences.length) throw new Error("Canonical daily totals failed startup verification.");
    const backup = await localDataAdapter.read(MIGRATION_BACKUP_KEY);
    if (backup && normalized.dataModel?.backupRetainedAt) {
      await localDataAdapter.remove(MIGRATION_BACKUP_KEY);
      await localDataAdapter.remove(MIGRATION_STAGE_KEY);
      normalized.dataModel.backupClearedAt = Date.now();
      await localDataAdapter.write(normalized);
    } else if (backup) {
      normalized.dataModel.backupRetainedAt = Date.now();
      await localDataAdapter.write(normalized);
    }
    return;
  }

  const timestamp = Date.now();
  const legacyCopy = normalizeState(raw, {
    targetVersion: Math.max(1, Number(raw.version) || 8),
    skipCanonical: true
  });
  if (!await localDataAdapter.read(MIGRATION_BACKUP_KEY)) {
    await localDataAdapter.write(raw, MIGRATION_BACKUP_KEY);
  }
  const migration = TrackerData.migrate(legacyCopy, timestamp);
  if (!migration.ok) {
    const first = migration.differences[0];
    throw new Error("Daily totals migration dry-run found a mismatch" +
      (first ? ` at ${first.key}: ${JSON.stringify(first.before)} -> ${JSON.stringify(first.after)}` : "") + ".");
  }
  migration.state.entitlements = TrackerEntitlements.normalize(raw.entitlements);
  await localDataAdapter.write(migration.state, MIGRATION_STAGE_KEY);
  const staged = await localDataAdapter.read(MIGRATION_STAGE_KEY);
  const stagedDifferences = TrackerData.diffTotals(legacyCopy, staged?.dailyRecords);
  if (stagedDifferences.length) {
    const first = stagedDifferences[0];
    throw new Error(`Staged daily totals migration failed verification at ${first.key}.`);
  }
  await localDataAdapter.write(staged);
}

async function readState() {
  await dataReady;
  return normalizeState(await localDataAdapter.read());
}

async function writeState(state) {
  await localDataAdapter.write(state);
}

function updateState(mutator) {
  stateQueue = stateQueue.catch(() => null).then(async () => {
    const state = await readState();
    const result = await mutator(state);
    compactOldHistory(state);
    state.entitlements = TrackerEntitlements.normalize(state.entitlements);
    const reconciliation = TrackerData.reconcile(state);
    if (reconciliation.ok) await enqueuePendingCloudSnapshots(state);
    if (reconciliation.ok) enqueuePendingAnalyticsEvents(state);
    if (!reconciliation.ok) {
      console.error("Canonical daily totals divergence", reconciliation.differences.slice(0, 10));
      lastStorageWriteError = {
        at: Date.now(),
        message: "Legacy and canonical daily totals diverged; the update was not saved."
      };
      return {
        ...(result && typeof result === "object" ? result : {}),
        ok: false,
        reason: "canonical-divergence",
        differences: reconciliation.differences.slice(0, 10)
      };
    }
    dashboardCache = { at: 0, languageCode: "", records: null };
    try {
      await writeState(state);
      lastStorageWriteError = null;
      return result;
    } catch (error) {
      lastStorageWriteError = {
        at: Date.now(),
        message: String(error?.message || "Chrome rejected the local storage write.").slice(0, 200)
      };
      return {
        ...(result && typeof result === "object" ? result : {}),
        ok: false,
        reason: "storage-write-failed",
        storageWriteFailed: true
      };
    }
  });
  return stateQueue;
}

dataReady = initializeCanonicalData().catch((error) => {
  lastStorageWriteError = {
    at: Date.now(),
    message: String(error?.message || "Daily totals initialization failed.").slice(0, 200)
  };
  throw error;
});

let cachedDeviceId = "";

async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  const result = await chrome.storage.local.get(DEVICE_ID_KEY);
  if (result[DEVICE_ID_KEY]) {
    cachedDeviceId = result[DEVICE_ID_KEY];
    return cachedDeviceId;
  }
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  cachedDeviceId = id;
  return id;
}

function recordsForLanguage(state, languageCode) {
  const code = normalizeLanguageCode(languageCode || state.preferences?.targetLanguage?.code);
  state.languageRecords ||= {};
  state.languageRecords[code] ||= {};
  return state.languageRecords[code];
}

function ensureRecord(state, dateKey, site, languageCode) {
  const records = recordsForLanguage(state, languageCode);
  records[dateKey] ||= { active: 0, passive: 0, sites: {} };
  records[dateKey].sites ||= {};
  records[dateKey].sites[site] ||= { active: 0, passive: 0 };
  return records[dateKey];
}

function ensureSourceTotal(state, site, languageCode) {
  const code = normalizeLanguageCode(languageCode || state.preferences?.targetLanguage?.code);
  const source = normalizeManualSource(site);
  state.sourceTotals ||= {};
  state.sourceTotals[code] ||= {};
  state.sourceTotals[code][source] ||= { active: 0, passive: 0 };
  return state.sourceTotals[code][source];
}

function markMonthDirty(state, dateKey) {
  const month = monthKeyFromDateKey(dateKey);
  if (month) state.sync.dirtyMonths[month] = Date.now();
}

function clampSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, 180);
}

function clampManualSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, 7 * 24 * 60 * 60);
}

function normalizeManualSource(value) {
  const source = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  return source || "other";
}

function normalizeManualAction(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
}

function normalizeCustomCategories(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeManualSource)
    .filter((item) => item !== "other")
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 30);
}

function normalizeManualMode(value) {
  return value === "passive" ? "passive" : "active";
}

function addManualSeconds(state, { source, mode, seconds, timestamp = Date.now(), languageCode }) {
  // No target language chosen yet ("Set up later" stores the und placeholder).
  // Automatic tracking already refuses in this state; the manual paths did not,
  // so manual timers and entries were creating a real "Choose a language" bucket
  // that then appeared in totals, History, the calendar and CSV exports.
  if (state.preferences?.targetLanguageDeferred === true
    || state.preferences?.targetLanguage?.code === "und") return 0;
  const safeSeconds = clampManualSeconds(seconds);
  if (!safeSeconds) return 0;
  const safeSource = normalizeManualSource(source);
  const safeMode = normalizeManualMode(mode);
  const dateKey = localDateKey(timestamp);
  const record = ensureRecord(state, dateKey, safeSource, languageCode);
  record[safeMode] += safeSeconds;
  record.sites[safeSource][safeMode] += safeSeconds;
  ensureSourceTotal(state, safeSource, languageCode)[safeMode] += safeSeconds;
  markMonthDirty(state, dateKey);
  return safeSeconds;
}

function addSessionDelta(state, sessionId, details) {
  if (!sessionId) return;
  const dateKey = details.dateKey || localDateKey(details.timestamp || Date.now());
  const active = Math.max(0, Number(details.active) || 0);
  const passive = Math.max(0, Number(details.passive) || 0);
  state.sessions[sessionId] ||= {
    kind: details.kind || "video",
    site: normalizeManualSource(details.site || "other"),
    languageCode: normalizeLanguageCode(details.languageCode),
    title: details.title || "Immersion session",
    startedAt: details.startedAt || details.timestamp || Date.now(),
    lastAt: Date.now(),
    byDate: {}
  };
  const session = state.sessions[sessionId];
  session.kind ||= details.kind || "video";
  session.languageCode = normalizeLanguageCode(session.languageCode || details.languageCode);
  session.site = normalizeManualSource(details.site || session.site);
  session.title = String(details.title || session.title || "Immersion session").slice(0, 160);
  session.lastAt = Date.now();
  session.byDate ||= {};
  const firstContributionForDate = !session.byDate[dateKey];
  session.byDate[dateKey] ||= { active: 0, passive: 0 };
  session.byDate[dateKey].active += active;
  session.byDate[dateKey].passive += passive;
  if (firstContributionForDate && (active || passive)) {
    TrackerData.adjustSessionCount(state, {
      dateKey,
      languageCode: session.languageCode,
      source: session.site
    }, 1);
  }
  pruneSessionHistory(state, 10);
}

function applySessionContribution(state, session, multiplier) {
  for (const [dateKey, contribution] of Object.entries(session?.byDate || {})) {
    const code = normalizeLanguageCode(session.languageCode || "ja");
    const site = normalizeManualSource(session.site);
    const record = multiplier > 0
      ? ensureRecord(state, dateKey, site, code)
      : state.languageRecords?.[code]?.[dateKey];
    if (!record) continue;
    const active = (Number(contribution.active) || 0) * multiplier;
    const passive = (Number(contribution.passive) || 0) * multiplier;
    record.active = Math.max(0, (Number(record.active) || 0) + active);
    record.passive = Math.max(0, (Number(record.passive) || 0) + passive);
    if (record.sites?.[site]) {
      record.sites[site].active = Math.max(0, (Number(record.sites[site].active) || 0) + active);
      record.sites[site].passive = Math.max(0, (Number(record.sites[site].passive) || 0) + passive);
      if (!record.sites[site].active && !record.sites[site].passive) delete record.sites[site];
    }
    const sourceTotal = ensureSourceTotal(state, site, code);
    sourceTotal.active = Math.max(0, (Number(sourceTotal.active) || 0) + active);
    sourceTotal.passive = Math.max(0, (Number(sourceTotal.passive) || 0) + passive);
    TrackerData.adjustSessionCount(state, { dateKey, languageCode: code, source: site }, multiplier);
    markMonthDirty(state, dateKey);
  }
}

function periodDateKeys(period, now = new Date()) {
  if (period === "daily") return [localDateKey(now)];
  const keys = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "weekly") {
    start.setDate(start.getDate() - (start.getDay() === 0 ? 6 : start.getDay() - 1));
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      keys.push(localDateKey(day));
    }
  } else {
    const prefix = period === "monthly"
      ? localDateKey(now).slice(0, 7) + "-"
      : String(now.getFullYear()) + "-";
    keys.push(prefix);
  }
  return keys;
}

function totalForPeriod(records, period, goalCountingMode = "both") {
  const keys = periodDateKeys(period);
  const prefixMode = period === "monthly" || period === "yearly";
  const activeOnly = normalizeGoalCountingMode(goalCountingMode) === "active";
  return Object.entries(records || {}).reduce((total, [dateKey, record]) => {
    const included = prefixMode ? dateKey.startsWith(keys[0]) : keys.includes(dateKey);
    if (!included) return total;
    return total + (Number(record.active) || 0) + (activeOnly ? 0 : (Number(record.passive) || 0));
  }, 0);
}

async function notifyGoalCompletions(languageCode) {
  const notifications = [];
  await updateState((state) => {
    if (state.preferences.notificationsEnabled === false) return;
    const code = normalizeLanguageCode(languageCode || state.preferences.targetLanguage.code);
    const languageName = state.preferences.languageNames?.[code] || LANGUAGE_NAMES[code] || code.toUpperCase();
    const records = state.languageRecords?.[code] || {};
    for (const period of ["daily", "weekly", "monthly", "yearly"]) {
      const goal = state.preferences.goals?.[period];
      if (!goal?.enabled) continue;
      const stamp = period === "daily" ? localDateKey() :
        period === "weekly" ? periodDateKeys("weekly")[0] :
        period === "monthly" ? localDateKey().slice(0, 7) : String(new Date().getFullYear());
      const notificationKey = code + "|" + period + "|" + stamp;
      if (totalForPeriod(records, period, state.preferences.goalCountingMode) >= Number(goal.minutes) * 60 && !state.notificationState[notificationKey]) {
        state.notificationState[notificationKey] = Date.now();
        notifications.push({
          period,
          languageName,
          minutes: goal.minutes,
          activeOnly: state.preferences.goalCountingMode === "active"
        });
      }
    }
  });
  for (const item of notifications) {
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: item.period[0].toUpperCase() + item.period.slice(1) + " goal complete",
        message: item.languageName + ": " + item.minutes +
          (item.activeOnly ? " active minutes reached." : " minutes reached.")
      });
    } catch {
      // Notifications can be unavailable in managed browser profiles.
    }
  }
}

function nextWeeklyReviewAt() {
  const now = new Date();
  const next = new Date(now);
  const days = (7 - now.getDay()) % 7;
  next.setDate(now.getDate() + days);
  next.setHours(20, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7);
  return next.getTime();
}

async function showWeeklyReview() {
  const state = await readState();
  if (state.preferences.notificationsEnabled === false) return;
  const code = state.preferences.targetLanguage.code;
  const name = state.preferences.targetLanguage.name;
  const seconds = totalForPeriod(
    state.languageRecords?.[code] || {},
    "weekly",
    state.preferences.goalCountingMode
  );
  const goal = Number(state.preferences.goals?.weekly?.minutes) || 900;
  const countingLabel = state.preferences.goalCountingMode === "active" ? "active minutes" : "minutes";
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: name + " weekly review",
      message: Math.round(seconds / 60) + " / " + goal + " " + countingLabel + " this week."
    });
  } catch {
    // Notifications can be unavailable in managed browser profiles.
  }
}

function manualTimerSnapshot(timer, now = Date.now()) {
  if (!timer) return null;
  const uncommittedSeconds = timer.running
    ? Math.max(0, (now - (Number(timer.lastCheckpointAt) || now)) / 1000)
    : 0;
  return {
    ...timer,
    committedSeconds: Number(timer.committedSeconds) || 0,
    uncommittedSeconds,
    elapsedSeconds: (Number(timer.committedSeconds) || 0) + uncommittedSeconds
  };
}

function manualTimeSegments(startTimestamp, endTimestamp) {
  const segments = [];
  let cursor = Math.max(0, Number(startTimestamp) || 0);
  const end = Math.max(cursor, Number(endTimestamp) || cursor);
  while (cursor < end) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(end, nextMidnight.getTime());
    segments.push({
      dateKey: localDateKey(cursor),
      timestamp: cursor,
      seconds: Math.max(0, (segmentEnd - cursor) / 1000)
    });
    cursor = segmentEnd;
  }
  return segments;
}

function checkpointManualTimer({ stop = false } = {}) {
  const now = Date.now();
  return updateState((state) => {
    const timer = state.manualTimer;
    if (!timer?.running) return { ok: true, timer: manualTimerSnapshot(timer, now) };
    let added = 0;
    for (const segment of manualTimeSegments(Number(timer.lastCheckpointAt) || now, now)) {
      const segmentAdded = addManualSeconds(state, {
        source: timer.source,
        mode: timer.mode,
        seconds: segment.seconds,
        timestamp: segment.timestamp,
        languageCode: timer.languageCode
      });
      added += segmentAdded;
      addSessionDelta(state, timer.id, {
        kind: "manual",
        site: timer.source,
        title: normalizeManualAction(timer.action) || timer.source + " manual immersion",
        languageCode: timer.languageCode,
        dateKey: segment.dateKey,
        active: timer.mode === "active" ? segmentAdded : 0,
        passive: timer.mode === "passive" ? segmentAdded : 0,
        startedAt: timer.startedAt
      });
    }
    timer.committedSeconds = (Number(timer.committedSeconds) || 0) + added;
    timer.lastCheckpointAt = now;
    if (stop) {
      timer.running = false;
      timer.stoppedAt = now;
    }
    return { ok: true, timer: manualTimerSnapshot(timer, now) };
  });
}

async function broadcastOverlayPreferences(preferences) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://www.youtube.com/*",
        "https://youtube.com/*",
        "https://www.netflix.com/*",
        "https://www.disneyplus.com/*",
        "https://www.primevideo.com/*",
        "https://www.amazon.com/gp/video/*",
        "https://www.amazon.co.uk/gp/video/*",
        "https://www.amazon.ca/gp/video/*",
        "https://www.amazon.de/gp/video/*",
        "https://www.amazon.co.jp/gp/video/*",
        "https://www.amazon.fr/gp/video/*",
        "https://www.amazon.it/gp/video/*",
        "https://www.amazon.es/gp/video/*",
        "https://www.hulu.com/*",
        "https://play.max.com/*",
        "https://tv.apple.com/*",
        "https://www.paramountplus.com/*",
        "https://www.peacocktv.com/*",
        "https://www.crunchyroll.com/*",
        "https://www.hidive.com/*",
        "https://tubitv.com/*"
      ]
    });
    await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, {
      type: "overlayPreferencesChanged",
      preferences
    }).catch(() => null)));
  } catch {
    // Supported tabs will fetch the preferences on their next reload.
  }
}

function hashBucket(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % DECISION_BUCKETS;
}

function decisionSyncKey(scope, key) {
  return `${SYNC_DECISION_PREFIX}${scope}:${hashBucket(key)}`;
}

function recordSyncKey(deviceId, month) {
  return `${SYNC_RECORD_PREFIX}${deviceId}:${month}`;
}

function sourceTotalSyncKey(deviceId) {
  return `${SYNC_SOURCE_TOTAL_PREFIX}${deviceId}`;
}


function recentMonthKeys(count = SYNC_MONTH_RETENTION) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function extractMonthRecords(records, month) {
  return Object.fromEntries(
    Object.entries(records || {}).filter(([dateKey]) => dateKey.startsWith(month + "-"))
  );
}

function extractMonthLanguageRecords(languageRecords, month) {
  return Object.fromEntries(
    Object.entries(languageRecords || {})
      .map(([languageCode, records]) => [languageCode, extractMonthRecords(records, month)])
      .filter(([, records]) => Object.keys(records).length)
  );
}

function pruneDecisionEntries(entries, maxEntries) {
  const ordered = Object.entries(entries || {}).sort(
    (a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0)
  );
  return Object.fromEntries(ordered.slice(0, maxEntries));
}

async function readSyncedDecision(scope, key) {
  if (!key) return null;
  try {
    const syncKey = decisionSyncKey(scope, key);
    const result = await chrome.storage.sync.get(syncKey);
    const entry = result[syncKey]?.entries?.[key];
    return entry?.decision || null;
  } catch {
    return null;
  }
}

async function writeSyncedDecision(scope, key, decision) {
  if (!key) return;
  const syncKey = decisionSyncKey(scope, key);
  try {
    const result = await chrome.storage.sync.get(syncKey);
    const current = result[syncKey] || { version: 2, scope, entries: {} };
    current.entries ||= {};
    current.entries[key] = { decision, updatedAt: Date.now() };
    const maxEntries = scope === "source"
      ? MAX_SOURCE_DECISIONS_PER_BUCKET
      : MAX_CONTENT_DECISIONS_PER_BUCKET;
    current.entries = pruneDecisionEntries(current.entries, maxEntries);
    current.updatedAt = Date.now();
    await chrome.storage.sync.set({ [syncKey]: current });
  } catch {
    // Local decisions remain authoritative on this device if sync is unavailable.
  }
}

async function flushDirtyMonths({ force = false } = {}) {
  syncQueue = syncQueue.then(async () => {
    const deviceId = await getDeviceId();
    const state = await readState();
    const retainedMonths = new Set(recentMonthKeys());
    const allDirtyMonths = Object.keys(state.sync.dirtyMonths || {});
    const months = allDirtyMonths.filter((month) => retainedMonths.has(month));
    if (!allDirtyMonths.length && !force) return { ok: true, synced: 0, skipped: true };

    const payload = {};
    for (const month of months) {
      payload[recordSyncKey(deviceId, month)] = {
        version: 3,
        deviceId,
        month,
        updatedAt: Date.now(),
        languageRecords: extractMonthLanguageRecords(state.languageRecords, month),
        records: extractMonthRecords(state.records, month)
      };
    }
    payload[sourceTotalSyncKey(deviceId)] = {
      version: 1,
      deviceId,
      updatedAt: Date.now(),
      sourceTotals: state.sourceTotals || {}
    };

    try {
      if (Object.keys(payload).length) await chrome.storage.sync.set(payload);

      const allSync = await chrome.storage.sync.get(null);
      const staleKeys = Object.keys(allSync).filter((key) => {
        if (!key.startsWith(`${SYNC_RECORD_PREFIX}${deviceId}:`)) return false;
        const month = key.slice(`${SYNC_RECORD_PREFIX}${deviceId}:`.length);
        return !retainedMonths.has(month);
      });
      if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);

      const saved = await updateState((latest) => {
        for (const month of allDirtyMonths) delete latest.sync.dirtyMonths[month];
        const lastSyncedAt = Date.now();
        latest.sync.lastSyncedAt = lastSyncedAt;
        return { ok: true, lastSyncedAt };
      });
      if (!saved?.ok) return { ok: false, synced: months.length, reason: saved?.reason || "local-save-failed" };
      return { ok: true, synced: months.length, sourceTotalsSynced: true, lastSyncedAt: saved.lastSyncedAt };
    } catch {
      return { ok: false, synced: 0, reason: "chrome-sync-unavailable" };
    }
  });
  return syncQueue;
}

function mergeRecordInto(target, dateKey, record) {
  target[dateKey] ||= { active: 0, passive: 0, sites: {} };
  target[dateKey].active += Number(record?.active) || 0;
  target[dateKey].passive += Number(record?.passive) || 0;
  for (const [site, values] of Object.entries(record?.sites || {})) {
    target[dateKey].sites[site] ||= { active: 0, passive: 0 };
    target[dateKey].sites[site].active += Number(values?.active) || 0;
    target[dateKey].sites[site].passive += Number(values?.passive) || 0;
  }
}

async function getCombinedRecords(localState, deviceId, languageCode) {
  const code = normalizeLanguageCode(languageCode);
  if (
    dashboardCache.records &&
    dashboardCache.languageCode === code &&
    Date.now() - dashboardCache.at < 8000
  ) {
    return dashboardCache.records;
  }

  const combined = {};
  try {
    const allSync = await chrome.storage.sync.get(null);
    for (const [key, item] of Object.entries(allSync)) {
      if (!key.startsWith(SYNC_RECORD_PREFIX)) continue;
      if (!item || item.deviceId === deviceId) continue;
      const remoteRecords = item.languageRecords?.[code] || (code === "ja" ? item.records : null) || {};
      for (const [dateKey, record] of Object.entries(remoteRecords)) {
        mergeRecordInto(combined, dateKey, record);
      }
    }
  } catch {
    // Continue with local records only.
  }

  const localRecords = localState.languageRecords?.[code] ||
    (code === "ja" ? localState.records : null) || {};
  for (const [dateKey, record] of Object.entries(localRecords)) {
    mergeRecordInto(combined, dateKey, record);
  }

  dashboardCache = { at: Date.now(), languageCode: code, records: combined };
  return combined;
}

async function getCombinedSourceTotals(localState, deviceId, languageCode) {
  const code = normalizeLanguageCode(languageCode);
  const combined = {};
  const merge = (totals) => {
    for (const [source, values] of Object.entries(totals || {})) {
      combined[source] ||= { active: 0, passive: 0 };
      combined[source].active += Number(values?.active) || 0;
      combined[source].passive += Number(values?.passive) || 0;
    }
  };
  try {
    const allSync = await chrome.storage.sync.get(null);
    for (const [key, item] of Object.entries(allSync)) {
      if (!key.startsWith(SYNC_SOURCE_TOTAL_PREFIX) || item?.deviceId === deviceId) continue;
      merge(item?.sourceTotals?.[code]);
    }
  } catch {
    // Local cumulative source totals remain available if Sync cannot be read.
  }
  merge(localState.sourceTotals?.[code]);
  return combined;
}

async function isTabActivelyViewed(tabId, status = {}) {
  if (!tabId) return false;
  const pageVisible = status?.pageVisible !== false;
  const pageFocused = status?.pageFocused === true;
  try {
    const tab = await chrome.tabs.get(tabId);
    const windowInfo = await chrome.windows.get(tab.windowId);
    // Chrome's selected-tab and focused-window state is authoritative. Some
    // players (notably YouTube in fullscreen) briefly report the document as
    // hidden or unfocused even though the user is still actively viewing it.
    // Page signals remain a fallback for transient Chrome focus inaccuracies.
    return Boolean(tab.active && (windowInfo.focused || (pageVisible && pageFocused)));
  } catch {
    return Boolean(pageVisible && pageFocused);
  }
}

function computeStatusState(status, activeImmersion) {
  if (status?.languageState === "awaiting" && status?.playing) return "awaiting";
  if (
    status?.languageState === "confirmed" &&
    status?.countingEligible &&
    !status?.trackingPaused
  ) {
    return activeImmersion ? "recording-active" : "recording-passive";
  }
  return "stopped";
}

async function setBadge(tabId, status) {
  if (!tabId) return;

  let text = "";
  let color = "#475569";
  if (status === "recording-active") {
    text = "A";
    color = "#16a34a";
  } else if (status === "recording-passive") {
    text = "P";
    color = "#f59e0b";
  } else if (status === "awaiting") {
    text = "?";
    color = "#d97706";
  }

  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    // The tab may have closed.
  }
}

async function refreshTabContext(tabId) {
  const key = String(tabId);
  const existing = liveStatus[key];
  if (!existing) return;
  const activeImmersion = await isTabActivelyViewed(tabId, existing);
  const state = computeStatusState(existing, activeImmersion);
  liveStatus[key] = { ...existing, state, activeImmersion, updatedAt: Date.now() };
  await setBadge(tabId, state);
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "browserContextChanged",
      activeImmersion,
      computedState: state
    });
  } catch {
    // The content script may not be available yet.
  }
}

async function refreshAllTabContexts() {
  await Promise.all(Object.keys(liveStatus).map((id) => refreshTabContext(Number(id))));
  automaticOwnerTabId = chooseAutomaticOwnerTabId();
}

async function applyRemoteReset(resetAt) {
  if (!resetAt) return;
  await updateState((state) => {
    if ((Number(state.sync.lastResetSeen) || 0) >= resetAt) return;
    const fresh = emptyState();
    fresh.sync.lastResetSeen = resetAt;
    Object.assign(state, fresh);
  });
  for (const key of Object.keys(liveStatus)) delete liveStatus[key];
  automaticOwnerTabId = null;
}

async function checkRemoteReset() {
  try {
    const result = await chrome.storage.sync.get(SYNC_RESET_KEY);
    const resetAt = Number(result[SYNC_RESET_KEY]?.resetAt) || 0;
    if (resetAt) await applyRemoteReset(resetAt);
  } catch {
    // Sync may be unavailable.
  }
}

async function clearReadableSyncedDecisionHistory() {
  try {
    const state = await readState();
    if (Number(state.maintenance?.privacyDecisionMigration) >= 1) return;
    const allSync = await chrome.storage.sync.get(null);
    const decisionKeys = Object.keys(allSync).filter((key) => key.startsWith(SYNC_DECISION_PREFIX));
    if (decisionKeys.length) await chrome.storage.sync.remove(decisionKeys);
    await updateState((latest) => {
      latest.maintenance.privacyDecisionMigration = 1;
      return { ok: true };
    });
  } catch {
    // Local hashed decisions continue to work when Sync is unavailable.
  }
}

function ensureSyncAlarm() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(MANUAL_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(WEEKLY_REVIEW_ALARM, { when: nextWeeklyReviewAt(), periodInMinutes: 7 * 24 * 60 });
  chrome.alarms.create(CLOUD_UPLOAD_ALARM, { periodInMinutes: 3 });
  try {
    chrome.idle.setDetectionInterval(60);
  } catch {
    // Idle detection is a safeguard; the manual controls still work without it.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSyncAlarm();
  checkRemoteReset();
  clearReadableSyncedDecisionHistory();
});

chrome.runtime.onStartup.addListener(() => {
  ensureSyncAlarm();
  checkRemoteReset();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) flushDirtyMonths();
  if (alarm.name === MANUAL_ALARM) {
    checkpointManualTimer().then((result) => result?.timer?.languageCode && notifyGoalCompletions(result.timer.languageCode));
  }
  if (alarm.name === WEEKLY_REVIEW_ALARM) showWeeklyReview();
  if (alarm.name === CLOUD_UPLOAD_ALARM) drainUploadQueue().catch(() => null);
});

chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === "idle" || newState === "locked") {
    checkpointManualTimer({ stop: true });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes[SYNC_RESET_KEY]?.newValue?.resetAt) {
    applyRemoteReset(Number(changes[SYNC_RESET_KEY].newValue.resetAt));
  }
  dashboardCache = { at: 0, languageCode: "", records: null };
});

let cloudConfigCache = null;

async function getCloudConfig() {
  if (cloudConfigCache) return cloudConfigCache;
  try {
    const response = await fetch(chrome.runtime.getURL("config/cloud-config.json"));
    const raw = await response.json();
    cloudConfigCache = TrackerCloudConfig.normalize(raw);
  } catch {
    // No untracked config/cloud-config.json in this build (e.g. a fresh
    // checkout without dev credentials filled in) - fail closed, not open.
    cloudConfigCache = TrackerCloudConfig.disabled();
  }
  return cloudConfigCache;
}

async function getAccountSession() {
  const result = await chrome.storage.local.get(ACCOUNT_SESSION_KEY);
  const session = result[ACCOUNT_SESSION_KEY];
  return session && typeof session === "object" ? session : null;
}

async function setAccountSession(session) {
  await chrome.storage.local.set({ [ACCOUNT_SESSION_KEY]: session });
}

async function clearAccountSession() {
  await chrome.storage.local.remove(ACCOUNT_SESSION_KEY);
}

function accountStateFromSession(session) {
  if (!session) return TrackerAccountState.guest();
  return TrackerAccountState.normalize({
    status: "authenticated",
    provider: "supabase",
    userId: session.userId,
    sessionExpiresAt: session.expiresAt,
    lastAuthenticatedAt: session.authenticatedAt
  });
}

async function fetchJson(request) {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" ? undefined : JSON.stringify(request.body || {})
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

// Returns a session with a still-valid access token, transparently
// refreshing it against Supabase if it has expired or is about to. Used by
// the (later) device-registration and upload-queue paths, which need a
// live bearer token rather than just a status readout.
async function ensureFreshSession() {
  const session = await getAccountSession();
  if (!session) return null;
  const account = accountStateFromSession(session);
  if (account.status === "authenticated" && Number(session.expiresAt) - Date.now() > 60000) return session;
  if (!session.refreshToken) {
    await clearAccountSession();
    return null;
  }
  const config = await getCloudConfig();
  if (!config.enabled) return null;
  try {
    const { ok, json } = await fetchJson(TrackerSupabaseAuth.buildRefreshRequest(config, { refreshToken: session.refreshToken }));
    if (!ok) {
      await clearAccountSession();
      return null;
    }
    const refreshed = TrackerSupabaseAuth.parseSession(json);
    if (!refreshed) {
      await clearAccountSession();
      return null;
    }
    await setAccountSession(refreshed);
    return refreshed;
  } catch {
    // Offline or Supabase unreachable: keep using the existing session until
    // it actually expires rather than signing the device out over a blip.
    return Number(session.expiresAt) > Date.now() ? session : null;
  }
}

// Registers (or re-registers) this device against tracker_devices. Safe to
// call repeatedly - it's a plain upsert keyed on (user_id, device_id), so
// running it again just refreshes last_seen_at and, after a remote reset,
// moves the device onto the new data_generation. Never throws; failures are
// reported in the return value so callers (sign-in, sign-up, the upload
// queue) can decide whether to surface or silently retry later.
async function recordCloudError(reason) {
  await updateState((state) => {
    state.cloud.lastError = String(reason || "").slice(0, 180);
    return { ok: true };
  });
  return { ok: false, reason };
}

async function registerDevice(session) {
  if (!session?.accessToken || !session?.userId) return { ok: false, reason: "no-session" };
  const config = await getCloudConfig();
  if (!config.enabled) return { ok: false, reason: "cloud-disabled" };
  try {
    const profileResponse = await fetchJson(TrackerSupabaseRest.buildGetProfileRequest(config, {
      accessToken: session.accessToken,
      userId: session.userId
    }));
    const profile = profileResponse.ok ? TrackerSupabaseRest.parseProfile(profileResponse.json) : null;
    if (!profile) return recordCloudError("profile-unavailable");

    const deviceId = await getDeviceId();
    const deviceResponse = await fetchJson(TrackerSupabaseRest.buildUpsertDeviceRequest(config, {
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId,
      generation: profile.generation
    }));
    if (!deviceResponse.ok) return recordCloudError("device-upsert-failed");

    const now = Date.now();
    await updateState((state) => {
      // A generation bump (from a server-side reset on any device) means
      // every previously-queued or previously-confirmed snapshot refers to
      // data that no longer exists remotely. Drop that bookkeeping so the
      // next drain re-plans uploads from scratch under the new generation,
      // instead of silently skipping rows it thinks are already synced.
      const generationChanged = state.cloud.deviceRegistered && state.cloud.generation !== profile.generation;
      state.cloud.deviceRegistered = true;
      state.cloud.generation = profile.generation;
      state.cloud.lastError = "";
      if (generationChanged) {
        state.cloud.queue = {};
        state.cloud.remoteRevisions = {};
      }
      if (!state.cloud.trialStartedAt) {
        state.cloud.trialStartedAt = now;
        state.cloud.trialExpiresAt = addUtcMonths(now, CLOUD_TRIAL_MONTHS);
      }
      return { ok: true };
    });
    scheduleUploadDrain();
    return { ok: true, generation: profile.generation };
  } catch (error) {
    return recordCloudError(String(error?.message || "network-error").slice(0, 180));
  }
}

function addUtcMonths(ms, months) {
  const date = new Date(Number(ms) || Date.now());
  date.setUTCMonth(date.getUTCMonth() + Math.round(Number(months) || 0));
  return date.getTime();
}

// Whether the free cloud-sync trial is still open. Undefined/zero trial
// fields mean sync has never been activated on this account, which reads as
// "not active" rather than "active forever" - callers that need to
// distinguish "never started" from "expired" should check trialStartedAt.
function cloudTrialActive(cloud, now = Date.now()) {
  const expiresAt = Number(cloud?.trialExpiresAt) || 0;
  return expiresAt > 0 && now < expiresAt;
}

// Runs after every successful state write. Cheap no-op for the common case
// (no cloud account, or nothing changed) - it only does work once a device
// is registered, and planUploads() itself only returns snapshots whose
// revision has moved past what the server last confirmed.
async function enqueuePendingCloudSnapshots(state) {
  if (!state.cloud?.deviceRegistered || !(Number(state.cloud.generation) > 0)) return;
  const deviceId = await getDeviceId();
  const snapshots = TrackerCloudContract.planUploads(state.dailyRecords, state.cloud.remoteRevisions, {
    deviceId,
    generation: state.cloud.generation
  });
  if (!snapshots.length) return;
  // planUploads() recomputes "what's pending" from scratch every time this
  // runs (i.e. on every state update, not just ones that touched
  // dailyRecords), based only on confirmed remote revisions. Without this
  // filter, mergeQueue() would re-arm every still-pending entry back to
  // attempts:0/nextAttemptAt:now on each call, permanently erasing retry
  // backoff for anything that failed to upload. Only re-merge snapshots
  // whose payload actually changed since they were queued.
  const changed = snapshots.filter((snapshot) => {
    const existing = state.cloud.queue[snapshot.snapshotId];
    return !existing || Number(existing.payload?.revision) !== snapshot.revision;
  });
  if (!changed.length) return;
  state.cloud.queue = TrackerCloudContract.mergeQueue(state.cloud.queue, changed, Date.now());
  scheduleUploadDrain();
}

// Purely local bookkeeping: compares the canonical daily records against
// what analytics has already reported and queues only the buckets whose
// totals moved. Never touches the network itself - scheduleAnalyticsDrain()
// does that, separately and on its own timer, so this stays cheap enough to
// call on every state update the way enqueuePendingCloudSnapshots does.
function enqueuePendingAnalyticsEvents(state) {
  if (state.preferences.analyticsConsent !== true) return;
  const manifestVersion = chrome.runtime.getManifest().version;
  const planned = TrackerAnalyticsContract.planEvents(state.dailyRecords, state.analytics.reported, {
    extensionVersion: manifestVersion
  });
  if (!planned.length) return;
  for (const { id, signature, event } of planned) {
    state.analytics.queue[id] = { signature, payload: TrackerAnalyticsContract.toDatabaseRow(event), queuedAt: Date.now() };
  }
  scheduleAnalyticsDrain();
}

let analyticsDrainTimer = null;

// Coalesces bursts of tracking updates into one send, and uses a longer
// window than cloud sync's 4s: analytics has no per-item urgency, so there
// is no reason to send more often than roughly once a minute of activity.
function scheduleAnalyticsDrain(delayMs = 60000) {
  if (analyticsDrainTimer) return;
  analyticsDrainTimer = setTimeout(() => {
    analyticsDrainTimer = null;
    drainAnalyticsQueue().catch(() => null);
  }, delayMs);
}

// Uploads whatever is queued, as one batch of anonymous events with no
// user/device/session identifier attached. Never throws - if consent was
// withdrawn or the build has no Supabase config, this silently does
// nothing and drops the queue rather than sending anything.
async function drainAnalyticsQueue() {
  const state = await readState();
  if (state.preferences.analyticsConsent !== true) {
    if (Object.keys(state.analytics.queue).length) {
      await updateState((latest) => { latest.analytics.queue = {}; return { ok: true }; });
    }
    return { ok: false, reason: "analytics-consent-off" };
  }
  const config = await getCloudConfig();
  if (!config.enabled) return { ok: false, reason: "cloud-disabled" };

  const entries = Object.entries(state.analytics.queue);
  if (!entries.length) return { ok: true, uploaded: 0 };

  try {
    const request = TrackerAnalyticsRest.buildInsertEventsRequest(config, {
      rows: entries.map(([, entry]) => entry.payload)
    });
    const response = await fetchJson(request);
    if (!response.ok) throw new Error(TrackerAnalyticsRest.describeRestError(response.json, "Analytics upload failed."));

    await updateState((latest) => {
      for (const [id, entry] of entries) {
        delete latest.analytics.queue[id];
        latest.analytics.reported[id] = entry.signature;
      }
      latest.analytics.lastSendAt = Date.now();
      latest.analytics.lastError = "";
      return { ok: true };
    });
    return { ok: true, uploaded: entries.length };
  } catch (error) {
    // No per-item retry bookkeeping like cloud sync's queue: the next state
    // update naturally re-queues anything still unreported, and a transient
    // failure here just means the next scheduled drain tries again.
    await updateState((latest) => {
      latest.analytics.lastError = String(error?.message || "Analytics upload failed.").slice(0, 180);
      return { ok: true };
    });
    return { ok: false, reason: "upload-failed" };
  }
}

let uploadDrainTimer = null;

// Coalesces bursts of state updates (e.g. a minute of active tracking ticks)
// into a single drain attempt shortly after they settle, rather than firing
// a network request per update.
function scheduleUploadDrain(delayMs = 4000) {
  if (uploadDrainTimer) return;
  uploadDrainTimer = setTimeout(() => {
    uploadDrainTimer = null;
    drainUploadQueue().catch(() => null);
  }, delayMs);
}

// Uploads whatever in the local queue is ready to retry, up to one batch.
// Never throws - failures are recorded on state.cloud.lastError and the
// affected entries get their retry backoff bumped, same shape as
// TrackerCloudContract.retryEntry expects.
async function drainUploadQueue({ force = false } = {}) {
  const config = await getCloudConfig();
  if (!config.enabled) return { ok: false, reason: "cloud-disabled" };
  const session = await ensureFreshSession();
  if (!session) return { ok: false, reason: "no-session" };

  const state = await readState();
  if (!state.cloud.deviceRegistered) return { ok: false, reason: "device-not-registered" };
  if (!force && !cloudTrialActive(state.cloud)) return { ok: false, reason: "trial-expired" };

  const now = Date.now();
  const batch = TrackerCloudContract.readyBatch(state.cloud.queue, now);
  if (!batch.length) return { ok: true, uploaded: 0 };

  try {
    const request = TrackerSupabaseRest.buildUpsertDailyTotalsRequest(config, {
      accessToken: session.accessToken,
      userId: session.userId,
      rows: batch.map((entry) => entry.payload)
    });
    const response = await fetchJson(request);
    if (!response.ok) throw new Error(TrackerSupabaseRest.describeRestError(response.json, "Upload failed."));

    await updateState((latest) => {
      for (const entry of batch) {
        delete latest.cloud.queue[entry.id];
        latest.cloud.remoteRevisions[entry.id] = entry.payload.revision;
      }
      latest.cloud.lastUploadAt = now;
      latest.cloud.lastError = "";
      return { ok: true };
    });
    // More may have become ready (or arrived) while this batch was in
    // flight; keep draining until a pass uploads nothing.
    if (batch.length === TrackerCloudContract.MAX_BATCH_SIZE) scheduleUploadDrain(0);
    return { ok: true, uploaded: batch.length };
  } catch (error) {
    await updateState((latest) => {
      for (const entry of batch) {
        const current = latest.cloud.queue[entry.id];
        if (current) latest.cloud.queue[entry.id] = TrackerCloudContract.retryEntry(current, error, now);
      }
      latest.cloud.lastError = String(error?.message || "Upload failed.").slice(0, 180);
      return { ok: true };
    });
    return { ok: false, reason: "upload-failed" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || sender.id !== chrome.runtime.id) return false;
  const tabId = sender.tab?.id;

  if (message.type === "getPreferences") {
    readState().then((state) => sendResponse({ preferences: state.preferences }));
    return true;
  }

  if (message.type === "setPreferences") {
    updateState((state) => {
      if (message.preferences && "autoMinimizeEnabled" in message.preferences) {
        state.preferences.autoMinimizeEnabled = message.preferences.autoMinimizeEnabled !== false;
      }
      if (message.preferences && "autoMinimizeSeconds" in message.preferences) {
        state.preferences.autoMinimizeSeconds = Math.min(300, Math.max(1, Number(message.preferences.autoMinimizeSeconds) || 5));
      }
      if (message.preferences && "notificationsEnabled" in message.preferences) {
        state.preferences.notificationsEnabled = message.preferences.notificationsEnabled !== false;
      }
      if (message.preferences && "fullyManualEnabled" in message.preferences) {
        state.preferences.fullyManualEnabled = message.preferences.fullyManualEnabled === true;
      }
      if (message.preferences && "analyticsConsent" in message.preferences) {
        state.preferences.analyticsConsent = message.preferences.analyticsConsent === true;
      }
      if (message.preferences && "goalCountingMode" in message.preferences) {
        const nextMode = normalizeGoalCountingMode(message.preferences.goalCountingMode);
        if (state.preferences.goalCountingMode !== nextMode) state.notificationState = {};
        state.preferences.goalCountingMode = nextMode;
      }
      if (message.preferences && "goalDisplayMode" in message.preferences) {
        state.preferences.goalDisplayMode = normalizeGoalDisplayMode(message.preferences.goalDisplayMode);
      }
      if (message.preferences && "theme" in message.preferences) {
        state.preferences.theme = message.preferences.theme === "light" ? "light" : "dark";
      }
      if (message.preferences && "customManualCategories" in message.preferences) {
        state.preferences.customManualCategories = normalizeCustomCategories(message.preferences.customManualCategories);
      }
      if (message.preferences && "onboardingCompleted" in message.preferences) {
        state.preferences.onboardingCompleted = message.preferences.onboardingCompleted === true;
      }
      return { ok: true, preferences: { ...state.preferences } };
    }).then(async (result) => {
      if (message.preferences && ("goalCountingMode" in message.preferences || "goalDisplayMode" in message.preferences)) {
        try {
          await chrome.storage.sync.set({
            [SYNC_GOALS_KEY]: {
              goals: result.preferences.goals,
              goalCountingMode: result.preferences.goalCountingMode,
              goalDisplayMode: result.preferences.goalDisplayMode,
              updatedAt: Date.now()
            }
          });
        } catch {
          // Goal preferences remain available on this device if Chrome Sync is unavailable.
        }
      }
      await broadcastOverlayPreferences(result.preferences);
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "getAccountState") {
    (async () => {
      const [config, session, state] = await Promise.all([getCloudConfig(), getAccountSession(), readState()]);
      const now = Date.now();
      sendResponse({
        ok: true,
        cloudReady: config.enabled,
        // Email is deliberately not part of TrackerAccountState's shape (that
        // lib stays credential/PII-minimal on purpose) - attach it here at
        // the message-response level instead, for the UI to display.
        email: session?.email || "",
        account: TrackerAccountState.publicSummary(accountStateFromSession(session)),
        cloud: { ...state.cloud },
        trial: {
          startedAt: state.cloud.trialStartedAt,
          expiresAt: state.cloud.trialExpiresAt,
          active: cloudTrialActive(state.cloud, now),
          daysRemaining: state.cloud.trialExpiresAt
            ? Math.max(0, Math.ceil((state.cloud.trialExpiresAt - now) / 86400000))
            : 0
        }
      });
    })();
    return true;
  }

  if (message.type === "cloudSignUp") {
    (async () => {
      try {
        const config = await getCloudConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, error: { code: "cloud-disabled", message: "Cloud sync isn't set up yet." } });
          return;
        }
        const request = TrackerSupabaseAuth.buildSignUpRequest(config, { email: message.email, password: message.password });
        const { ok, json } = await fetchJson(request);
        if (!ok) {
          sendResponse({ ok: false, error: TrackerSupabaseAuth.parseAuthError(json, "Could not create your account.") });
          return;
        }
        const session = TrackerSupabaseAuth.parseSession(json);
        if (!session) {
          sendResponse({ ok: false, error: { code: "confirmation-required", message: "Check your email to confirm your account, then sign in." } });
          return;
        }
        await setAccountSession(session);
        // Awaited (not fire-and-forget): an un-awaited promise here could get
        // cut off if the service worker is suspended right after responding.
        // registerDevice() never throws, so this can't turn a real sign-in
        // failure into a false negative - it only adds one round-trip.
        await registerDevice(session);
        sendResponse({ ok: true, email: session.email || "", account: TrackerAccountState.publicSummary(accountStateFromSession(session)) });
      } catch (error) {
        sendResponse({ ok: false, error: { code: "invalid-input", message: String(error?.message || "Could not create your account.") } });
      }
    })();
    return true;
  }

  if (message.type === "cloudSignIn") {
    (async () => {
      try {
        const config = await getCloudConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, error: { code: "cloud-disabled", message: "Cloud sync isn't set up yet." } });
          return;
        }
        const request = TrackerSupabaseAuth.buildSignInRequest(config, { email: message.email, password: message.password });
        const { ok, json } = await fetchJson(request);
        if (!ok) {
          sendResponse({ ok: false, error: TrackerSupabaseAuth.parseAuthError(json, "Incorrect email or password.") });
          return;
        }
        const session = TrackerSupabaseAuth.parseSession(json);
        if (!session) {
          sendResponse({ ok: false, error: { code: "sign-in-failed", message: "Could not sign you in." } });
          return;
        }
        await setAccountSession(session);
        // Awaited (not fire-and-forget): an un-awaited promise here could get
        // cut off if the service worker is suspended right after responding.
        // registerDevice() never throws, so this can't turn a real sign-in
        // failure into a false negative - it only adds one round-trip.
        await registerDevice(session);
        sendResponse({ ok: true, email: session.email || "", account: TrackerAccountState.publicSummary(accountStateFromSession(session)) });
      } catch (error) {
        sendResponse({ ok: false, error: { code: "invalid-input", message: String(error?.message || "Incorrect email or password.") } });
      }
    })();
    return true;
  }

  if (message.type === "cloudSignOut") {
    (async () => {
      const session = await getAccountSession();
      if (session?.accessToken) {
        try {
          const config = await getCloudConfig();
          if (config.enabled) await fetchJson(TrackerSupabaseAuth.buildSignOutRequest(config, { accessToken: session.accessToken }));
        } catch {
          // Best-effort server-side revoke; the device signs out locally regardless.
        }
      }
      await clearAccountSession();
      sendResponse({ ok: true, account: TrackerAccountState.publicSummary(TrackerAccountState.guest()) });
    })();
    return true;
  }

  // Permanently deletes the signed-in account server-side via the
  // security-definer tracker_delete_my_account() RPC (never a service-role
  // key - see supabase/migrations/0003_self_account_deletion.sql), then
  // clears the local session the same way cloudSignOut does. Local tracking
  // history is never touched: this only ever removes the account and its
  // cloud-mirrored rows.
  if (message.type === "cloudDeleteAccount") {
    (async () => {
      try {
        const session = await getAccountSession();
        if (!session?.accessToken) {
          sendResponse({ ok: false, error: { code: "not-signed-in", message: "You're not signed in." } });
          return;
        }
        const config = await getCloudConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, error: { code: "cloud-disabled", message: "Cloud sync isn't set up yet." } });
          return;
        }
        const request = TrackerSupabaseRest.buildDeleteAccountRequest(config, { accessToken: session.accessToken });
        const { ok, json } = await fetchJson(request);
        if (!ok) {
          sendResponse({ ok: false, error: { code: "delete-failed", message: TrackerSupabaseRest.describeRestError(json, "Could not delete your account.") } });
          return;
        }
        await clearAccountSession();
        sendResponse({ ok: true, account: TrackerAccountState.publicSummary(TrackerAccountState.guest()) });
      } catch (error) {
        sendResponse({ ok: false, error: { code: "delete-failed", message: String(error?.message || "Could not delete your account.") } });
      }
    })();
    return true;
  }

  if (message.type === "cloudRequestPasswordReset") {
    (async () => {
      try {
        const config = await getCloudConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, error: { code: "cloud-disabled", message: "Cloud sync isn't set up yet." } });
          return;
        }
        const request = TrackerSupabaseAuth.buildRequestPasswordResetRequest(config, { email: message.email });
        await fetchJson(request);
        // Always report success, whether or not that email has an account -
        // otherwise this endpoint becomes a way to check who's registered.
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: { code: "invalid-input", message: String(error?.message || "Enter a valid email address.") } });
      }
    })();
    return true;
  }

  if (message.type === "cloudConfirmPasswordReset") {
    (async () => {
      try {
        const config = await getCloudConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, error: { code: "cloud-disabled", message: "Cloud sync isn't set up yet." } });
          return;
        }
        const verify = await fetchJson(TrackerSupabaseAuth.buildVerifyRecoveryRequest(config, { email: message.email, token: message.code }));
        if (!verify.ok) {
          sendResponse({ ok: false, error: TrackerSupabaseAuth.parseAuthError(verify.json, "That code is invalid or expired.") });
          return;
        }
        const recoverySession = TrackerSupabaseAuth.parseSession(verify.json);
        if (!recoverySession) {
          sendResponse({ ok: false, error: { code: "verify-failed", message: "That code is invalid or expired." } });
          return;
        }
        const update = await fetchJson(TrackerSupabaseAuth.buildUpdatePasswordRequest(config, {
          accessToken: recoverySession.accessToken,
          password: message.newPassword
        }));
        if (!update.ok) {
          sendResponse({ ok: false, error: TrackerSupabaseAuth.parseAuthError(update.json, "Could not set your new password.") });
          return;
        }
        await setAccountSession(recoverySession);
        await registerDevice(recoverySession);
        sendResponse({ ok: true, email: recoverySession.email || "", account: TrackerAccountState.publicSummary(accountStateFromSession(recoverySession)) });
      } catch (error) {
        sendResponse({ ok: false, error: { code: "invalid-input", message: String(error?.message || "Could not reset your password.") } });
      }
    })();
    return true;
  }

  if (message.type === "setTargetLanguage") {
    updateState((state) => {
      const targetLanguage = normalizeTargetLanguage(message.targetLanguage);
      state.preferences.targetLanguage = targetLanguage;
      state.preferences.targetLanguageDeferred = targetLanguage.code === "und";
      state.preferences.languageNames[targetLanguage.code] = targetLanguage.name;
      return { ok: true, targetLanguage, preferences: { ...state.preferences } };
    }).then(async (result) => {
      await broadcastOverlayPreferences(result.preferences);
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "setGoals") {
    updateState((state) => {
      const incoming = message.goals || {};
      const defaults = emptyState().preferences.goals;
      const clampGoalMinutes = (value, fallback) => Math.min(
        525600,
        Math.max(1, Math.round(Number(value) || fallback))
      );
      state.preferences.goals = {
        daily: {
          enabled: true,
          minutes: clampGoalMinutes(incoming.daily?.minutes, defaults.daily.minutes)
        },
        weekly: {
          enabled: true,
          minutes: clampGoalMinutes(incoming.weekly?.minutes, defaults.weekly.minutes)
        },
        monthly: {
          enabled: incoming.monthly?.enabled === true,
          minutes: clampGoalMinutes(incoming.monthly?.minutes, defaults.monthly.minutes)
        },
        yearly: {
          enabled: incoming.yearly?.enabled === true,
          minutes: clampGoalMinutes(incoming.yearly?.minutes, defaults.yearly.minutes)
        }
      };
      return {
        ok: true,
        goals: state.preferences.goals,
        goalCountingMode: state.preferences.goalCountingMode,
        goalDisplayMode: state.preferences.goalDisplayMode
      };
    }).then(async (result) => {
      try {
        await chrome.storage.sync.set({
          [SYNC_GOALS_KEY]: {
            goals: result.goals,
            goalCountingMode: result.goalCountingMode,
            goalDisplayMode: result.goalDisplayMode,
            updatedAt: Date.now()
          }
        });
      } catch {
        // Goal settings remain available on this device if Chrome Sync is unavailable.
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "setOverlayPosition") {
    updateState((state) => {
      const left = Number(message.position?.left);
      const top = Number(message.position?.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return { ok: false };
      state.preferences.overlayPosition = {
        custom: true,
        left: Math.max(0, left),
        top: Math.max(0, top),
        viewportWidth: Math.max(0, Number(message.position?.viewportWidth) || 0),
        viewportHeight: Math.max(0, Number(message.position?.viewportHeight) || 0)
      };
      return { ok: true, position: state.preferences.overlayPosition };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "setUiPreferences") {
    updateState((state) => {
      const validIds = ["session", "calendar-goals", "insights", "manual", "completed", "history"];
      state.preferences.uiLayoutVersion = 2;
      if (Array.isArray(message.componentOrder)) {
        const requested = message.componentOrder.filter((id, index, items) => validIds.includes(id) && items.indexOf(id) === index);
        state.preferences.componentOrder = [...requested, ...validIds.filter((id) => !requested.includes(id))];
      }
      if (message.collapsedComponents && typeof message.collapsedComponents === "object") {
        state.preferences.collapsedComponents = Object.fromEntries(
          validIds.map((id) => [id, message.collapsedComponents[id] === true])
        );
      }
      if (message.historyLimit != null) {
        state.preferences.historyLimit = Number(message.historyLimit) === 10 ? 10 : 5;
      }
      return {
        ok: true,
        componentOrder: state.preferences.componentOrder,
        collapsedComponents: state.preferences.collapsedComponents,
        historyLimit: state.preferences.historyLimit
      };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "exportData") {
    readState().then((state) => sendResponse({ ok: true, state }));
    return true;
  }

  if (message.type === "getStorageUsage") {
    Promise.all([
      chrome.storage.local.getBytesInUse(null),
      chrome.storage.sync.getBytesInUse(null).catch(() => 0)
    ]).then(([localBytes, syncBytes]) => sendResponse({
      ok: true,
      localBytes,
      syncBytes,
      localUnlimited: chrome.runtime.getManifest().permissions?.includes("unlimitedStorage") === true,
      localQuotaBytes: chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024,
      syncQuotaBytes: chrome.storage.sync.QUOTA_BYTES || 100 * 1024,
      dailyBreakdownsPermanent: true,
      readableHistoryLimit: 10
    })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "importData") {
    (async () => {
      const resetAt = Date.now();
      const imported = normalizeState(message.state);
      imported.sync.lastResetSeen = resetAt;
      imported.sync.dirtyMonths ||= {};
      for (const records of Object.values(imported.languageRecords || {})) {
        for (const dateKey of Object.keys(records || {})) imported.sync.dirtyMonths[monthKeyFromDateKey(dateKey)] = Date.now();
      }
      compactOldHistory(imported, resetAt, true);
      await updateState((state) => Object.assign(state, imported));

      try {
        const allSync = await chrome.storage.sync.get(null);
        const staleKeys = Object.keys(allSync).filter((key) =>
          key.startsWith(SYNC_RECORD_PREFIX) || key.startsWith(SYNC_SOURCE_TOTAL_PREFIX) ||
            key.startsWith(SYNC_DECISION_PREFIX) || key === SYNC_GOALS_KEY
        );
        if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);
        await chrome.storage.sync.set({
          [SYNC_RESET_KEY]: { resetAt },
          [SYNC_GOALS_KEY]: {
            goals: imported.preferences.goals,
            goalCountingMode: imported.preferences.goalCountingMode,
            goalDisplayMode: imported.preferences.goalDisplayMode,
            updatedAt: resetAt
          }
        });
        await flushDirtyMonths();
        return { ok: true, syncReplaced: true };
      } catch {
        return { ok: true, syncReplaced: false, warning: "Local backup restored, but Chrome Sync could not be replaced." };
      }
    })().then(sendResponse);
    return true;
  }

  if (message.type === "importCsvRows") {
    updateState((state) => {
      const rows = Array.isArray(message.rows) ? message.rows.slice(0, 5000) : [];
      let imported = 0;
      for (const row of rows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ""))) continue;
        const code = normalizeLanguageCode(row.languageCode);
        const site = normalizeManualSource(row.source);
        const active = clampManualSeconds(Number(row.activeSeconds) || 0);
        const passive = clampManualSeconds(Number(row.passiveSeconds) || 0);
        if (!active && !passive) continue;
        const record = ensureRecord(state, row.date, site, code);
        record.active += active;
        record.passive += passive;
        record.sites[site].active += active;
        record.sites[site].passive += passive;
        markMonthDirty(state, row.date);
        const id = "import-" + Date.now() + "-" + imported + "-" + Math.random().toString(36).slice(2, 6);
        addSessionDelta(state, id, {
          kind: "import",
          site,
          title: row.title || site + " imported immersion",
          languageCode: code,
          dateKey: row.date,
          active,
          passive,
          timestamp: new Date(row.date + "T12:00:00").getTime()
        });
        if (row.languageName) state.preferences.languageNames[code] = String(row.languageName).slice(0, 50);
        imported += 1;
      }
      return { ok: true, imported };
    }).then(sendResponse);
    return true;
  }

  // TEMPORARY TEST-ONLY HANDLER — remove before release. Seeds random local
  // immersion data (dates, durations, sources, sessions) so the UI can be
  // reviewed with realistic data. Never wired to any network or sync path.
  if (message.type === "seedRandomImmersion") {
    updateState((state) => {
      const rawCode = normalizeLanguageCode(state.preferences?.targetLanguage?.code);
      // "auto" is a display-only mode, not a real per-language storage bucket —
      // the canonical data model always folds it back to "ja", so seeding under
      // a literal "auto" bucket would double-count against any existing "ja"
      // data for the same day and get rejected as a divergence. Match that
      // fallback here.
      const code = rawCode === "auto" ? "ja" : rawCode;
      const sources = ["youtube", "netflix", "reading", "listening", "writing", "vocab", "grammar"];
      const totalDays = 60;
      let seededDays = 0;
      let seededSessions = 0;
      for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
        if (Math.random() < 0.28) continue; // leave gaps so streaks/calendar look realistic
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        const timestamp = date.getTime();
        const dateKey = localDateKey(timestamp);
        const sourceCount = 1 + Math.floor(Math.random() * 3);
        const daySources = sources
          .map((source) => ({ source, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .slice(0, sourceCount)
          .map((entry) => entry.source);
        let dayActiveSeconds = 0;
        let dayPassiveSeconds = 0;
        let firstSource = daySources[0] || "other";
        for (const source of daySources) {
          const activeSeconds = Math.round((5 + Math.random() * 85) * 60);
          const passiveSeconds = Math.random() < 0.6 ? Math.round(Math.random() * 40 * 60) : 0;
          addManualSeconds(state, { source, mode: "active", seconds: activeSeconds, timestamp, languageCode: code });
          if (passiveSeconds) addManualSeconds(state, { source, mode: "passive", seconds: passiveSeconds, timestamp, languageCode: code });
          dayActiveSeconds += activeSeconds;
          dayPassiveSeconds += passiveSeconds;
        }
        seededDays += 1;
        if (offset < 12) {
          const id = "seed-" + dateKey + "-" + Math.random().toString(36).slice(2, 8);
          addSessionDelta(state, id, {
            kind: "seed",
            site: firstSource,
            title: "Random seed — " + firstSource,
            languageCode: code,
            dateKey,
            active: dayActiveSeconds,
            passive: dayPassiveSeconds,
            timestamp
          });
          seededSessions += 1;
        }
      }
      return { ok: true, seededDays, seededSessions };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "deleteHistorySession") {
    updateState((state) => {
      const id = String(message.sessionId || "");
      const session = state.sessions[id];
      const isLive = state.manualTimer?.running && state.manualTimer.id === id ||
        Object.values(liveStatus).some((status) => status?.sessionId === id);
      if (!session || isLive) return { ok: false, reason: isLive ? "live" : "missing" };
      applySessionContribution(state, session, -1);
      state.lastDeletedSession = { id, session, deletedAt: Date.now() };
      delete state.sessions[id];
      return { ok: true };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "undoHistoryDelete") {
    updateState((state) => {
      const deleted = state.lastDeletedSession;
      if (!deleted?.session || !deleted.id) return { ok: false };
      applySessionContribution(state, deleted.session, 1);
      state.sessions[deleted.id] = deleted.session;
      state.lastDeletedSession = null;
      return { ok: true };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "editHistorySession") {
    updateState((state) => {
      const id = String(message.sessionId || "");
      const session = state.sessions[id];
      const isLive = state.manualTimer?.running && state.manualTimer.id === id ||
        Object.values(liveStatus).some((status) => status?.sessionId === id);
      const dateKey = String(message.date || "");
      if (!session || isLive || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return { ok: false };
      applySessionContribution(state, session, -1);
      session.site = normalizeManualSource(message.source || session.site);
      session.title = String(message.title || session.title || "Immersion session").trim().slice(0, 160);
      session.byDate = {
        [dateKey]: {
          active: clampManualSeconds(message.activeSeconds),
          passive: clampManualSeconds(message.passiveSeconds)
        }
      };
      session.lastAt = Date.now();
      applySessionContribution(state, session, 1);
      return { ok: true };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "addCustomImmersion") {
    const languageCode = normalizeLanguageCode(message.languageCode);
    updateState((state) => {
      const selectedDate = parseLocalDateKey(message.date || localDateKey());
      if (!selectedDate || selectedDate > localDateKey()) return { ok: false, reason: "invalid-date" };
      const timestamp = new Date(selectedDate + "T12:00:00").getTime();
      const code = normalizeLanguageCode(languageCode || state.preferences.targetLanguage.code);
      const source = normalizeManualSource(message.source);
      const action = normalizeManualAction(message.action);
      const mode = normalizeManualMode(message.mode);
      state.preferences.lastManualSource = source;
      state.preferences.lastManualAction = action;
      state.preferences.lastManualMode = mode;
      const added = addManualSeconds(state, { source, mode, seconds: message.seconds, timestamp, languageCode: code });
      if (added) {
        addSessionDelta(state, "custom-" + timestamp + "-" + Math.random().toString(36).slice(2, 8), {
          kind: "custom",
          site: source,
          title: action || source + " immersion",
          languageCode: code,
          dateKey: selectedDate,
          active: mode === "active" ? added : 0,
          passive: mode === "passive" ? added : 0,
          timestamp
        });
      }
      return { ok: Boolean(added), added, languageCode: code, date: selectedDate };
    }).then(async (result) => {
      if (result.ok) await notifyGoalCompletions(result.languageCode);
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "startManualTimer") {
    updateState((state) => {
      if (state.manualTimer?.running) {
        return { ok: true, alreadyRunning: true, timer: manualTimerSnapshot(state.manualTimer) };
      }
      const source = normalizeManualSource(message.source || state.preferences.lastManualSource);
      const action = normalizeManualAction(message.action);
      const mode = normalizeManualMode(message.mode || state.preferences.lastManualMode);
      const now = Date.now();
      const languageCode = normalizeLanguageCode(message.languageCode || state.preferences.targetLanguage.code);
      state.preferences.lastManualSource = source;
      state.preferences.lastManualAction = action;
      state.preferences.lastManualMode = mode;
      state.manualTimer = {
        id: String(now) + "-" + Math.random().toString(36).slice(2, 9),
        source,
        action,
        mode,
        languageCode,
        running: true,
        startedAt: now,
        lastCheckpointAt: now,
        committedSeconds: 0
      };
      return { ok: true, timer: manualTimerSnapshot(state.manualTimer, now) };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "pauseManualTimer") {
    checkpointManualTimer({ stop: true }).then(async (result) => {
      if (result?.timer?.languageCode) await notifyGoalCompletions(result.timer.languageCode);
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "toggleManualTimer") {
    readState().then((state) => {
      if (state.manualTimer?.running) return checkpointManualTimer({ stop: true });
      return updateState((latest) => {
        const source = normalizeManualSource(latest.preferences.lastManualSource);
        const mode = normalizeManualMode(latest.preferences.lastManualMode);
        const languageCode = normalizeLanguageCode(latest.preferences.targetLanguage.code);
        const now = Date.now();
        latest.manualTimer = {
          id: String(now) + "-" + Math.random().toString(36).slice(2, 9),
          source,
          action: "",
          mode,
          languageCode,
          running: true,
          startedAt: now,
          lastCheckpointAt: now,
          committedSeconds: 0
        };
        return { ok: true, timer: manualTimerSnapshot(latest.manualTimer, now) };
      });
    }).then(sendResponse);
    return true;
  }

  if (message.type === "getDecision") {
    (async () => {
      const state = await readState();
      const languageCode = normalizeLanguageCode(message.languageCode || state.preferences.targetLanguage.code);
      const contentStorageKey = message.contentKey
        ? decisionStorageKey(languageCode, message.contentKey)
        : "";
      const sourceStorageKey = message.sourceKey
        ? decisionStorageKey(languageCode, message.sourceKey)
        : "";

      let scope = null;
      let decision = contentStorageKey
        ? state.decisions.content[contentStorageKey]
        : null;
      if (decision) scope = "content";

      if (!decision && contentStorageKey) {
        decision = await readSyncedDecision("content", contentStorageKey);
        if (decision) {
          scope = "content";
          await updateState((latest) => {
            latest.decisions.content[contentStorageKey] = normalizeDecision(decision);
          });
        }
      }
      // Exact decisions and corrections must win even when the exact value is
      // only in Chrome Sync and a broader family value is already cached.
      if (!decision && sourceStorageKey) {
        decision = state.decisions.source[sourceStorageKey] || null;
        if (decision) scope = "source";
      }
      if (!decision && sourceStorageKey) {
        decision = await readSyncedDecision("source", sourceStorageKey);
        if (decision) {
          scope = "source";
          await updateState((latest) => {
            latest.decisions.source[sourceStorageKey] = normalizeDecision(decision);
          });
        }
      }
      return { decision: normalizeDecision(decision), scope };
    })().then(sendResponse);
    return true;
  }

  if (message.type === "saveDecision") {
    (async () => {
      const scope = message.scope === "source" ? "source" : "content";
      const state = await readState();
      const languageCode = normalizeLanguageCode(message.languageCode || state.preferences.targetLanguage.code);
      const rawKey = scope === "source" ? message.sourceKey : message.contentKey;
      const key = rawKey ? decisionStorageKey(languageCode, rawKey) : "";
      const decision = normalizeDecision(message.decision);
      if (!key || !decision) return { ok: false };

      const sourceLearningKey = message.sourceKey
        ? decisionStorageKey(languageCode, message.sourceKey)
        : "";
      const contentLearningKey = message.contentKey
        ? decisionStorageKey(languageCode, message.contentKey)
        : "";

      const result = await updateState((latest) => {
        latest.decisions[scope][key] = decision;
        let suggestSource = false;

        if (
          scope === "content" &&
          decision === "target" &&
          sourceLearningKey &&
          !latest.decisions.source[sourceLearningKey]
        ) {
          const learning = latest.sourceLearning[sourceLearningKey] ||= {
            confirmedContents: {},
            languageCode,
            updatedAt: 0
          };
          learning.confirmedContents[contentLearningKey] = Date.now();
          learning.confirmedContents = Object.fromEntries(
            Object.entries(learning.confirmedContents)
              .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
              .slice(0, MAX_LEARNED_CONTENTS_PER_SOURCE)
          );
          learning.updatedAt = Date.now();
          latest.sourceLearning = pruneDecisionEntries(
            latest.sourceLearning,
            MAX_SOURCE_LEARNING_ENTRIES
          );
          suggestSource = Object.keys(learning.confirmedContents).length >= 2;
        }

        if (scope === "content" && decision !== "target" && sourceLearningKey && contentLearningKey) {
          const learning = latest.sourceLearning[sourceLearningKey];
          if (learning?.confirmedContents) {
            delete learning.confirmedContents[contentLearningKey];
            if (!Object.keys(learning.confirmedContents).length) delete latest.sourceLearning[sourceLearningKey];
          }
        }

        if (scope === "source") {
          delete latest.sourceLearning[sourceLearningKey];
        }

        return { ok: true, suggestSource };
      });

      await writeSyncedDecision(scope, key, decision);
      return result;
    })().then(sendResponse);
    return true;
  }

  if (message.type === "dismissSourceSuggestion") {
    updateState((state) => {
      if (message.sourceKey) {
        const languageCode = normalizeLanguageCode(message.languageCode || state.preferences.targetLanguage.code);
        delete state.sourceLearning[decisionStorageKey(languageCode, message.sourceKey)];
      }
      return { ok: true };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "addTick") {
    (async () => {
      if (tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.mutedInfo?.muted) return { ok: true, ignored: "tab-muted" };
        } catch {
          return { ok: true, ignored: "tab-closed" };
        }
      }

      automaticOwnerTabId = chooseAutomaticOwnerTabId();
      if (tabId && automaticOwnerTabId && automaticOwnerTabId !== tabId) {
        return { ok: true, ignored: "another-video-is-counting" };
      }
      if (tabId && !automaticOwnerTabId) automaticOwnerTabId = tabId;

      return updateState((state) => {
        if (state.preferences.targetLanguageDeferred === true || state.preferences.targetLanguage.code === "und") {
          return { ok: true, ignored: "target-language-not-selected" };
        }
        const active = clampSeconds(message.activeSeconds);
        const passive = clampSeconds(message.passiveSeconds);
        if (!active && !passive) return { ok: true, added: { active: 0, passive: 0 } };

        const site = message.site || "other";
        const languageCode = normalizeLanguageCode(message.languageCode || state.preferences.targetLanguage.code);
        const dateKey = localDateKey(message.timestamp || Date.now());
        const record = ensureRecord(state, dateKey, site, languageCode);

        record.active += active;
        record.passive += passive;
        record.sites[site].active += active;
        record.sites[site].passive += passive;
        const sourceTotal = ensureSourceTotal(state, site, languageCode);
        sourceTotal.active += active;
        sourceTotal.passive += passive;
        markMonthDirty(state, dateKey);

        addSessionDelta(state, message.sessionId, {
          kind: "video",
          site,
          languageCode,
          title: message.title || "Untitled video",
          startedAt: message.timestamp || Date.now(),
          dateKey,
          active,
          passive
        });

        return { ok: true, added: { active, passive } };
      });
    })().then(async (result) => {
      if (result?.added && !result.ignored) await notifyGoalCompletions(message.languageCode);
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "rollbackSession") {
    updateState((state) => {
      const session = state.sessions[message.sessionId];
      if (!session) return { ok: true, removed: { active: 0, passive: 0 } };

      let removedActive = 0;
      let removedPassive = 0;
      for (const [dateKey, contribution] of Object.entries(session.byDate || {})) {
        const languageCode = normalizeLanguageCode(session.languageCode || "ja");
        const record = state.languageRecords?.[languageCode]?.[dateKey] ||
          (languageCode === "ja" ? state.records?.[dateKey] : null);
        if (!record) continue;
        const site = session.site || "other";
        const siteRecord = record.sites?.[site];

        const active = Number(contribution.active) || 0;
        const passive = Number(contribution.passive) || 0;
        removedActive += active;
        removedPassive += passive;

        record.active = Math.max(0, record.active - active);
        record.passive = Math.max(0, record.passive - passive);
        if (siteRecord) {
          siteRecord.active = Math.max(0, siteRecord.active - active);
          siteRecord.passive = Math.max(0, siteRecord.passive - passive);
        }
        markMonthDirty(state, dateKey);
      }

      delete state.sessions[message.sessionId];
      return { ok: true, removed: { active: removedActive, passive: removedPassive } };
    }).then(sendResponse);
    return true;
  }

  if (message.type === "status") {
    (async () => {
      let tabMuted = false;
      let activeImmersion = false;
      if (tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          tabMuted = Boolean(tab.mutedInfo?.muted);
        } catch {
          // Tab may have closed.
        }
        activeImmersion = await isTabActivelyViewed(tabId, message.status);
      }

      const computedState = computeStatusState(message.status, activeImmersion);
      if (tabId) {
        liveStatus[String(tabId)] = {
          ...message.status,
          state: computedState,
          activeImmersion,
          tabMuted,
          updatedAt: Date.now()
        };
        automaticOwnerTabId = chooseAutomaticOwnerTabId();
      }
      await setBadge(tabId, computedState);
      return {
        ok: true,
        tabMuted,
        activeImmersion,
        computedState,
        overlapBlocked: Boolean(automaticOwnerTabId && tabId && automaticOwnerTabId !== tabId)
      };
    })().then(sendResponse);
    return true;
  }

  if (message.type === "getDashboard") {
    (async () => {
      const state = await readState();
      const deviceId = await getDeviceId();
      const languageCode = normalizeLanguageCode(state.preferences.targetLanguage.code);
      const records = await getCombinedRecords(state, deviceId, languageCode);
      const sourceTotals = await getCombinedSourceTotals(state, deviceId, languageCode);
      try {
        const synced = await chrome.storage.sync.get(SYNC_GOALS_KEY);
        const syncedGoalSettings = synced[SYNC_GOALS_KEY];
        const syncedGoals = syncedGoalSettings?.goals;
        if (syncedGoals) {
          const defaults = emptyState().preferences.goals;
          state.preferences.goals = Object.fromEntries(
            Object.entries(defaults).map(([period, goal]) => [
              period,
              {
                ...goal,
                ...(syncedGoals[period] || {}),
                minutes: Math.min(
                  525600,
                  Math.max(1, Math.round(Number(syncedGoals[period]?.minutes) || goal.minutes))
                ),
                enabled: period === "daily" || period === "weekly"
                  ? true
                  : syncedGoals[period]?.enabled === true
              }
            ])
          );
        }
        if (syncedGoalSettings && "goalCountingMode" in syncedGoalSettings) {
          state.preferences.goalCountingMode = normalizeGoalCountingMode(syncedGoalSettings.goalCountingMode);
        }
        if (syncedGoalSettings && "goalDisplayMode" in syncedGoalSettings) {
          state.preferences.goalDisplayMode = normalizeGoalDisplayMode(syncedGoalSettings.goalDisplayMode);
        }
      } catch {
        // Use locally saved goal settings if Chrome Sync is unavailable.
      }
      return {
        state: {
          ...state,
          records,
          sourceTotals: { ...(state.sourceTotals || {}), [languageCode]: sourceTotals },
          manualTimer: manualTimerSnapshot(state.manualTimer),
          currentStatus: { ...liveStatus }
        },
        sync: {
          mode: "chrome-storage-sync",
          deviceId,
          lastSyncedAt: state.sync.lastSyncedAt || 0,
          pendingMonths: Object.keys(state.sync.dirtyMonths || {}).length
        },
        storageHealth: { writeError: lastStorageWriteError }
      };
    })().then(sendResponse);
    return true;
  }

  if (message.type === "syncNow") {
    flushDirtyMonths({ force: true }).then(sendResponse);
    return true;
  }

  if (message.type === "resetAllData") {
    (async () => {
      const resetAt = Date.now();
      try {
        const allSync = await chrome.storage.sync.get(null);
        const keys = Object.keys(allSync).filter(
          (key) => key.startsWith(SYNC_RECORD_PREFIX) ||
            key.startsWith(SYNC_SOURCE_TOTAL_PREFIX) ||
            key.startsWith(SYNC_DECISION_PREFIX) ||
            key === SYNC_GOALS_KEY
        );
        if (keys.length) await chrome.storage.sync.remove(keys);
        await chrome.storage.sync.set({ [SYNC_RESET_KEY]: { resetAt } });
      } catch {
        // Local reset still succeeds.
      }

      const fresh = emptyState();
      fresh.sync.lastResetSeen = resetAt;
      await localDataAdapter.write(fresh);
      await localDataAdapter.remove(MIGRATION_BACKUP_KEY);
      await localDataAdapter.remove(MIGRATION_STAGE_KEY);
      for (const key of Object.keys(liveStatus)) delete liveStatus[key];
      dashboardCache = { at: 0, languageCode: "", records: null };
      return { ok: true };
    })().then(sendResponse);
    return true;
  }

  return false;
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-dashboard") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("store-assets/dashboard.html") });
    return;
  }

  if (command === "toggle-manual-timer") {
    const state = await readState();
    if (state.manualTimer?.running) {
      await checkpointManualTimer({ stop: true });
    } else {
      await updateState((latest) => {
        const now = Date.now();
        latest.manualTimer = {
          id: String(now) + "-" + Math.random().toString(36).slice(2, 9),
          source: normalizeManualSource(latest.preferences.lastManualSource),
          action: "",
          mode: normalizeManualMode(latest.preferences.lastManualMode),
          languageCode: normalizeLanguageCode(latest.preferences.targetLanguage.code),
          running: true,
          startedAt: now,
          lastCheckpointAt: now,
          committedSeconds: 0
        };
      });
    }
    return;
  }

  if (command === "toggle-video-tracking") {
    await sendToActiveTab({ type: "toggleTrackerPause" });
    return;
  }

  if (command === "toggle-status-overlay") {
    await sendToActiveTab({ type: "toggleOverlayCompact" });
    return;
  }

  if (command === "show-hotkeys") {
    await chrome.storage.session.set({ [HOTKEY_GUIDE_REQUEST_KEY]: Date.now() });
    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?hotkeys=1") });
    }
  }
});

chrome.tabs.onActivated.addListener(() => refreshAllTabContexts());
chrome.windows.onFocusChanged.addListener(() => refreshAllTabContexts());
chrome.tabs.onRemoved.addListener((tabId) => {
  delete liveStatus[String(tabId)];
  if (automaticOwnerTabId === tabId) automaticOwnerTabId = chooseAutomaticOwnerTabId();
});

ensureSyncAlarm();
checkRemoteReset();
