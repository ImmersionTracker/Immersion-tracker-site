(function exposeAnalyticsContract(globalScope) {
  "use strict";

  // Pure shaping/validation for anonymous product-analytics events. Same
  // rule as lib/cloud-contract.js: no fetch(), no chrome.*, so this stays
  // testable from plain node. Every field here must be safe to send with no
  // account, device, or session identifier attached - see PRIVACY.md
  // "Optional product analytics" for the exact allowed field list.

  const CONTRACT_VERSION = 1;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
  const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
  const ALLOWED_EVENT_KEYS = Object.freeze([
    "target_language", "platform", "content_type", "active_seconds", "passive_seconds",
    "event_date", "extension_version"
  ]);

  // Site names the extension auto-tracks as video playback. Anything else is
  // treated as a manual entry, where the "source" the user picked (Reading,
  // Listening, ...) becomes the broad content type instead, and the platform
  // is reported as "manual" since there is no real site involved.
  const VIDEO_PLATFORMS = Object.freeze([
    "youtube", "netflix", "disneyplus", "primevideo", "hulu", "max",
    "appletv", "paramountplus", "peacocktv", "crunchyroll", "hidive", "tubi"
  ]);

  function integer(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  }

  function normalizeLanguage(value) {
    const code = String(value || "").trim().toLowerCase().replace(/_/g, "-");
    return LANGUAGE_PATTERN.test(code) ? code.slice(0, 24) : "";
  }

  function normalizeToken(value, fallback = "other") {
    const token = String(value || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    return token || fallback;
  }

  function validDate(value) {
    if (!DATE_PATTERN.test(String(value || ""))) return false;
    const [year, month, day] = String(value).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  // Turns the extension's internal "source" string (a video site name for
  // automatic tracking, or a manual category like "reading") into the two
  // separate broad fields analytics actually asks for.
  function classifySource(sourceName) {
    const normalized = normalizeToken(sourceName);
    if (VIDEO_PLATFORMS.includes(normalized)) return { platform: normalized, contentType: "video" };
    return { platform: "manual", contentType: normalized };
  }

  function buildEvent({ languageCode, sourceName, activeSeconds, passiveSeconds, dateKey, extensionVersion } = {}) {
    const targetLanguage = normalizeLanguage(languageCode);
    if (!targetLanguage) throw new TypeError("A valid target language is required for an analytics event.");
    if (!validDate(dateKey)) throw new TypeError("Analytics events require a valid calendar date.");
    const version = String(extensionVersion || "").trim();
    if (!VERSION_PATTERN.test(version)) throw new TypeError("A valid extension version is required for an analytics event.");
    const { platform, contentType } = classifySource(sourceName);
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      targetLanguage,
      platform,
      contentType,
      activeSeconds: integer(activeSeconds),
      passiveSeconds: integer(passiveSeconds),
      eventDate: dateKey,
      extensionVersion: version
    });
  }

  function toDatabaseRow(event) {
    return {
      target_language: event.targetLanguage,
      platform: event.platform,
      content_type: event.contentType,
      active_seconds: event.activeSeconds,
      passive_seconds: event.passiveSeconds,
      event_date: event.eventDate,
      extension_version: event.extensionVersion
    };
  }

  // Guards against ever sending a field this contract doesn't know about -
  // the same "closed allowlist" shape check lib/cloud-contract.js uses, so a
  // stray extra key (a title, a URL, anything) fails loudly instead of
  // silently reaching the network.
  function isPrivacySafeRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    if (Object.keys(row).some((key) => !ALLOWED_EVENT_KEYS.includes(key))) return false;
    if (!normalizeLanguage(row.target_language) || normalizeLanguage(row.target_language) !== row.target_language) return false;
    if (normalizeToken(row.platform) !== row.platform) return false;
    if (normalizeToken(row.content_type) !== row.content_type) return false;
    if (!validDate(row.event_date)) return false;
    if (!VERSION_PATTERN.test(String(row.extension_version || ""))) return false;
    for (const key of ["active_seconds", "passive_seconds"]) {
      if (!Number.isInteger(Number(row[key])) || Number(row[key]) < 0) return false;
    }
    return true;
  }

  // Local-only bookkeeping (never uploaded itself) so the same day's totals
  // for the same bucket aren't re-sent every time they tick upward by a few
  // seconds. Keyed the same way tracker-data.js keys a daily record.
  function bucketId(dateKey, languageCode, sourceName) {
    return [String(dateKey), normalizeLanguage(languageCode), encodeURIComponent(normalizeToken(sourceName).toLowerCase())].join("|");
  }

  function createAnalyticsState(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      schemaVersion: CONTRACT_VERSION,
      queue: source.queue && typeof source.queue === "object" ? { ...source.queue } : {},
      reported: source.reported && typeof source.reported === "object" ? { ...source.reported } : {},
      lastSendAt: integer(source.lastSendAt),
      lastError: source.lastError ? String(source.lastError).slice(0, 180) : ""
    };
  }

  // Compares each canonical daily record against what was last successfully
  // reported for that bucket and queues only the ones whose totals moved.
  // dailyRecords is the same {id -> {dateKey, languageCode, source,
  // activeSeconds, passiveSeconds}} shape lib/tracker-data.js produces.
  function planEvents(dailyRecords, reported, options = {}) {
    const events = [];
    for (const record of Object.values(dailyRecords || {})) {
      if (!record?.dateKey || !record?.languageCode) continue;
      const id = bucketId(record.dateKey, record.languageCode, record.source);
      const signature = `${integer(record.activeSeconds)}|${integer(record.passiveSeconds)}`;
      if (reported?.[id] === signature) continue;
      try {
        const event = buildEvent({
          languageCode: record.languageCode,
          sourceName: record.source,
          activeSeconds: record.activeSeconds,
          passiveSeconds: record.passiveSeconds,
          dateKey: record.dateKey,
          extensionVersion: options.extensionVersion
        });
        events.push({ id, signature, event });
      } catch {
        // Skip records that don't have enough to build a valid event yet
        // (e.g. zero-second placeholder rows) rather than failing the batch.
      }
    }
    return events.sort((a, b) => a.id.localeCompare(b.id));
  }

  const api = {
    CONTRACT_VERSION,
    ALLOWED_EVENT_KEYS,
    VIDEO_PLATFORMS,
    classifySource,
    buildEvent,
    toDatabaseRow,
    isPrivacySafeRow,
    bucketId,
    createAnalyticsState,
    planEvents
  };
  globalScope.TrackerAnalyticsContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
