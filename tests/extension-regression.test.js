const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const content = read("content.js");
const background = read("background.js");
const popup = read("popup.js");
const popupHtml = read("popup.html");
const popupCss = read("popup.css");
const dashboard = read("store-assets/dashboard.js");
const dashboardHtml = read("store-assets/dashboard.html");
const manifest = JSON.parse(read("manifest.json"));

function values(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]);
}

function testManifestAndMessageContracts() {
  assert.equal(manifest.version, "1.9.4", "release version changed unexpectedly");
  assert(manifest.permissions.includes("unlimitedStorage"), "long-term local history needs unlimited storage");
  assert(background.includes('setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })'),
    "local and synced tracker data should not be directly exposed to content scripts");
  assert.equal(manifest.incognito, "not_allowed", "private browsing should not be tracked");
  assert.equal(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self'; object-src 'self';",
    "extension pages need a self-only content security policy"
  );
  const contentMatches = new Set(manifest.content_scripts[0].matches);
  const hostPermissions = new Set(manifest.host_permissions);
  // The only host permission allowed beyond what content scripts inject into
  // is the Supabase wildcard the background service worker needs for its own
  // fetch() calls (cloud sync). Anything else creeping in here is a regression.
  assert(hostPermissions.has("https://*.supabase.co/*"), "background.js needs host_permissions for its own Supabase fetch calls");
  hostPermissions.delete("https://*.supabase.co/*");
  assert.deepEqual(hostPermissions, contentMatches);

  const packagedFiles = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
  ].filter(Boolean);
  for (const filename of new Set(packagedFiles)) {
    assert(fs.existsSync(path.join(root, filename)), `manifest references missing file ${filename}`);
  }

  const broadcastStart = background.indexOf("async function broadcastOverlayPreferences");
  const broadcastEnd = background.indexOf("function hashBucket", broadcastStart);
  const broadcastMatches = new Set(values(
    background.slice(broadcastStart, broadcastEnd),
    /"(https:\/\/[^"\n]+)"/g
  ));
  assert.deepEqual(broadcastMatches, contentMatches);

  const backgroundHandlers = new Set(values(background, /message\.type\s*===\s*"([^"]+)"/g));
  const contentHandlers = new Set(values(content, /message\.type\s*===\s*"([^"]+)"/g));
  const popupRuntimeMessages = values(popup, /sendRuntimeMessage\(\{\s*type:\s*"([^"]+)"/g);
  const popupTabMessages = values(popup, /sendTabMessage\([^,]+,\s*\{\s*type:\s*"([^"]+)"/g);
  const contentRuntimeMessages = values(content, /sendMessage\(\{\s*type:\s*"([^"]+)"/g);

  for (const type of new Set([...popupRuntimeMessages, ...contentRuntimeMessages])) {
    assert(backgroundHandlers.has(type), `background.js does not handle ${type}`);
  }
  for (const type of new Set(popupTabMessages)) {
    assert(contentHandlers.has(type), `content.js does not handle ${type}`);
  }
}

function testPopupElementContracts() {
  const ids = values(popupHtml, /\bid="([^"]+)"/g);
  assert.equal(ids.length, new Set(ids).size, "popup.html contains duplicate IDs");

  const referencedIds = values(popup, /getElementById\("([^"]+)"\)/g);
  for (const id of new Set(referencedIds)) {
    assert(ids.includes(id), `popup.js references missing #${id}`);
  }

  for (const match of popupHtml.matchAll(/<dialog\b([^>]*)>/g)) {
    const attributes = match[1];
    const dialogId = attributes.match(/\bid="([^"]+)"/)?.[1] || "dialog";
    const labelledBy = attributes.match(/\baria-labelledby="([^"]+)"/)?.[1];
    assert(labelledBy && ids.includes(labelledBy), `${dialogId} needs a valid accessible label`);
  }
  for (const match of popupHtml.matchAll(/<button\b([^>]*class="[^"]*icon-button[^"]*"[^>]*)>/g)) {
    assert(/\baria-label="[^"]+"/.test(match[1]), "icon-only close buttons need accessible labels");
  }

  const buttonIds = values(popupHtml, /<button\b[^>]*\bid="([^"]+)"/g);
  for (const id of buttonIds) {
    assert(
      popup.includes(`"${id}"`) || popup.includes(`'${id}'`),
      `button #${id} is not wired in popup.js`
    );
  }

  const generatedOverlayActions = new Set(values(content, /data-action=["']([^"']+)["']/g));
  const wiredOverlayActions = new Set(values(content, /\[data-action=["']([^"']+)["']\]/g));
  assert.deepEqual(generatedOverlayActions, wiredOverlayActions, "a video-overlay action is not wired");

  const languageSelectStart = popupHtml.indexOf('<select id="targetLanguageSelect"');
  const languageSelectEnd = popupHtml.indexOf("</select>", languageSelectStart);
  const languageCodes = values(
    popupHtml.slice(languageSelectStart, languageSelectEnd),
    /<option value="([^"]+)"/g
  ).filter((code) => code !== "custom");
  assert.equal(languageCodes.length, new Set(languageCodes).size, "duplicate target-language entries");
  const languageNamesStart = background.indexOf("const LANGUAGE_NAMES");
  const languageNamesEnd = background.indexOf("};", languageNamesStart);
  const languageNamesSource = background.slice(languageNamesStart, languageNamesEnd);
  for (const code of languageCodes) {
    assert(new RegExp(`(?:^|[,\\s{])${code}:`).test(languageNamesSource), `missing language name for ${code}`);
  }
}

function testBackdatedQuickAdd() {
  assert(
    popupHtml.includes('id="customDate" type="date" required'),
    "Quick add needs a required date field"
  );
  assert(
    popup.includes("customDateInput.value = localDateKey()") &&
      popup.includes("customDateInput.max = localDateKey()"),
    "Quick add date should default to today and reject future dates"
  );
  assert(popup.includes("date: selectedDate"), "Quick add should send its selected date");
  assert(
    background.includes("const selectedDate = parseLocalDateKey(message.date || localDateKey())") &&
      background.includes("dateKey: selectedDate"),
    "completed immersion should be recorded against the selected date"
  );
}

