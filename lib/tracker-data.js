(function exposeTrackerData(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 9;
  const RECORD_SCHEMA_VERSION = 1;
  const COMPACTED_SOURCE = "compacted";
  const TOTAL_EPSILON_SECONDS = 0.001;

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function language(value) {
    const code = String(value || "ja").trim().toLowerCase().replace(/_/g, "-");
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ? code.slice(0, 24) : "ja";
  }

  function source(value) {
    return String(value || "other").trim().replace(/\s+/g, " ").slice(0, 40) || "other";
  }

  function recordId(dateKey, languageCode, sourceName) {
    return [String(dateKey), language(languageCode), encodeURIComponent(source(sourceName).toLowerCase())].join("|");
  }

  function createRecord({ dateKey, languageCode, sourceName, activeSeconds = 0, passiveSeconds = 0,
    sessionCount = 0, createdAt = 0, updatedAt = 0, revision = 0, legacy = false }) {
    const safeLanguage = language(languageCode);
    const safeSource = source(sourceName);
    return {
      id: recordId(dateKey, safeLanguage, safeSource),
      dateKey: String(dateKey),
      languageCode: safeLanguage,
      source: safeSource,
      activeSeconds: number(activeSeconds),
      passiveSeconds: number(passiveSeconds),
      sessionCount: Math.max(0, Math.floor(Number(sessionCount) || 0)),
      createdAt: Math.max(0, Number(createdAt) || 0),
      updatedAt: Math.max(0, Number(updatedAt) || 0),
      revision: Math.max(0, Math.floor(Number(revision) || 0)),
      schemaVersion: RECORD_SCHEMA_VERSION,
      ...(legacy ? { legacy: true } : {})
    };
  }

  function existingCounts(dailyRecords) {
    return Object.fromEntries(Object.entries(dailyRecords || {}).map(([id, record]) => [id, {
      sessionCount: Math.max(0, Math.floor(Number(record?.sessionCount) || 0)),
      createdAt: Math.max(0, Number(record?.createdAt) || 0),
      updatedAt: Math.max(0, Number(record?.updatedAt) || 0),
      revision: Math.max(0, Math.floor(Number(record?.revision) || 0)),
      legacy: record?.legacy === true
    }]));
  }

  function genuineSessionCounts(sessions) {
    const counts = {};
    for (const session of Object.values(sessions || {})) {
      const languageCode = language(session?.languageCode);
      const sourceName = source(session?.site);
      for (const dateKey of Object.keys(session?.byDate || {})) {
        const id = recordId(dateKey, languageCode, sourceName);
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    return counts;
  }

  function buildFromLegacy(state, options = {}) {
    const timestamp = Math.max(0, Number(options.timestamp) || Date.now());
    const previous = existingCounts(state?.dailyRecords);
    const sessionCounts = options.deriveSessionCounts === true ? genuineSessionCounts(state?.sessions) : {};
    const records = {};
    const pending = {};
    const diagnostics = options.diagnostics || {};
    diagnostics.sourceAdjustments ||= [];

    function queue(dateKey, languageCode, sourceName, active, passive) {
      const id = recordId(dateKey, languageCode, sourceName);
      const nextActive = number(active);
      const nextPassive = number(passive);
      if (!nextActive && !nextPassive) return;
      pending[id] ||= { dateKey, languageCode, sourceName, active: 0, passive: 0 };
      pending[id].active += nextActive;
      pending[id].passive += nextPassive;
    }

    function upsert(id, values) {
      const old = previous[id];
      const nextActive = number(values.active);
      const nextPassive = number(values.passive);
      const oldRecord = state?.dailyRecords?.[id];
      const changed = !oldRecord || number(oldRecord.activeSeconds) !== nextActive ||
        number(oldRecord.passiveSeconds) !== nextPassive;
      records[id] = createRecord({
        dateKey: values.dateKey,
        languageCode: values.languageCode,
        sourceName: values.sourceName,
        activeSeconds: nextActive,
        passiveSeconds: nextPassive,
        sessionCount: state?.dailySessionCounts?.[id] ?? old?.sessionCount ?? sessionCounts[id] ?? 0,
        createdAt: old ? old.createdAt : (options.migration ? 0 : timestamp),
        updatedAt: changed ? timestamp : old?.updatedAt,
        revision: changed ? (old?.revision || 0) + 1 : old?.revision,
        legacy: old ? old.legacy : options.migration === true
      });
    }

    for (const [languageCode, dates] of Object.entries(state?.languageRecords || {})) {
      for (const [dateKey, daily] of Object.entries(dates || {})) {
        const targetActive = number(daily?.active);
        const targetPassive = number(daily?.passive);
        const siteEntries = Object.entries(daily?.sites || {}).map(([sourceName, values]) => ({
          sourceName,
          active: number(values?.active),
          passive: number(values?.passive)
        }));
        let sourcedActive = 0;
        let sourcedPassive = 0;
        for (const entry of siteEntries) {
          sourcedActive += entry.active;
          sourcedPassive += entry.passive;
        }
        const repairActive = options.migration === true && sourcedActive - targetActive > TOTAL_EPSILON_SECONDS;
        const repairPassive = options.migration === true && sourcedPassive - targetPassive > TOTAL_EPSILON_SECONDS;
        const activeScale = repairActive && sourcedActive ? targetActive / sourcedActive : 1;
        const passiveScale = repairPassive && sourcedPassive ? targetPassive / sourcedPassive : 1;
        if (repairActive || repairPassive) {
          diagnostics.sourceAdjustments.push({
            key: `${language(languageCode)}|${dateKey}`,
            activeExcess: repairActive ? sourcedActive - targetActive : 0,
            passiveExcess: repairPassive ? sourcedPassive - targetPassive : 0
          });
        }
        let adjustedActive = 0;
        let adjustedPassive = 0;
        for (const entry of siteEntries) {
          const active = entry.active * activeScale;
          const passive = entry.passive * passiveScale;
          adjustedActive += active;
          adjustedPassive += passive;
          queue(dateKey, languageCode, entry.sourceName, active, passive);
        }
        const remainingActive = Math.max(0, targetActive - adjustedActive);
        const remainingPassive = Math.max(0, targetPassive - adjustedPassive);
        if (remainingActive || remainingPassive) {
          queue(dateKey, languageCode, COMPACTED_SOURCE, remainingActive, remainingPassive);
        }
      }
    }
    for (const [id, values] of Object.entries(pending)) upsert(id, values);
    return records;
  }

  function totalsByLanguageDateFromLegacy(state) {
    const totals = {};
    for (const [languageCode, dates] of Object.entries(state?.languageRecords || {})) {
      for (const [dateKey, daily] of Object.entries(dates || {})) {
        totals[`${language(languageCode)}|${dateKey}`] = {
          active: number(daily?.active), passive: number(daily?.passive)
        };
      }
    }
    return totals;
  }

  function totalsByLanguageDateFromCanonical(dailyRecords) {
    const totals = {};
    for (const record of Object.values(dailyRecords || {})) {
      const key = `${language(record?.languageCode)}|${record?.dateKey}`;
      totals[key] ||= { active: 0, passive: 0 };
      totals[key].active += number(record?.activeSeconds);
      totals[key].passive += number(record?.passiveSeconds);
    }
    return totals;
  }

  function diffTotals(state, dailyRecords, epsilon = TOTAL_EPSILON_SECONDS) {
    const before = totalsByLanguageDateFromLegacy(state);
    const after = totalsByLanguageDateFromCanonical(dailyRecords);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => {
      const oldValue = before[key] || { active: 0, passive: 0 };
      const newValue = after[key] || { active: 0, passive: 0 };
      return Math.abs(oldValue.active - newValue.active) <= epsilon &&
        Math.abs(oldValue.passive - newValue.passive) <= epsilon
        ? [] : [{ key, before: oldValue, after: newValue }];
    });
  }

  function migrate(state, timestamp = Date.now()) {
    const diagnostics = { sourceAdjustments: [] };
    const dailyRecords = buildFromLegacy(state, {
      timestamp,
      migration: true,
      deriveSessionCounts: true,
      diagnostics
    });
    const dailySessionCounts = Object.fromEntries(Object.entries(dailyRecords).map(([id, record]) => [
      id, Math.max(0, Math.floor(Number(record.sessionCount) || 0))
    ]));
    const differences = diffTotals(state, dailyRecords);
    if (differences.length) return { ok: false, differences };
    return {
      ok: true,
      state: {
        ...state,
        version: SCHEMA_VERSION,
        dailyRecords,
        dailySessionCounts,
        dataModel: {
          schemaVersion: SCHEMA_VERSION,
          migratedAt: timestamp,
          migrationVerifiedAt: timestamp,
          source: "legacy-daily-totals",
          repairedSourceBreakdowns: diagnostics.sourceAdjustments.length
        }
      },
      differences: []
    };
  }

  function reconcile(state, timestamp = Date.now()) {
    const dailyRecords = buildFromLegacy(state, { timestamp, migration: false, deriveSessionCounts: false });
    const differences = diffTotals(state, dailyRecords);
    if (differences.length) return { ok: false, differences };
    state.dailyRecords = dailyRecords;
    state.dailySessionCounts = Object.fromEntries(Object.entries(dailyRecords).map(([id, record]) => [
      id, Math.max(0, Math.floor(Number(record.sessionCount) || 0))
    ]));
    state.version = SCHEMA_VERSION;
    state.dataModel ||= { schemaVersion: SCHEMA_VERSION, migratedAt: timestamp, source: "canonical-daily-totals" };
    state.dataModel.schemaVersion = SCHEMA_VERSION;
    state.dataModel.lastVerifiedAt = timestamp;
    return { ok: true, differences: [] };
  }

  function adjustSessionCount(state, details, delta) {
    const id = recordId(details.dateKey, details.languageCode, details.source);
    state.dailySessionCounts ||= {};
    state.dailySessionCounts[id] = Math.max(
      0,
      Math.floor(Number(state.dailySessionCounts[id]) || 0) + Math.trunc(Number(delta) || 0)
    );
    state.dailyRecords ||= {};
    const record = state.dailyRecords[id];
    if (!record) return state.dailySessionCounts[id];
    record.sessionCount = state.dailySessionCounts[id];
    record.updatedAt = Date.now();
    record.revision = Math.max(0, Math.floor(Number(record.revision) || 0)) + 1;
    return record.sessionCount;
  }

  class ChromeStorageAdapter {
    constructor(storageArea, primaryKey) {
      this.storageArea = storageArea;
      this.primaryKey = primaryKey;
    }
    async read(key = this.primaryKey) {
      const result = await this.storageArea.get(key);
      return result[key] ?? null;
    }
    async write(value, key = this.primaryKey) {
      await this.storageArea.set({ [key]: value });
    }
    async remove(key) {
      await this.storageArea.remove(key);
    }
  }

  const api = {
    SCHEMA_VERSION,
    RECORD_SCHEMA_VERSION,
    COMPACTED_SOURCE,
    TOTAL_EPSILON_SECONDS,
    recordId,
    createRecord,
    buildFromLegacy,
    totalsByLanguageDateFromLegacy,
    totalsByLanguageDateFromCanonical,
    diffTotals,
    migrate,
    reconcile,
    adjustSessionCount,
    ChromeStorageAdapter
  };
  globalScope.TrackerData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
