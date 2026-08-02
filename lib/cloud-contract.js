(function exposeCloudContract(globalScope) {
  "use strict";

  const CONTRACT_VERSION = 1;
  const CLOUD_STATE_VERSION = 1;
  const MAX_BATCH_SIZE = 100;
  const MAX_ATTEMPTS = 8;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
  const ALLOWED_ROW_KEYS = Object.freeze([
    "device_id", "generation", "date_key", "language_code", "source",
    "active_seconds", "passive_seconds", "session_count", "revision",
    "client_updated_at", "contract_version"
  ]);

  function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.round(parsed)) : 0;
  }

  function normalizeDeviceId(value) {
    return String(value || "").trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 128);
  }

  function normalizeLanguage(value) {
    const code = String(value || "").trim().toLowerCase().replace(/_/g, "-");
    return LANGUAGE_PATTERN.test(code) ? code.slice(0, 24) : "";
  }

  function normalizeSource(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function validDate(value) {
    if (!DATE_PATTERN.test(String(value || ""))) return false;
    const [year, month, day] = String(value).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function snapshotKey({ deviceId, generation = 0, dateKey, languageCode, source }) {
    return [normalizeDeviceId(deviceId), integer(generation), String(dateKey), normalizeLanguage(languageCode), encodeURIComponent(normalizeSource(source).toLowerCase())].join("|");
  }

  function createSnapshot(record, options = {}) {
    const deviceId = normalizeDeviceId(options.deviceId);
    const dateKey = String(record?.dateKey || "");
    const languageCode = normalizeLanguage(record?.languageCode);
    const source = normalizeSource(record?.source);
    if (deviceId.length < 8) throw new TypeError("A stable device ID is required for cloud snapshots.");
    if (!validDate(dateKey)) throw new TypeError("Cloud snapshots require a valid local calendar date.");
    if (!languageCode) throw new TypeError("Cloud snapshots require a valid language code.");
    if (!source) throw new TypeError("Cloud snapshots require a source.");
    const generation = integer(options.generation);
    if (generation < 1) throw new TypeError("Cloud snapshots require a positive data generation.");
    const updatedAt = integer(record?.updatedAt) || integer(options.now) || Date.now();
    const snapshot = {
      contractVersion: CONTRACT_VERSION,
      snapshotId: "upsert:" + snapshotKey({ deviceId, generation, dateKey, languageCode, source }),
      deviceId,
      generation,
      dateKey,
      languageCode,
      source,
      activeSeconds: integer(record?.activeSeconds),
      passiveSeconds: integer(record?.passiveSeconds),
      sessionCount: integer(record?.sessionCount, 2147483647),
      revision: integer(record?.revision),
      clientUpdatedAt: new Date(updatedAt).toISOString()
    };
    return Object.freeze(snapshot);
  }

  function toDatabaseRow(snapshot) {
    const safe = createSnapshot({
      dateKey: snapshot.dateKey,
      languageCode: snapshot.languageCode,
      source: snapshot.source,
      activeSeconds: snapshot.activeSeconds,
      passiveSeconds: snapshot.passiveSeconds,
      sessionCount: snapshot.sessionCount,
      revision: snapshot.revision,
      updatedAt: Date.parse(snapshot.clientUpdatedAt)
    }, { deviceId: snapshot.deviceId, generation: snapshot.generation });
    return {
      device_id: safe.deviceId,
      generation: safe.generation,
      date_key: safe.dateKey,
      language_code: safe.languageCode,
      source: safe.source,
      active_seconds: safe.activeSeconds,
      passive_seconds: safe.passiveSeconds,
      session_count: safe.sessionCount,
      revision: safe.revision,
      client_updated_at: safe.clientUpdatedAt,
      contract_version: safe.contractVersion
    };
  }

  function isPrivacySafeRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    if (Object.keys(row).some((key) => !ALLOWED_ROW_KEYS.includes(key))) return false;
    if (Number(row.contract_version) !== CONTRACT_VERSION) return false;
    if (normalizeDeviceId(row.device_id) !== row.device_id || row.device_id.length < 8) return false;
    if (integer(row.generation) !== Number(row.generation) || Number(row.generation) < 1) return false;
    if (!validDate(row.date_key) || normalizeLanguage(row.language_code) !== row.language_code) return false;
    if (!normalizeSource(row.source) || normalizeSource(row.source) !== row.source) return false;
    for (const key of ["active_seconds", "passive_seconds", "session_count", "revision"]) {
      if (!Number.isInteger(Number(row[key])) || Number(row[key]) < 0) return false;
    }
    const updatedAt = Date.parse(row.client_updated_at);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
    try {
      const snapshot = createSnapshot({
        dateKey: row.date_key,
        languageCode: row.language_code,
        source: row.source,
        activeSeconds: row.active_seconds,
        passiveSeconds: row.passive_seconds,
        sessionCount: row.session_count,
        revision: row.revision,
        updatedAt
      }, { deviceId: row.device_id, generation: row.generation });
      return snapshot.contractVersion === Number(row.contract_version);
    } catch {
      return false;
    }
  }

  function remoteRevision(remoteIndex, snapshot) {
    const value = remoteIndex?.[snapshot.snapshotId] ?? remoteIndex?.[snapshot.snapshotId.slice(7)];
    return integer(typeof value === "object" ? value?.revision : value);
  }

  function planUploads(dailyRecords, remoteIndex, options = {}) {
    return Object.values(dailyRecords || {})
      .map((record) => createSnapshot(record, options))
      .filter((snapshot) => snapshot.revision > remoteRevision(remoteIndex, snapshot))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.snapshotId.localeCompare(b.snapshotId));
  }

  function queueEntry(snapshot, now = Date.now()) {
    return {
      id: snapshot.snapshotId,
      operation: "upsert",
      payload: toDatabaseRow(snapshot),
      attempts: 0,
      nextAttemptAt: integer(now),
      lastError: "",
      queuedAt: integer(now)
    };
  }

  function mergeQueue(current, snapshots, now = Date.now()) {
    const queue = Object.fromEntries(Object.entries(current || {}).filter(([, entry]) => entry?.operation === "upsert"));
    for (const snapshot of snapshots || []) {
      const existing = queue[snapshot.snapshotId];
      queue[snapshot.snapshotId] = {
        ...queueEntry(snapshot, now),
        queuedAt: existing?.queuedAt || integer(now)
      };
    }
    return queue;
  }

  function readyBatch(queue, now = Date.now(), limit = MAX_BATCH_SIZE) {
    return Object.values(queue || {})
      .filter((entry) => entry?.operation === "upsert" && integer(entry.nextAttemptAt) <= Number(now) && integer(entry.attempts) < MAX_ATTEMPTS)
      .sort((a, b) => integer(a.queuedAt) - integer(b.queuedAt) || String(a.id).localeCompare(String(b.id)))
      .slice(0, Math.max(1, Math.min(MAX_BATCH_SIZE, integer(limit) || MAX_BATCH_SIZE)));
  }

  function retryEntry(entry, error, now = Date.now()) {
    const attempts = integer(entry?.attempts) + 1;
    const delay = Math.min(60 * 60 * 1000, 5000 * (2 ** Math.min(8, attempts - 1)));
    return {
      ...entry,
      attempts,
      nextAttemptAt: integer(now) + delay,
      lastError: String(error?.message || error || "Upload failed.").replace(/\s+/g, " ").trim().slice(0, 180)
    };
  }

  function createCloudState(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      schemaVersion: CLOUD_STATE_VERSION,
      enabled: false,
      provider: "supabase",
      generation: integer(source.generation),
      deviceRegistered: source.deviceRegistered === true,
      remoteRevisions: source.remoteRevisions && typeof source.remoteRevisions === "object" ? { ...source.remoteRevisions } : {},
      queue: source.queue && typeof source.queue === "object" ? { ...source.queue } : {},
      lastUploadAt: integer(source.lastUploadAt),
      lastDownloadAt: integer(source.lastDownloadAt),
      lastError: source.lastError ? String(source.lastError).slice(0, 180) : ""
    };
  }

  const api = {
    CONTRACT_VERSION,
    CLOUD_STATE_VERSION,
    MAX_BATCH_SIZE,
    MAX_ATTEMPTS,
    ALLOWED_ROW_KEYS,
    snapshotKey,
    createSnapshot,
    toDatabaseRow,
    isPrivacySafeRow,
    planUploads,
    queueEntry,
    mergeQueue,
    readyBatch,
    retryEntry,
    createCloudState
  };
  globalScope.TrackerCloudContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