function testPermanentDailyBreakdownsAndStorageUsage() {
  const dateHelpersStart = background.indexOf("function localDateKey");
  const dateHelpersEnd = background.indexOf("function monthKeyFromDateKey", dateHelpersStart);
  const compactionStart = background.indexOf("function compactOldHistory");
  const compactionEnd = background.indexOf("async function readState", compactionStart);
  const helpers = new Function(
    "STORAGE_MAINTENANCE_INTERVAL_MS",
    background.slice(dateHelpersStart, dateHelpersEnd) +
      background.slice(compactionStart, compactionEnd) +
      "\nreturn { compactOldHistory };"
  )(24 * 60 * 60 * 1000);
  const sessions = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [
    "session-" + (index + 1),
    { title: "Title " + (index + 1), contentKey: "readable-content", lastAt: index + 1,
      byDate: { "2025-01-01": { active: 60, passive: 0 } } }
  ]));
  const state = {
    languageRecords: { ja: {
      "2026-01-16": { active: 60, passive: 120, sites: { youtube: { active: 60, passive: 120 } } },
      "2026-01-17": { active: 30, passive: 0, sites: { reading: { active: 30, passive: 0 } } }
    } },
    sessions,
    maintenance: { lastCompactedAt: 0, detailCutoffDate: "" }
  };
  const now = new Date("2026-07-17T12:00:00").getTime();
  const result = helpers.compactOldHistory(state, now, true);
  assert.equal(result.cutoffDate, "");
  assert.deepEqual(state.languageRecords.ja["2026-01-16"], { active: 60, passive: 120, sites: { youtube: { active: 60, passive: 120 } } },
    "daily source breakdowns must remain available indefinitely");
  assert.equal(Object.keys(state.sessions).length, 10, "only the latest ten readable History entries should remain");
  assert(!state.sessions["session-1"] && state.sessions["session-11"], "History retention should use recency, not age");
  assert(!Object.values(state.sessions).some((session) => "contentKey" in session),
    "saved History entries should not retain separate content identifiers");
  assert(popupHtml.includes('id="storageUsageStatus"') && popupHtml.includes('id="refreshStorageUsage"'),
    "Settings should display refreshable storage usage");
  assert(background.includes('message.type === "getStorageUsage"'), "storage usage needs a background handler");
  assert(background.includes("dailyBreakdownsPermanent: true"), "storage status should report permanent daily breakdowns");
  assert(popup.includes('"compacted total"'), "CSV exports should preserve compacted daily totals");
  assert(background.includes('return normalizeLanguageCode(languageCode) + "|" + opaqueStorageKey(key)') &&
    background.includes('rawKey.startsWith("h:")') &&
    background.includes('decisionStorageKey(languageCode, rawKey)'),
    "remembered exact-content and related-content decisions should use opaque keys");
  assert(!background.includes("learning.sourceLabel ="), "source-learning state must not retain readable channel names");
  assert(popupHtml.includes("Total source score") && popup.includes("formatSourceScore(seconds)"),
    "Insights should show cumulative source totals with compact units");
  assert(popupHtml.includes('id="storageErrorBanner"') && background.includes('reason: "storage-write-failed"'),
    "storage write failures should be visible instead of silently losing time");
  assert(background.includes("key.startsWith(SYNC_SOURCE_TOTAL_PREFIX)") &&
    background.includes("[SYNC_RESET_KEY]: { resetAt }"),
    "backup restore/reset must clear stale per-device records and cumulative source snapshots");
}

function testManualMidnightSegments() {
  const localStart = background.indexOf("function localDateKey");
  const localEnd = background.indexOf("function parseLocalDateKey", localStart);
  const segmentStart = background.indexOf("function manualTimeSegments");
  const segmentEnd = background.indexOf("function checkpointManualTimer", segmentStart);
  const segment = new Function(
    background.slice(localStart, localEnd) + background.slice(segmentStart, segmentEnd) +
      "\nreturn manualTimeSegments;"
  )();
  const start = new Date(2026, 6, 16, 23, 59, 30).getTime();
  const end = new Date(2026, 6, 17, 0, 0, 30).getTime();
  assert.deepEqual(segment(start, end).map((item) => [item.dateKey, item.seconds]), [
    ["2026-07-16", 30], ["2026-07-17", 30]
  ], "manual time crossing midnight must be split between both streak dates");
}

function testSourceScoreUnits() {
  const start = popup.indexOf("function formatSourceScore");
  const end = popup.indexOf("function sessionTotals", start);
  const format = new Function(popup.slice(start, end) + "\nreturn formatSourceScore;")();
  assert.equal(format(359 * 60), "359m");
  assert.equal(format(360 * 60), "6h");
  assert.equal(format(390 * 60), "6.5h");
  assert(popup.includes("state.sourceTotals?.[code] || {}"),
    "Total source score must use lifetime cumulative totals, not the six-month daily breakdown");
  assert(popupHtml.includes('class="surface source-score-card"') &&
    popupHtml.includes('class="insights-column"'),
    "lifetime source totals should remain a separate card in the compact Insights columns");
  assert(!popupHtml.includes("insights-grid"), "Weekly immersion must not visually contain lifetime source totals");
  assert(background.includes("flushDirtyMonths({ force: true })"),
    "Sync now must write cumulative source totals even when no month is dirty");
  assert(popup.includes("Chrome Sync: could not save."), "manual Sync failures need visible feedback");
}

function testMismatchEvidenceNamesTheLanguage() {
  const namesStart = content.indexOf("  const LANGUAGE_NAMES");
  const namesEnd = content.indexOf("  function normalizeLanguageCode", namesStart);
  const helperStart = content.indexOf("  function namedOtherLanguage");
  const helperEnd = content.indexOf("  function findPrimaryOtherLanguageEvidence", helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, "namedOtherLanguage must exist in content.js");

  const named = new Function(`
    ${content.slice(namesStart, namesEnd)}
    function normalizeLanguageCode(value) { return String(value || "").trim().toLowerCase().replace(/_/g, "-"); }
    function languageFromCode(value) {
      const code = normalizeLanguageCode(value).split("-")[0];
      return LANGUAGE_NAMES[code] ? { code, name: LANGUAGE_NAMES[code] } : null;
    }
    ${content.slice(helperStart, helperEnd)}
    return namedOtherLanguage;
  `)();

  assert.equal(named("es"), "Spanish", "a known code must resolve to its language name");
  assert.equal(named("pt-BR"), "Portuguese", "a regional code must resolve through its base language");
  assert.equal(named("qq", "Klingon (auto-generated)"), "Klingon",
    "an unknown code must fall back to the track label with the auto-generated suffix stripped");
  assert.equal(named("qq"), "QQ", "an unknown code with no label must still be shown rather than hidden");
  assert.equal(named(""), "", "no evidence must produce no name, so the caller keeps the vague wording");

  assert(content.includes('"YouTube\'s automatic captions identify the spoken language as "'),
    "the caption mismatch message must name the detected language");
  assert(content.includes('"YouTube reports " + hintName + " as the primary audio language, not "'),
    "the audio-hint mismatch message must name the detected language");
  // The vague wording may survive only as the branch taken when nothing is named.
  const evidence = content.slice(
    content.indexOf("  function findPrimaryOtherLanguageEvidence"),
    content.indexOf("  function targetScriptPattern")
  );
  assert(/captionName\s*\?[\s\S]*?:\s*"YouTube's automatic captions identify another spoken language\."/.test(evidence),
    "the unnamed caption wording must be the fallback branch, not the only message");
  assert(/hintName\s*\?[\s\S]*?:\s*"YouTube reports another language as the primary audio language\."/.test(evidence),
    "the unnamed audio wording must be the fallback branch, not the only message");
}

function testManualTimerProgressAndIndicator() {
  assert(background.includes('message.type === "saveManualTimerProgress"'),
    "a long manual session must be bankable without stopping the timer");
  const save = background.slice(
    background.indexOf('if (message.type === "saveManualTimerProgress")'),
    background.indexOf('if (message.type === "pauseManualTimer")')
  );
  assert(save.includes("checkpointManualTimer()") && !save.includes("stop: true"),
    "saving progress must checkpoint without stopping the timer");
  assert(popupHtml.includes('id="saveManualProgressButton"'), "the popup needs a Save progress control");
  assert(popup.includes('sendRuntimeMessage({ type: "saveManualTimerProgress" })'),
    "the Save progress control must be wired to the background");
  assert(popup.includes('saveProgressButton.classList.toggle("hidden", !running)'),
    "Save progress is only meaningful while the timer runs");

  // A running timer needs to be visible from outside the popup.
  assert(background.includes("async function setManualTimerBadge"),
    "a running manual timer needs a toolbar badge, like the automatic A/P badge");
  const badge = background.slice(
    background.indexOf("async function setManualTimerBadge"),
    background.indexOf("async function refreshTabContext")
  );
  assert(badge.includes('chrome.action.setBadgeText({ text: "M" })'),
    "the manual badge must be distinguishable from the A/P badge");
  assert(!badge.includes("tabId"),
    "the manual timer is global, so its badge must not be scoped to one tab");
  assert(badge.includes('chrome.action.setBadgeText({ text: "" })'),
    "stopping the timer must clear the badge");
  assert(background.includes("refreshManualTimerBadge().catch(() => null);"),
    "the badge must be re-asserted when the service worker restarts");
  assert(/checkpointManualTimer\([^)]*\)[\s\S]{0,120}setManualTimerBadge/.test(background),
    "every checkpoint must keep the badge's elapsed time honest");
}

function testAutomaticModeBooksTheDetectedLanguage() {
  // "auto" is a mode, not a bucket. Nothing may ever be filed under it.
  assert(background.includes("function isStorableLanguageCode"),
    "background must have one rule for what counts as a real storage language");
  const guard = new Function("normalizeLanguageCode", `
    ${background.slice(background.indexOf("function isStorableLanguageCode"), background.indexOf("function normalizeStoredAutomaticLanguageMap"))}
    return isStorableLanguageCode;
  `)((value) => String(value || "").trim().toLowerCase());
  assert.equal(guard("auto"), false, '"auto" must never be a storage bucket');
  assert.equal(guard("und"), false, "an undecided language must never be a storage bucket");
  assert.equal(guard(""), false, "an empty code must never be a storage bucket");
  assert.equal(guard("en"), true, "a real language must be storable");

  const tickStart = background.indexOf('if (message.type === "addTick")');
  const tickEnd = background.indexOf('if (message.type === "status")', tickStart);
  const tick = background.slice(tickStart, tickEnd > tickStart ? tickEnd : tickStart + 4000);
  assert(tick.includes("if (!isStorableLanguageCode(languageCode))") &&
    tick.includes('ignored: "language-not-identified"'),
    "addTick must hold time rather than create an \"auto\" bucket");
  assert(tick.indexOf("isStorableLanguageCode(languageCode)") < tick.indexOf("ensureRecord(state, dateKey, site, languageCode)"),
    "the guard must run before the record bucket is created");

  // The content script must send what it identified, not the mode name.
  assert(content.includes("const tickLanguageCode = activeLanguage().code;"),
    "ticks must carry the identified language, not targetLanguage.code");
  assert(content.includes("languageCode: activeLanguage().code,") &&
    content.includes("languageName: activeLanguage().name,"),
    "the status message must report the language time is actually booked under");

  assert(content.includes("function identifyPageLanguage"),
    "Automatic mode needs an identify-what-this-is path, not only a compare-to-target one");
  const identify = content.slice(
    content.indexOf("  function identifyPageLanguage"),
    content.indexOf("  function detectTargetLanguage")
  );
  for (const source of ["selectedAudioLabels()", "pageProbe.audioTracks", "pageProbe.hints", "pageProbe.captions", "languageFromScript"]) {
    assert(identify.includes(source), `identifyPageLanguage must consider ${source}`);
  }
  assert(identify.indexOf("selectedAudioLabels()") < identify.indexOf("pageProbe.captions"),
    "the selected audio track must outrank captions as evidence");
  assert(!/transcri|audioContext|MediaRecorder|fetch\(/.test(identify),
    "identification must stay on player metadata and never touch audio or the network");

  // Automatic mode must not fall through to the target-comparison flow.
  const resolve = content.slice(
    content.indexOf("  async function resolveLanguage"),
    content.indexOf("  async function monitorStreamingAudioLanguage")
  );
  assert(resolve.includes("if (isAutomaticLanguageMode()) {") &&
    resolve.indexOf("isAutomaticLanguageMode()") < resolve.indexOf("detectTargetLanguage(info)"),
    "Automatic mode must resolve before the target-based detection runs");
  assert(resolve.indexOf("isAutomaticLanguageMode()") < resolve.indexOf("overlayPreferences.fullyManualEnabled"),
    "Automatic mode must outrank fully manual counting, which cannot supply a language");

  // A remembered answer, then detection, then the prompt.
  const automatic = content.slice(
    content.indexOf("  async function resolveAutomaticLanguage"),
    content.indexOf("  async function resolveLanguage")
  );
  assert(automatic.indexOf('type: "getAutomaticLanguageChoice"') < automatic.indexOf("identifyPageLanguage(info)"),
    "a remembered answer must win over fresh detection");
  assert(automatic.indexOf('type: "getDecision"') < automatic.indexOf('type: "getAutomaticLanguageChoice"'),
    '"don\'t count this video" must outrank a language remembered for the same video');
  assert(automatic.includes("const run = ++automaticResolutionSequence;") && automatic.includes("if (stale()) return;"),
    "a resolver that loses the race must not overwrite the user's answer");
  assert(automatic.indexOf('languageChoices = ranking;') < automatic.indexOf('languageState = "awaiting-language"'),
    "the dropdown's options must exist before the state that renders them");

  // retryDetection runs every second; re-resolving would rebuild the picker.
  const retry = content.slice(content.indexOf("  function retryDetection"), content.indexOf("  function confirmAutomaticLanguage"));
  assert(retry.includes('if (languageState === "awaiting-language") {') &&
    retry.indexOf('languageState === "awaiting-language"') < retry.indexOf("resolveAutomaticLanguage(currentInfo)"),
    "an open language picker must not be rebuilt by the one-second retry loop");

  // A declined video must stay declined when the audio track changes.
  const monitor = content.slice(
    content.indexOf("  async function monitorStreamingAudioLanguage"),
    content.indexOf("  function isYouTubeAdPlaying")
  );
  assert(monitor.includes('if (!["confirmed", "checking"].includes(languageState)) return;'),
    "an audio-track change must not resurrect a video the user declined");

  // Legacy "auto" data must stay visible in the one view that means "all of it".
  assert(background.includes('if (!isStorableLanguageCode(code) && normalizeLanguageCode(code) !== "auto") continue;'),
    "time already recorded in the legacy auto bucket must not vanish from combined totals");
  assert(background.includes("function sessionLanguageCode"),
    "a session must be rolled back from the same bucket it was written to");
  assert(background.includes("function strictLanguageCode"),
    'manualLanguageCode needs a normalizer that can say "no code", since normalizeLanguageCode answers "ja"');
  const strict = new Function(`${background.slice(background.indexOf("function strictLanguageCode"), background.indexOf("function normalizeTargetLanguage"))}\nreturn strictLanguageCode;`)();
  assert.equal(strict(undefined), "", "a missing code must not silently become Japanese");
  assert.equal(strict("!!"), "", "an unparseable code must not silently become Japanese");
  assert.equal(strict("auto"), "auto", "the mode name must survive so legacy buckets stay addressable");
  assert.equal(strict("pt-BR"), "pt-br", "a real code must pass through");
  assert(automatic.indexOf("identifyPageLanguage(info)") < automatic.indexOf('languageState = "awaiting-language"'),
    "the user is only asked once detection has failed");
  assert(automatic.includes('type: "getLanguageRanking"'),
    "the prompt must offer languages ranked by what the user actually immerses in");

  assert(content.includes('["checking", "awaiting", "awaiting-language"].includes(languageState)'),
    "time must be held while the Automatic-mode prompt is unanswered");

  // The popup filters live status by language, which "auto" can never match.
  assert(popup.includes('target.code === "auto" ||\n    rawCurrent.languageCode === target.code'),
    "Automatic mode must accept the live status of whatever language was identified");
  assert(popup.includes('"Automatic (" + detectedName + ")"'),
    "the chip must keep the mode visible alongside the identified language");
  assert(background.includes('message.type === "getLanguageRanking"') &&
    background.includes('message.type === "saveAutomaticLanguageChoice"') &&
    background.includes('message.type === "getAutomaticLanguageChoice"'),
    "the background must serve the ranking and remember the user's answer");
}

function testSyncFailureNamesTheLimit() {
  const start = background.indexOf("function formatSyncBytes");
  const end = background.indexOf("async function flushDirtyMonths", start);
  assert(start >= 0 && end > start, "describeSyncFailure must exist in background.js");
  const describe = new Function(
    "chrome",
    background.slice(start, end) + "\nreturn describeSyncFailure;"
  )({ runtime: {} });

  const payload = { "jitRecordV2:device:2026-07": { blob: "x".repeat(9000) } };
  const perItem = describe(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"), payload);
  assert(/8KB per-item/.test(perItem) && /jitRecordV2:device:2026-07/.test(perItem),
    "a per-item overflow must name the limit and the oversized entry, got: " + perItem);
  assert(/8\.8KB|8\.9KB|9(\.\d)?KB/.test(perItem), "the oversized entry's size should be reported, got: " + perItem);

  assert(/100KB/.test(describe(new Error("QUOTA_BYTES quota exceeded"), {})),
    "a total-quota overflow must name the 100KB limit");
  assert(/120/.test(describe(new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded"), {})),
    "a per-minute write cap must name the 120/min limit");
  assert(/1800/.test(describe(new Error("MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded"), {})),
    "a per-hour write cap must name the 1800/hour limit");
  assert(/512/.test(describe(new Error("MAX_ITEMS quota exceeded"), {})),
    "an item-count overflow must name the 512-item limit");
  assert(/refused the write: Kaboom/.test(describe(new Error("Kaboom"), {})),
    "an unrecognised failure must still pass Chrome's own message through");

  assert(!/} catch \{\s*return \{ ok: false, synced: 0, reason: "chrome-sync-unavailable" \};/.test(background),
    "flushDirtyMonths must not swallow the sync error again");
  assert(background.includes("latest.sync.lastError = message.slice(0, 180)"),
    "a failed flush must record the reason so the popup can show it without a manual retry");
  assert(popup.includes("sync.lastError"), "the popup must render a stored sync failure");
}

async function testStorageWriteFailureRecovery() {
  const start = background.indexOf("function updateState");
  const end = background.indexOf("dataReady = initializeCanonicalData", start);
  let writes = 0;
  const factory = new Function("readState", "writeState", "compactOldHistory", "TrackerEntitlements", "TrackerData", "enqueuePendingCloudSnapshots", "enqueuePendingAnalyticsEvents", `
    let stateQueue = Promise.resolve();
    let dashboardCache = { at: 0, languageCode: "", records: null };
    let lastStorageWriteError = null;
    ${background.slice(start, end)}
    return { updateState, getError: () => lastStorageWriteError };
  `)(
    async () => ({ value: 0 }),
    async () => { writes += 1; if (writes === 1) throw new Error("quota full"); },
    () => null,
    { normalize: (value) => value || {} },
    { reconcile: () => ({ ok: true, differences: [] }) },
    async () => null,
    () => null
  );
  const failed = await factory.updateState((state) => { state.value = 1; return { ok: true }; });
  assert.equal(failed.reason, "storage-write-failed");
  assert(factory.getError()?.message.includes("quota full"));
  const recovered = await factory.updateState((state) => { state.value = 2; return { ok: true }; });
  assert.equal(recovered.ok, true, "the serialized state queue should recover after a failed write");
  assert.equal(factory.getError(), null);
}

function testOptionalGoalPeriodButtons() {
  assert(
    popup.includes("button.hidden = optionalHidden"),
    "disabled Month and Year goal-period buttons should be hidden"
  );
  assert(
    popup.includes('selectedGoalPeriod = "daily"'),
    "the goal card should return to Day when its selected optional goal is disabled"
  );
  assert(
    popupCss.includes(".period-selector{display:flex;flex:1") &&
      popupCss.includes("justify-content:flex-end") &&
      popupCss.includes(".period-button[hidden]{display:none}"),
    "visible goal-period buttons should stay grouped at the right"
  );
}

function testFullyManualAndGoalPreferences() {
  const helperStart = popup.indexOf("function normalizeGoalCountingMode");
  const helperEnd = popup.indexOf("function applyTheme", helperStart);
  const helpers = new Function(
    popup.slice(helperStart, helperEnd) +
      "\nreturn { normalizeGoalCountingMode, normalizeGoalDisplayMode, goalRecordTotal };"
  )();
  assert.equal(helpers.goalRecordTotal({ active: 120, passive: 60 }, "both"), 180);
  assert.equal(helpers.goalRecordTotal({ active: 120, passive: 60 }, "active"), 120);
  assert.equal(helpers.normalizeGoalCountingMode("invalid"), "both");
  assert.equal(helpers.normalizeGoalDisplayMode("passive"), "passive");
  assert.equal(helpers.normalizeGoalDisplayMode("invalid"), "both");

  assert(background.includes("version: TrackerData.SCHEMA_VERSION") &&
    background.includes("fullyManualEnabled: false") &&
    background.includes('goalCountingMode: "both"') &&
    background.includes('goalDisplayMode: "both"'),
    "new settings need safe migration defaults");
  assert(background.includes("normalizeGoalCountingMode(stored.preferences?.goalCountingMode)") &&
    background.includes("normalizeGoalDisplayMode(stored.preferences?.goalDisplayMode)") &&
    background.includes('"fullyManualEnabled" in message.preferences'),
    "new preferences must be normalized and writable");
  assert(background.includes("totalForPeriod(records, period, state.preferences.goalCountingMode)") &&
    background.includes("state.notificationState = {}") &&
    background.includes("goalCountingMode: result.preferences.goalCountingMode"),
    "goal notifications and Chrome Sync must follow the selected contribution mode");
  const dateStart = background.indexOf("function localDateKey");
  const dateEnd = background.indexOf("function parseLocalDateKey", dateStart);
  const totalStart = background.indexOf("function periodDateKeys");
  const totalEnd = background.indexOf("async function notifyGoalCompletions", totalStart);
  const totalForPeriod = new Function(
    "normalizeGoalCountingMode",
    background.slice(dateStart, dateEnd) + background.slice(totalStart, totalEnd) +
      "\nreturn totalForPeriod;"
  )(helpers.normalizeGoalCountingMode);
  const todayKey = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") +
    "-" + String(new Date().getDate()).padStart(2, "0");
  assert.equal(totalForPeriod({ [todayKey]: { active: 120, passive: 60 } }, "daily", "both"), 180);
  assert.equal(totalForPeriod({ [todayKey]: { active: 120, passive: 60 } }, "daily", "active"), 120);

  assert(popupHtml.includes('id="fullyManualEnabled"') &&
    popupHtml.includes('id="saveTrackingSettings"') &&
    popupHtml.includes('id="goalCountingMode"') &&
    popupHtml.includes('id="goalDisplayMode"'),
    "fully manual and goal preference controls are missing");
  assert(popup.includes('document.getElementById("saveTrackingSettings").addEventListener') &&
    popup.includes("preferences: { fullyManualEnabled: enabled }") &&
    popup.includes('document.getElementById("goalActiveRow").classList.toggle("hidden", displayMode === "passive")') &&
    popup.includes('document.getElementById("goalPassiveRow").classList.toggle("hidden", displayMode === "active")'),
    "settings are not wired to live behavior and Goal Progress rows");

  const resolveStart = content.indexOf("  async function resolveLanguage");
  const resolveEnd = content.indexOf("  async function monitorStreamingAudioLanguage", resolveStart);
  const resolveSource = content.slice(resolveStart, resolveEnd);
  assert(resolveSource.indexOf("overlayPreferences.fullyManualEnabled") < resolveSource.indexOf("detectTargetLanguage(info)") &&
    resolveSource.indexOf("overlayPreferences.fullyManualEnabled") < resolveSource.indexOf('type: "getDecision"'),
    "fully manual mode must bypass both automatic detection and remembered decisions");
  // Automatic mode is the one exception: it has no target language to hold
  // fixed, so a mid-title audio switch must still move time to the new language.
  assert(content.includes("(overlayPreferences.fullyManualEnabled && !isAutomaticLanguageMode()) ||\n      !isStreamingSite") &&
    content.includes('${overlayPreferences.fullyManualEnabled ? "" : `<button class="danger" data-action="wrong">'),
    "fully manual mode must ignore later audio changes and suppress contradictory correction UI");
  assert(popup.includes("if (!fullyManualEnabled)") && popup.includes("rejectButton.classList.add(\"hidden\")"),
    "the popup must also hide language correction in fully manual mode");

  const insightsStart = popup.indexOf("function renderInsights");
  const insightsEnd = popup.indexOf("function formatSourceScore", insightsStart);
  const insightsSource = popup.slice(insightsStart, insightsEnd);
  assert(insightsSource.includes("const active = Number(record.active)") &&
    insightsSource.includes("const passive = Number(record.passive)"),
    "Insights must continue displaying both active and passive history");
  assert(!insightsSource.includes("goalDisplayMode"),
    "the Tracker-only breakdown preference must not hide Insights data");
}

function testDashboardAccess() {
  assert(
    popup.includes('chrome.runtime.getURL("store-assets/dashboard.html")'),
    "popup dashboard link is missing"
  );
  assert(
    popupHtml.includes('id="openDashboardButton"') &&
      popupHtml.includes('aria-label="Open full dashboard"'),
    "dashboard button needs an accurate label"
  );
  assert(manifest.commands["open-dashboard"], "dashboard shortcut command is missing");
  assert(background.includes('command === "open-dashboard"') &&
    background.includes('chrome.runtime.getURL("store-assets/dashboard.html")'),
    "dashboard shortcut is not handled by the background worker");
  assert(popupHtml.includes('href="https://paypal.me/ImmersionTrack"') && popupHtml.includes('id="donateButton"'),
    "header Donate button is missing or does not link to the project's PayPal.Me page");
  assert(popupHtml.includes('aria-label="Donate"') || popupHtml.includes(">Donate<") || popupHtml.includes(">Donate&mdash;") || popupHtml.includes("Donate &mdash;"),
    "Donate control must be clearly labelled \"Donate\"");
  assert(popupHtml.includes('id="accountDonateButton"') && popupHtml.includes('id="accountInfoDialog"'),
    "Account & Plan panel is missing its Donate row");
  assert(dashboardHtml.includes('href="https://paypal.me/ImmersionTrack"') && dashboardHtml.includes('id="dashboardDonateButton"') && dashboardHtml.includes('aria-label="Donate"'),
    "dashboard is missing a clearly labelled Donate button");
  assert.equal(manifest.options_page, "store-assets/dashboard.html");
  for (const contract of ["getDashboard", "setPreferences", "setGoals", "setTargetLanguage", "exportData", "importData", "resetAllData"]) {
    assert(dashboard.includes(`type: "${contract}"`), `dashboard is not connected to ${contract}`);
  }
  assert(dashboard.includes("chrome.storage.onChanged.addListener") && dashboard.includes("setInterval(refreshDashboard"),
    "dashboard should update while it remains open");
  assert(dashboardHtml.includes('id="dashboardExportJson"') && dashboardHtml.includes('id="saveDashboardGoals"'),
    "dashboard live controls are missing");
  assert(dashboardHtml.includes('id="dashboardDeleteAccountButton"') && dashboardHtml.includes('id="dashboardDeleteAccountButton" class="danger"'),
    "account deletion must live in the dashboard, styled as a destructive action");
  assert(!popupHtml.includes('id="dashboardDeleteAccountButton"') && !popupHtml.includes("Delete account"),
    "account deletion should only be offered from the dashboard, not the popup");
  assert(dashboard.includes('type: "cloudDeleteAccount"') && dashboard.includes("confirm(") &&
    dashboard.match(/dashboardDeleteAccountButton[\s\S]{0,400}confirm\(/),
    "deleting an account must be confirmed before the cloudDeleteAccount message is sent");
  assert(background.includes('message.type === "cloudDeleteAccount"') &&
    background.includes("TrackerSupabaseRest.buildDeleteAccountRequest") &&
    background.includes("await clearAccountSession()"),
    "background.js must handle cloudDeleteAccount via the self-deletion RPC and clear the local session on success");
}

function testOnboardingPlansAndLanguageSafety() {
  assert(popupHtml.includes("Step 1 of 6") && popup.includes('" of 6"'),
    "onboarding should include the Free/Pro explanation and analytics-consent steps");
  assert(popupHtml.includes('id="onboardingAnalyticsConsent"') && popupHtml.includes("Share anonymous usage analytics") &&
    popup.includes('analyticsConsent: document.getElementById("onboardingAnalyticsConsent").checked'),
    "onboarding's last step must offer analytics consent and save it only when setup isn't skipped");
  assert(!popupHtml.includes('id="onboardingAnalyticsConsent" type="checkbox" checked'),
    "the onboarding analytics checkbox must default to unchecked - opt-in, not opt-out");
  assert(popupHtml.includes('id="onboardingChooseLater"') && popupHtml.includes("Set up later") &&
    popup.includes('{ code: "und", name: "Choose a language" }'),
    "new users need a safe choose-later path instead of silently defaulting tracking");
  assert(popupHtml.includes("Free supports one active target language at a time") &&
    popupHtml.includes("Switching your active language never deletes earlier language data"),
    "Free language limits must explain that earlier data is retained");
  assert(popup.includes("confirmTargetLanguageSwitch") && popup.includes("history will stay saved") &&
    dashboard.includes("history will stay saved"),
    "language changes must warn clearly without threatening data deletion");
  assert(background.includes('ignored: "target-language-not-selected"') &&
    content.includes("Choose a target language in the extension before tracking"),
    "choosing later must keep automatic tracking inactive until configured");
  assert(popupHtml.includes('id="openAccountInfo"') && popupHtml.includes('id="accountInfoDialog"') &&
    popupHtml.includes("Signing in is optional and never required") &&
    dashboardHtml.includes('id="dashboardProfile"') && dashboardHtml.includes("Local beta profile"),
    "the local account/plan status should be discoverable in both extension surfaces");
  assert(popupHtml.includes("Pro Analytics is unlocked for everyone during beta") &&
    popupHtml.includes("Multi-language planned") && popupHtml.includes("Planned later"),
    "the comparison must distinguish current beta features from future Pro plans");
}

function testThemeControls() {
  assert(background.includes('theme: "dark"'), "dark mode is not the default theme");
  assert(background.includes('stored.preferences?.theme === "light" ? "light" : "dark"'),
    "stored themes are not normalized safely");
  assert(background.includes('"theme" in message.preferences'), "theme changes are not persisted");
  assert(popupHtml.includes('id="lightThemeButton"') && popupHtml.includes('id="darkThemeButton"'),
    "light and dark theme controls are missing");
  assert(popupHtml.includes('id="quickThemeToggle"') && popupHtml.includes('aria-label="Switch to light mode"'),
    "the fixed header theme toggle is missing or inaccessible");
  assert(popupHtml.includes("&#9728;") && popupHtml.includes("&#9790;"), "theme controls need sun and moon icons");
  assert(popup.includes("function applyTheme(value)") && popup.includes("document.documentElement.dataset.theme = theme"),
    "the popup does not apply the saved theme");
  assert(popup.includes("let themeOverride = null") &&
    popup.includes("applyTheme(themeOverride || state.preferences?.theme)"),
    "an in-flight dashboard refresh can overwrite a newly selected theme");
  assert(popup.includes('document.getElementById("quickThemeToggle").addEventListener'),
    "the quick theme toggle is not wired");
  assert(popupCss.includes(':root[data-theme="light"]'), "light-mode colors are missing");
  assert(content.includes(':host([data-theme="light"]) .card') &&
    content.includes("overlay.host.dataset.theme = overlayPreferences.theme"),
    "the on-video status UI does not follow the selected theme");
}

function testReconnectPositionAndActivityFixes() {
  assert(!popupHtml.includes('id="livePill"') && !popup.includes('getElementById("livePill")'),
    "the redundant header status pill was not fully removed");
  assert(popup.includes("function isSupportedPlaybackUrl(value)") &&
    popup.includes('showButton.textContent = needsReconnect ? "Reconnect tracker" : "Show status"') &&
    popup.includes("await chrome.tabs.reload(activeTab.id)"),
    "supported playback tabs cannot reconnect after an extension update");
  assert(content.includes('pageVisible: document.visibilityState === "visible"') &&
    content.includes("pageFocused: document.hasFocus()") &&
    background.includes("windowInfo.focused || (pageVisible && pageFocused)"),
    "active immersion does not use both Chrome and page focus evidence");
  assert(content.includes("preferences?.overlayPosition?.custom === true") &&
    content.includes("function resetOverlayPosition()") &&
    background.includes("custom: true") &&
    content.includes('overlay.host.style.right = "18px"'),
    "the video status position is not remembered with a top-right default");
}

async function testActiveContextClassification() {
  const start = background.indexOf("async function isTabActivelyViewed");
  const end = background.indexOf("function computeStatusState", start);
  assert(start >= 0 && end > start, "active-context helper is missing");
  const create = (tab, windowInfo, fail = false) => new Function(
    "chrome",
    background.slice(start, end) + "\nreturn isTabActivelyViewed;"
  )({
    tabs: { async get() { if (fail) throw new Error("unavailable"); return tab; } },
    windows: { async get() { if (fail) throw new Error("unavailable"); return windowInfo; } }
  });

  assert.equal(await create({ active: true, windowId: 1 }, { focused: true })(4, {
    pageVisible: true, pageFocused: false
  }), true, "a focused active Chrome tab should be active immersion");
  assert.equal(await create({ active: true, windowId: 1 }, { focused: true })(4, {
    pageVisible: false, pageFocused: false
  }), true, "fullscreen playback should remain active when Chrome reports the tab and window as active");
  assert.equal(await create({ active: true, windowId: 1 }, { focused: false })(4, {
    pageVisible: true, pageFocused: true
  }), true, "page focus should recover an incorrect window-focus result");
  assert.equal(await create({ active: true, windowId: 1 }, { focused: false })(4, {
    pageVisible: true, pageFocused: false
  }), false, "an unfocused page should be passive immersion");
  assert.equal(await create({ active: false, windowId: 1 }, { focused: true })(4, {
    pageVisible: true, pageFocused: true
  }), false, "a background tab should be passive immersion");
  assert.equal(await create({}, {}, true)(4, { pageVisible: true, pageFocused: true }), true,
    "page focus should remain a safe fallback if Chrome context lookup briefly fails");
}

function streamingFactory() {
  const configStart = content.indexOf("  const STREAMING_SITE_CONFIGS");
  const configEnd = content.indexOf("  let targetLanguage", configStart);
  const helperStart = content.indexOf("  function compactText");
  const helperEnd = content.indexOf("  function getStreamingInfo", helperStart);
  const infoEnd = content.indexOf("  function getContentInfo", helperEnd);
  assert(configStart >= 0 && configEnd > configStart && helperStart >= 0 && infoEnd > helperEnd);
  return new Function(
    "location", "document", "window", "isVideoPlaying",
    content.slice(configStart, configEnd) +
      "let ogJsonLdDirty = true; let ogJsonLdSnapshot = { candidates: [] };" +
      "let ogJsonLdDebounceTimer = null;" +
      content.slice(helperStart, helperEnd) +
      content.slice(helperEnd, infoEnd) +
      "\nreturn { site, streamingSite, getStreamingInfo, structuredSeriesTitle };"
  );
}

function makeLocation(hostname, pathname) {
  return {
    hostname,
    pathname,
    origin: `https://${hostname}`,
    href: `https://${hostname}${pathname}`
  };
}

function fakeDocument(pageTitle, titleText, videos = [], metadata = {}) {
  const titleElement = {
    innerText: titleText,
    textContent: titleText,
    getAttribute() { return ""; }
  };
  const seriesElement = {
    innerText: metadata.seriesText || "",
    textContent: metadata.seriesText || "",
    getAttribute() { return ""; }
  };
  return {
    title: pageTitle,
    querySelector(selector) {
      if (metadata.seriesText && /series-title|show-title|video-title"\] h4|PlayerMetadata__series|\/series\//i.test(selector)) {
        return seriesElement;
      }
      return titleElement;
    },
    querySelectorAll(selector) {
      if (selector === "video") return videos;
      if (selector === 'script[type="application/ld+json"]') {
        return (metadata.jsonLd || []).map((value) => ({ textContent: JSON.stringify(value) }));
      }
      if (metadata.seriesText && /series-title|show-title|video-title"\] h4|PlayerMetadata__series|\/series\//i.test(selector)) {
        return [seriesElement];
      }
      return [titleElement];
    }
  };
}

function testEveryStreamingSiteIdentity() {
  const create = streamingFactory();
  const cases = [
    ["netflix", "www.netflix.com", "/watch/81234567", "Netflix"],
    ["disneyplus", "www.disneyplus.com", "/en-gb/play/abc", "Disney+"],
    ["primevideo", "www.primevideo.com", "/detail/0ABC", "Prime Video"],
    ["hulu", "www.hulu.com", "/watch/abc", "Hulu"],
    ["max", "play.max.com", "/video/watch/abc", "Max"],
    ["appletv", "tv.apple.com", "/us/episode/name/abc", "Apple TV+"],
    ["paramountplus", "www.paramountplus.com", "/shows/video/abc", "Paramount+"],
    ["peacock", "www.peacocktv.com", "/watch/playback/abc", "Peacock"],
    ["crunchyroll", "www.crunchyroll.com", "/watch/ABC123/name", "Crunchyroll"],
    ["hidive", "www.hidive.com", "/stream/show/s01e01", "HIDIVE"],
    ["tubi", "tubitv.com", "/tv-shows/123/s01-e01", "Tubi"]
  ];

  for (const [expectedSite, hostname, pathname, brand] of cases) {
    const title = "Test playback";
    const api = create(
      makeLocation(hostname, pathname),
      fakeDocument(`${title} - ${brand}`, title),
      { innerWidth: 1280, innerHeight: 720 },
      () => false
    );
    const info = api.getStreamingInfo();
    assert(info, `${brand} route was not recognized`);
    assert.equal(api.site, expectedSite);
    assert.equal(info.decisionScope, "content", `${brand} should remember an exact video first`);
    assert.equal(info.contentKey, `${expectedSite}:content:${pathname}`);
    assert.equal(info.sourceKey, "", `${brand} must not invent a family from a generic title`);
    assert.equal(info.familyEvidence, "");
    assert(popup.includes(`${expectedSite}: "${brand}"`), `popup source label missing for ${brand}`);
  }

  const fallbackVideo = {
    paused: false, ended: false, readyState: 4, muted: false, volume: 1,
    getBoundingClientRect() { return { width: 1000, height: 600 }; }
  };
  const fallback = create(
    makeLocation("www.disneyplus.com", "/new-player-route/abc"),
    fakeDocument("Fallback Movie - Disney+", "Fallback Movie", [fallbackVideo]),
    { innerWidth: 1280, innerHeight: 720 },
    () => true
  ).getStreamingInfo();
  assert(fallback, "large audible playback fallback was not recognized");
  assert.equal(fallback.decisionScope, "content");
  assert.equal(fallback.sourceKey, "", "ambiguous playback must remain exact instead of being broadly grouped");

  const firstEpisode = create(
    makeLocation("www.netflix.com", "/watch/episode-1"),
    fakeDocument("Pilot - Netflix", "Pilot"),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  const secondEpisode = create(
    makeLocation("www.netflix.com", "/watch/episode-2"),
    fakeDocument("Next - Netflix", "Next"),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  assert.notEqual(firstEpisode.contentKey, secondEpisode.contentKey,
    "different playback paths need different exact decision keys");

  const genericRoute = makeLocation("www.hulu.com", "/watch/shared-player");
  const firstQueryIdentity = create(
    { ...genericRoute, href: genericRoute.href + "?contentId=episode-a&tracking=ignored" },
    fakeDocument("Episode - Hulu", "Episode"),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  const secondQueryIdentity = create(
    { ...genericRoute, href: genericRoute.href + "?contentId=episode-b&tracking=changed" },
    fakeDocument("Episode - Hulu", "Episode"),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  assert.notEqual(firstQueryIdentity.contentKey, secondQueryIdentity.contentKey,
    "known content-ID query parameters should distinguish playback without retaining tracking parameters");
  assert(!firstQueryIdentity.contentKey.includes("tracking="));
}

function testAnonymousExactAndFamilyDecisions() {
  const create = streamingFactory();
  const netflixLocation = makeLocation("www.netflix.com", "/watch/123");

  const matchedJsonLd = create(
    netflixLocation,
    fakeDocument("Pilot - Netflix", "Pilot", [], { jsonLd: [{
      "@context": "https://schema.org",
      "@type": "TVEpisode",
      name: "Pilot",
      partOfSeries: { "@type": "TVSeries", name: "One Season Wonder" }
    }, { "@type": "Movie", name: "Unrelated carousel movie" }] }),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  assert.equal(matchedJsonLd.decisionScope, "content");
  assert.equal(matchedJsonLd.sourceKey, "netflix:family:one-season-wonder");
  assert.equal(matchedJsonLd.familyEvidence, "structured");

  const selectorFamily = create(
    makeLocation("www.netflix.com", "/watch/456"),
    fakeDocument("Goodbye - Netflix", "Goodbye", [], { seriesText: "Viral Hit" }),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  assert.equal(selectorFamily.sourceKey, "netflix:family:viral-hit");
  assert.equal(selectorFamily.familyEvidence, "selector");

  const unrelatedJsonLd = create(
    netflixLocation,
    fakeDocument("Actual Show - Netflix", "Actual Show", [], {
      jsonLd: [{
        "@type": "TVEpisode",
        name: "Unrelated carousel episode",
        partOfSeries: { "@type": "TVSeries", name: "Wrong Show" }
      }]
    }),
    { innerWidth: 1280, innerHeight: 720 },
    () => false
  ).getStreamingInfo();
  assert.equal(unrelatedJsonLd.sourceKey, "",
    "unrelated structured metadata must not group the current playback");

  const keyStart = background.indexOf("function opaqueStorageKey");
  const keyEnd = background.indexOf("function normalizeDecision", keyStart);
  const keyHelpers = new Function(
    "normalizeLanguageCode",
    background.slice(keyStart, keyEnd) +
      "\nreturn { opaqueStorageKey, decisionStorageKey };"
  )((value) => value || "ja");
  const readableKey = "netflix:family:one-season-wonder";
  const opaqueKey = keyHelpers.decisionStorageKey("ja", readableKey);
  assert(opaqueKey.startsWith("ja|h:") && !opaqueKey.includes("one-season-wonder"),
    "remembered exact and family decisions must not retain readable viewing titles");

  assert(!content.includes("TV Show or Movie") && !content.includes("NUMBERED_CONTENT_TERMS") &&
    !background.includes('message.type === "getContentType"') && !background.includes("contentTypes:"),
    "the obsolete movie/TV classifier, prompt, and storage must be removed");
  assert(background.includes("normalizeStoredSourceLearning(stored.sourceLearning)") &&
    background.includes("Object.keys(learning.confirmedContents).length >= 2"),
    "related-content suggestions should persist anonymously and require two exact confirmations");
  const decisionStart = background.indexOf('if (message.type === "getDecision")');
  const decisionEnd = background.indexOf('if (message.type === "saveDecision")', decisionStart);
  const decisionSource = background.slice(decisionStart, decisionEnd);
  assert(decisionSource.indexOf("state.decisions.content") < decisionSource.indexOf("state.decisions.source"),
    "an exact exception must take priority over a learned family decision");
  assert(decisionSource.indexOf('readSyncedDecision("content"') <
    decisionSource.indexOf("state.decisions.source"),
    "a synced exact correction must also beat a locally cached family decision");
  assert(content.includes('data-action="always-now"') && content.includes("Remember related videos"),
    "learning a related-content family must remain an explicit user action");
  assert(content.includes("let unconfirmedActive = 0") &&
    content.includes("function commitUnconfirmedBuffer()") &&
    content.includes("function discardUnconfirmedBuffer()") &&
    content.includes("discardUnconfirmedBuffer();\n      currentInfo = info"),
    "uncertain playback needs a memory-only buffer that is discarded on navigation");

  const bufferStart = content.indexOf("  function discardUnconfirmedBuffer");
  const bufferEnd = content.indexOf("  function playbackStateAllowsSampling", bufferStart);
  const buffer = new Function(
    "let unconfirmedActive = 2; let unconfirmedPassive = 3;" +
      "let pendingActive = 1; let pendingPassive = 1; let sessionActive = 4; let sessionPassive = 5;" +
      content.slice(bufferStart, bufferEnd) +
      "\nreturn { commitUnconfirmedBuffer, discardUnconfirmedBuffer, values: () => ({ " +
      "unconfirmedActive, unconfirmedPassive, pendingActive, pendingPassive, sessionActive, sessionPassive }) };"
  )();
  buffer.commitUnconfirmedBuffer();
  assert.deepEqual(buffer.values(), {
    unconfirmedActive: 0, unconfirmedPassive: 0,
    pendingActive: 3, pendingPassive: 4, sessionActive: 6, sessionPassive: 8
  }, "confirming target language should transfer buffered time exactly once");
}
function audioFactory(elements) {
  const start = content.indexOf("  const LANGUAGE_ALIASES");
  const end = content.indexOf("  function isAutomaticCaptionTrack", start);
  return new Function(
    "document",
    "let targetLanguage = { code: 'ja', name: 'Japanese' }; let currentVideo = null;" +
      "function compactText(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }" +
      content.slice(start, end) +
      "\nreturn { selectedAudioLabels, findSelectedTargetAudioLabel, findSelectedOtherAudioLabel };"
  )({ querySelectorAll() { return elements; } });
}

function selectedElement(text, dataUia) {
  return {
    innerText: text,
    textContent: text,
    className: "",
    getAttribute(name) { return name === "data-uia" ? dataUia : ""; },
    closest() { return null; }
  };
}

function testAudioOnlySelection() {
  let audio = audioFactory([selectedElement("Japanese", "subtitle-item-selected")]);
  assert.deepEqual(audio.selectedAudioLabels(), []);
  assert.equal(audio.findSelectedTargetAudioLabel(), "");

  audio = audioFactory([selectedElement("Japanese", "audio-item-selected")]);
  assert.equal(audio.findSelectedTargetAudioLabel(), "Japanese");

  audio = audioFactory([selectedElement("English (Original)", "audio-item-selected")]);
  assert.equal(audio.findSelectedOtherAudioLabel(), "English (Original)");

  const netflixAudioItem = selectedElement("Japanese [Original]", "audio-item-japanese");
  const checkedRadio = selectedElement("", "");
  checkedRadio.closest = (selector) => selector.includes("audio-item") ? netflixAudioItem : null;
  audio = audioFactory([checkedRadio]);
  assert.equal(audio.findSelectedTargetAudioLabel(), "Japanese [Original]");
}

function testStreamingDetectionPriority() {
  const detectStart = content.indexOf("  function detectTargetLanguage");
  const detectEnd = content.indexOf("  function applyDetectionResult", detectStart);
  const detect = new Function(
    "targetAudio", "otherEvidence",
    "let targetLanguage = { code: 'ja', name: 'Japanese' };" +
      "let site = 'netflix'; let isStreamingSite = true; let streamingSite = { name: 'Netflix' };" +
      "function findSelectedTargetAudioLabel() { return targetAudio; }" +
      "function findPrimaryOtherLanguageEvidence() { return otherEvidence; }" +
      content.slice(detectStart, detectEnd) +
      "\nreturn detectTargetLanguage({ scopeLabel: 'season 1' });"
  );

  assert.equal(detect("Japanese", "another language").confidence, "high");
  assert.equal(detect("", "Selected audio is English.").confidence, "not-target");
  assert.equal(detect("", "").confidence, "uncertain");
  assert(detect("", "").reason.includes("Audio & Subtitles menu"));

  const resolveStart = content.indexOf("  async function resolveLanguage");
  const resolveEnd = content.indexOf("  async function monitorStreamingAudioLanguage", resolveStart);
  const resolveSource = content.slice(resolveStart, resolveEnd);
  assert(
    resolveSource.indexOf("detectTargetLanguage(info)") < resolveSource.indexOf('type: "getDecision"'),
    "remembered decisions are checked before current audio evidence"
  );
  assert(content.includes("await monitorStreamingAudioLanguage();"));
}

function testGoalScaledWeeklyChartAndOnboarding() {
  assert(popup.includes("total / dailyGoalSeconds * maxBarHeight"), "weekly chart is not scaled to the daily goal");
  assert(popup.includes('title="Active: '), "active weekly duration tooltip is missing");
  assert(popup.includes('title="Passive: '), "passive weekly duration tooltip is missing");
  assert(popupHtml.includes('id="onboardingDialog"'), "first-install setup dialog is missing");
  assert(popupHtml.includes('id="replayTutorialButton"'), "tutorial replay control is missing");
  assert(background.includes("onboardingCompleted: false"), "new installs do not default to onboarding");
  assert(content.includes("!isVideoPlaying(currentVideo) && !overlayManuallyShown"),
    "manual Show status still hides a paused unconfirmed video");
}

function testTourSettingsAndCompactOverlay() {
  assert(content.includes(".passive { background: #f59e0b;"),
    "passive video tracking color is not dashboard orange");
  const compactStart = content.indexOf("    if (overlayCompact) {");
  const compactEnd = content.indexOf("    if (languageState ===", compactStart);
  const compactSource = content.slice(compactStart, compactEnd);
  assert(compactSource.includes('data-action="expand-full"'), "minimized session does not open full status");
  for (const removed of ["data-fab-toggle", "fab-actions", "capture-button", 'data-action="manual"', 'data-action="hide-fab"']) {
    assert(!compactSource.includes(removed), `minimized session still contains ${removed}`);
  }

  assert(popupCss.includes("outline:3px solid #f59e0b"), "tutorial highlight is not orange");
  assert(popupCss.includes(".app-header{position:fixed") &&
    popupCss.includes(".tutorial-active main{padding-top:calc(var(--tutorial-offset) + 128px)}"),
    "tutorial does not reserve space below the fixed shell");
  assert(popupCss.includes(".tutorial-coachmark{position:fixed;top:0;left:0;right:0") &&
    popupCss.includes("width:100%;max-width:none"), "tutorial does not span the full popup width");
  assert(popup.includes("Green means active immersion, orange means passive immersion, and grey means inactive or paused"),
    "tutorial does not explain minimized-session colors");
  assert(popup.includes("Always count channel") && popup.includes("Future videos from it will count automatically"),
    "tutorial does not explain YouTube channel greenlighting");
  assert(popup.includes("every Sunday at 20:00") && popup.includes("Goal-complete notifications"),
    "tutorial does not explain weekly review notifications");
  assert(background.includes('status === "recording-passive"') && background.includes('color = "#f59e0b"'),
    "passive extension badge is not orange");

  const confirmedOverlayStart = content.indexOf('} else if (languageState === "confirmed")');
  const confirmedOverlayEnd = content.indexOf('} else if (["rejected"', confirmedOverlayStart);
  const confirmedOverlay = content.slice(confirmedOverlayStart, confirmedOverlayEnd);
  assert(confirmedOverlay.includes('data-action="reconnect"') &&
    confirmedOverlay.indexOf('data-action="reconnect"') < confirmedOverlay.indexOf('data-action="wrong"'),
    "confirmed sessions need a Reconnect button beside the remove-time action");
  const reconnectStart = content.indexOf("  async function reconnectTracker");
  const reconnectEnd = content.indexOf("  function togglePause", reconnectStart);
  const reconnectSource = content.slice(reconnectStart, reconnectEnd);
  assert(reconnectSource.indexOf("flushTicks()") < reconnectSource.indexOf("location.reload()"),
    "Reconnect must save pending time before reloading the playback page");

  const generalStart = popupHtml.indexOf('id="generalSettingsDialog"');
  const generalEnd = popupHtml.indexOf("</dialog>", generalStart);
  const general = popupHtml.slice(generalStart, generalEnd);
  assert(general.indexOf("<h3>Video overlay</h3>") < general.indexOf('id="openGoalSettingsFromGeneral"'));
  assert(general.indexOf('id="replayTutorialButton"') < general.indexOf("<h3>Sync and data</h3>"));
  assert(!general.includes("<h3>Goals</h3>") && !general.includes("<h3>Help</h3>"));
  assert(!popupHtml.includes('id="openGoalSettings"') && !popupHtml.includes("goal-settings-entry"),
    "Manual still contains the duplicate goal settings entry");
  assert(popupCss.includes("grid-template-columns:132px 140px") && popupCss.includes("margin-top:12px"),
    "optional goal controls are not compactly spaced");
  assert(popupCss.includes("grid-template-columns:repeat(3,minmax(0,1fr))"),
    "sync/data actions are not equal width");
  assert(popupCss.includes("html{margin:0;width:500px;min-width:500px") &&
    popupCss.includes("body{margin:0;width:100%;min-width:0") &&
    !popupCss.includes("width:min(500px,100vw)"),
    "popup root can collapse during Chrome's intrinsic popup sizing");
}

function testCsvRoundTripHelpers() {
  const csvCellStart = popup.indexOf("function csvCell");
  const csvCellEnd = popup.indexOf('document.getElementById("exportJsonButton")', csvCellStart);
  const parseStart = popup.indexOf("function parseCsv");
  const parseEnd = popup.indexOf('document.getElementById("importFileInput")', parseStart);
  const helpers = new Function(
    popup.slice(csvCellStart, csvCellEnd) + popup.slice(parseStart, parseEnd) +
      "\nreturn { csvCell, parseCsv };"
  )();
  const row = ["2026-07-16", "ja", "Japanese", "watching", "Title, with comma"];
  const csv = row.map(helpers.csvCell).join(",") + "\n";
  const parsed = helpers.parseCsv("date,languageCode,languageName,source,title\n" + csv);
  assert.equal(parsed[0].title, "Title, with comma");
  assert.equal(helpers.csvCell("=WEBSERVICE(\"https://example.invalid\")"), "\"'=WEBSERVICE(\"\"https://example.invalid\"\")\"",
    "CSV exports must neutralize spreadsheet formulas");
}

testManifestAndMessageContracts();
testPopupElementContracts();
testBackdatedQuickAdd();
testPermanentDailyBreakdownsAndStorageUsage();
testManualMidnightSegments();
testSourceScoreUnits();
testSyncFailureNamesTheLimit();
testMismatchEvidenceNamesTheLanguage();
testAutomaticModeBooksTheDetectedLanguage();
testManualTimerProgressAndIndicator();
testOptionalGoalPeriodButtons();
testFullyManualAndGoalPreferences();
testDashboardAccess();
testOnboardingPlansAndLanguageSafety();
testThemeControls();
testReconnectPositionAndActivityFixes();
testEveryStreamingSiteIdentity();
testAnonymousExactAndFamilyDecisions();
testAudioOnlySelection();
testStreamingDetectionPriority();
testGoalScaledWeeklyChartAndOnboarding();
testTourSettingsAndCompactOverlay();
testCsvRoundTripHelpers();

Promise.all([testActiveContextClassification(), testStorageWriteFailureRecovery()]).then(() => {
  console.log("All extension regression checks passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
