let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let latestDashboard = null;
let latestActiveTab = null;
let settingsInitialized = false;
let goalsInitialized = false;
let languageInitialized = false;
let manualFieldsInitialized = false;
let selectedGoalPeriod = "daily";
let ringSegments = [];
let latestGoalPeriods = {};
let categoryOptionsSignature = "";
let customCategoryTargetId = "manualSource";
let onboardingHandled = false;
let onboardingStep = 0;
let tutorialStep = 0;
let tutorialTarget = null;
let themeOverride = null;
let themeChangeSequence = 0;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MANUAL_CATEGORIES = ["reading", "listening", "writing", "speaking", "watching", "vocab", "grammar"];
const THEME_ICONS = {
  light: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>',
  dark: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.2A8.4 8.4 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"></path></svg>'
};

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function normalizeGoalCountingMode(value) {
  return value === "active" ? "active" : "both";
}

function normalizeGoalDisplayMode(value) {
  return value === "active" || value === "passive" ? value : "both";
}

function goalRecordTotal(record, countingMode = "both") {
  return (Number(record?.active) || 0) +
    (normalizeGoalCountingMode(countingMode) === "active" ? 0 : (Number(record?.passive) || 0));
}

function applyTheme(value) {
  const theme = normalizeTheme(value);
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll("[data-theme-value]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeValue === theme));
  });
  const quickToggle = document.getElementById("quickThemeToggle");
  if (quickToggle) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    quickToggle.dataset.nextTheme = nextTheme;
    quickToggle.innerHTML = THEME_ICONS[nextTheme];
    quickToggle.title = "Switch to " + nextTheme + " mode";
    quickToggle.setAttribute("aria-label", quickToggle.title);
  }
  return theme;
}

function selectedTargetLanguage() {
  return latestDashboard?.state?.preferences?.targetLanguage || { code: "ja", name: "Japanese" };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response || null);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response || null);
    });
  });
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function weekDateKeys() {
  const now = new Date();
  const daysSinceMonday = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - daysSinceMonday);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return localDateKey(date);
  });
}

function formatDuration(seconds) {
  const roundedMinutes = Math.round((Number(seconds) || 0) / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return hours ? hours + "h " + minutes + " min" : minutes + " min";
}

function formatGoalMinutes(minutes) {
  const rounded = Math.max(0, Math.round(Number(minutes) || 0));
  if (rounded <= 300) return rounded.toLocaleString() + " min";
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? hours + "h " + remainder + "m" : hours + "h";
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
    : minutes + ":" + String(secs).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function capitalize(value) {
  return String(value || "").replace(/^./, (char) => char.toUpperCase());
}

const SOURCE_LABELS = {
  youtube: "YouTube",
  netflix: "Netflix",
  disneyplus: "Disney+",
  primevideo: "Prime Video",
  hulu: "Hulu",
  max: "Max",
  appletv: "Apple TV+",
  paramountplus: "Paramount+",
  peacock: "Peacock",
  crunchyroll: "Crunchyroll",
  hidive: "HIDIVE",
  tubi: "Tubi"
};

function sourceLabel(value) {
  return SOURCE_LABELS[String(value || "").toLowerCase()] || capitalize(value || "other");
}

function isSupportedPlaybackUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    if (host === "youtube.com" || host === "www.youtube.com") {
      return (path === "/watch" && Boolean(url.searchParams.get("v"))) ||
        /^\/(?:shorts|live|embed)\/[^/]+/.test(path);
    }
    if (/^(?:www\.)?netflix\.com$/.test(host)) return /^\/watch\//.test(path);
    if (/^(?:www\.)?disneyplus\.com$/.test(host)) return /\/(?:play|video)\//i.test(path);
    if (/^(?:www\.)?primevideo\.com$/.test(host) || /^(?:www\.)?amazon\.(?:com|co\.uk|ca|de|co\.jp|fr|it|es)$/.test(host)) {
      return /\/(?:detail|gp\/video\/detail)\//i.test(path);
    }
    if (/^(?:www\.)?hulu\.com$/.test(host)) return /^\/watch\//i.test(path);
    if (host === "play.max.com") return /\/(?:video\/watch|watch)\//i.test(path);
    if (host === "tv.apple.com") return /\/(?:episode|movie)\//i.test(path);
    if (/^(?:www\.)?paramountplus\.com$/.test(host)) return /\/(?:shows|movies)\/video\/|\/live-tv\//i.test(path);
    if (/^(?:www\.)?peacocktv\.com$/.test(host)) return /\/watch\//i.test(path);
    if (/^(?:www\.)?crunchyroll\.com$/.test(host)) return /\/watch\//i.test(path);
    if (/^(?:www\.)?hidive\.com$/.test(host)) return /\/(?:video|stream)\//i.test(path);
    if (/^(?:www\.)?tubitv\.com$/.test(host)) return /\/(?:movies|tv-shows)\//i.test(path);
  } catch {
    return false;
  }
  return false;
}

function normalizeCategory(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function renderCategoryOptions(preferences = {}) {
  const extras = Array.isArray(preferences.customManualCategories)
    ? preferences.customManualCategories.map(normalizeCategory).filter(Boolean)
    : [];
  const legacy = normalizeCategory(preferences.lastManualSource);
  const categories = [...DEFAULT_MANUAL_CATEGORIES, ...extras];
  if (legacy && legacy !== "other" && !categories.some((item) => item.toLowerCase() === legacy.toLowerCase())) categories.push(legacy);
  const unique = categories.filter((item, index, items) =>
    items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index
  );
  const signature = JSON.stringify(unique);
  if (signature === categoryOptionsSignature) return;
  categoryOptionsSignature = signature;
  ["manualSource", "customSource"].forEach((id) => {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML = unique.map((category) =>
      `<option value="${escapeHtml(category)}">${escapeHtml(capitalize(category))}</option>`
    ).join("") + `<option value="__custom__">+ Add custom category</option>`;
    const preferred = id === "manualSource" ? legacy : current;
    select.value = unique.includes(current) ? current : unique.includes(preferred) ? preferred : "reading";
  });
}
function manualElapsed(timer) {
  if (!timer) return 0;
  const committed = Number(timer.committedSeconds) || 0;
  if (!timer.running) return committed;
  return committed + Math.max(0, (Date.now() - (Number(timer.lastCheckpointAt) || Date.now())) / 1000);
}

function manualUncommitted(timer) {
  if (!timer?.running) return 0;
  return Math.max(0, (Date.now() - (Number(timer.lastCheckpointAt) || Date.now())) / 1000);
}

function renderCurrent(current, activeTab) {
  const target = selectedTargetLanguage();
  const fullyManualEnabled = latestDashboard?.state?.preferences?.fullyManualEnabled === true;
  const confirmButton = document.getElementById("confirmButton");
  const rejectButton = document.getElementById("rejectButton");
  const showButton = document.getElementById("showOverlayButton");
  const needsReconnect = !current && isSupportedPlaybackUrl(activeTab?.url);
  document.getElementById("automaticSessionCard").classList.toggle("is-empty", !current && !needsReconnect);

  document.getElementById("sessionActive").textContent = formatDuration(current?.sessionActive || 0);
  document.getElementById("sessionPassive").textContent = formatDuration(current?.sessionPassive || 0);
  document.getElementById("currentTitle").textContent = current?.title ||
    (needsReconnect ? "Tracker needs to reconnect" : "Start with something you want to hear");
  document.getElementById("automaticEvidence").textContent = current
    ? (current.detectionReason || current.site || "Supported video detected")
    : needsReconnect
      ? "Reload this playback tab once after installing or updating the extension."
      : "Play a supported video and your active or passive time will appear here.";
  document.getElementById("currentLanguageHint").textContent = target.name;
  confirmButton.textContent = "Count as " + target.name;
  rejectButton.textContent = "Not " + target.name;

  confirmButton.classList.add("hidden");
  rejectButton.classList.add("hidden");

  if (!fullyManualEnabled) {
    if (current?.state === "recording-active") {
      rejectButton.classList.remove("hidden");
    } else if (current?.state === "recording-passive") {
      rejectButton.classList.remove("hidden");
    } else if (current?.state === "awaiting") {
      confirmButton.classList.remove("hidden");
      rejectButton.classList.remove("hidden");
    } else if (current?.contentKey && ["not-candidate", "primary-other", "rejected"].includes(current?.languageState)) {
      confirmButton.classList.remove("hidden");
    } else if (current?.languageState === "confirmed") {
      rejectButton.classList.remove("hidden");
    }
  }

  showButton.textContent = needsReconnect ? "Reconnect tracker" : "Show status";
  showButton.disabled = !activeTab || (!needsReconnect && !current?.contentKey);
  showButton.onclick = async () => {
    if (!activeTab) return;
    if (needsReconnect) {
      document.getElementById("automaticEvidence").textContent = "Reloading the playback tab and reconnecting...";
      try {
        await chrome.tabs.reload(activeTab.id);
      } catch {
        document.getElementById("automaticEvidence").textContent = "Could not reload this tab. Reload it manually once.";
      }
      return;
    }
    const response = await sendTabMessage(activeTab.id, { type: "showTrackerOverlay" });
    if (!response?.ok) {
      document.getElementById("automaticEvidence").textContent =
        response?.reason === "no-video" ? "Start a supported video, then try Show status again." :
          "The video status could not be opened. Reload the playback tab once and try again.";
    }
  };
  confirmButton.onclick = async () => {
    if (!activeTab) return;
    await sendTabMessage(activeTab.id, { type: "confirmCurrentLanguage" });
    render();
  };
  rejectButton.onclick = async () => {
    if (!activeTab) return;
    await sendTabMessage(activeTab.id, { type: "rejectCurrentLanguage" });
    render();
  };
}

function renderManualTimer(timer, preferences, current) {
  const running = Boolean(timer?.running);
  const mode = timer?.mode === "passive" ? "passive" : "active";
  const source = timer?.source || preferences?.lastManualSource || "reading";
  const action = String(timer?.action || "").trim();
  const target = preferences?.targetLanguage || { code: "ja", name: "Japanese" };
  const timerLanguage = timer?.languageCode || target.code;
  const timerLanguageName = timerLanguage === target.code ? target.name : timerLanguage.toUpperCase();
  const languageDeferred = preferences?.targetLanguageDeferred === true || target.code === "und";
  const sourceInput = document.getElementById("manualSource");
  const actionInput = document.getElementById("manualAction");
  const modeInput = document.getElementById("manualMode");
  const startButton = document.getElementById("startManualButton");
  const pauseButton = document.getElementById("pauseManualButton");
  const timerPill = document.getElementById("manualTimerPill");

  if (!manualFieldsInitialized || running) {
    sourceInput.value = [...sourceInput.options].some((option) => option.value === source) ? source : "reading";
    actionInput.value = running ? action : "";
    modeInput.value = mode;
    manualFieldsInitialized = true;
  }

  sourceInput.disabled = running;
  actionInput.disabled = running;
  modeInput.disabled = running;
  startButton.classList.toggle("hidden", running);
  startButton.disabled = languageDeferred;
  pauseButton.classList.toggle("hidden", !running);
  timerPill.className = "pill " + (running ? mode : "stopped");
  timerPill.textContent = running ? capitalize(mode) : "Stopped";
  document.getElementById("manualTimerLabel").textContent = languageDeferred && !running
    ? "Choose a target language before recording"
    : running
    ? (action ? action + " - " : "") + capitalize(source) + " - " + capitalize(mode) + " - " + timerLanguageName
    : timer
      ? "Last session: " + (action || capitalize(source)) + " (" + timerLanguageName + ")"
      : "Ready to record";
  document.getElementById("manualElapsed").textContent = formatClock(manualElapsed(timer));

}
function sumRecords(records, predicate) {
  return Object.entries(records).reduce((sum, [dateKey, record]) => {
    if (!predicate(dateKey)) return sum;
    sum.active += Number(record?.active) || 0;
    sum.passive += Number(record?.passive) || 0;
    return sum;
  }, { active: 0, passive: 0 });
}

function renderGoal(period, seconds, goal) {
  const targetMinutes = Math.max(1, Math.round(Number(goal?.minutes) || 1));
  const currentMinutes = Math.round((Number(seconds) || 0) / 60);
  const percent = Math.min(100, Math.max(0, (Number(seconds) || 0) / (targetMinutes * 60) * 100));
  const counter = document.getElementById(period + "GoalCounter");
  const progress = document.getElementById(period + "GoalProgress");
  const track = progress.parentElement;
  counter.textContent = currentMinutes + " / " + targetMinutes + " min";
  progress.style.width = percent + "%";
  progress.classList.toggle("complete", percent >= 100);
  track.setAttribute("aria-valuemax", String(targetMinutes));
  track.setAttribute("aria-valuenow", String(Math.min(targetMinutes, currentMinutes)));
}

function renderSelectedGoalPeriod() {
  const period = latestGoalPeriods[selectedGoalPeriod];
  if (!period) return;
  const preferences = latestDashboard?.state?.preferences || {};
  const countingMode = normalizeGoalCountingMode(preferences.goalCountingMode);
  const displayMode = normalizeGoalDisplayMode(preferences.goalDisplayMode);
  const totalSeconds = goalRecordTotal(period, countingMode);
  const targetSeconds = Math.max(60, Number(period.goal?.minutes || 1) * 60);
  const cappedSeconds = Math.min(totalSeconds, targetSeconds);
  const activeShare = countingMode === "active"
    ? cappedSeconds
    : (totalSeconds > 0 ? cappedSeconds * period.active / totalSeconds : 0);
  const passiveShare = countingMode === "active"
    ? 0
    : (totalSeconds > 0 ? cappedSeconds * period.passive / totalSeconds : 0);
  const activeAngle = Math.max(0, Math.min(360, activeShare / targetSeconds * 360));
  const passiveAngle = Math.max(activeAngle, Math.min(360, (activeShare + passiveShare) / targetSeconds * 360));
  const currentMinutes = Math.round(totalSeconds / 60);
  const targetMinutes = Math.round(targetSeconds / 60);
  const percent = Math.round(totalSeconds / targetSeconds * 100);
  const titles = { daily: "Today", weekly: "This week", monthly: "This month", yearly: "This year" };

  document.getElementById("goalPeriodTitle").textContent = titles[selectedGoalPeriod];
  const progressLabel = formatGoalMinutes(currentMinutes);
  const progressValue = document.getElementById("goalProgressValue");
  progressValue.textContent = progressLabel;
  progressValue.classList.toggle("compact-time", progressLabel.length > 6);
  document.getElementById("goalProgressTarget").textContent = "of " + formatGoalMinutes(targetMinutes);
  document.getElementById("goalProgressPercent").textContent = percent + "%";
  document.getElementById("goalProgressRemaining").textContent = totalSeconds <= 0
    ? "Begin with one session - every minute counts"
    : totalSeconds >= targetSeconds
    ? "Goal complete"
    : formatGoalMinutes(Math.max(0, targetMinutes - currentMinutes)) + " remaining";
  document.getElementById("goalActiveValue").textContent = formatGoalMinutes(period.active / 60);
  document.getElementById("goalPassiveValue").textContent = formatGoalMinutes(period.passive / 60);
  document.getElementById("goalRemainingValue").textContent = totalSeconds >= targetSeconds
    ? "0m"
    : formatGoalMinutes(Math.max(0, targetMinutes - currentMinutes));
  ringSegments = [
    { start: 0, end: activeAngle, className: "active", label: "Active " + formatGoalMinutes(period.active / 60) },
    { start: activeAngle, end: passiveAngle, className: "passive", label: "Passive " + formatGoalMinutes(period.passive / 60) },
    { start: passiveAngle, end: 360, className: "remaining", label: totalSeconds >= targetSeconds ? "Goal complete" : "Remaining " + formatGoalMinutes(Math.max(0, targetMinutes - currentMinutes)) }
  ];
  document.getElementById("goalCountingCaption").textContent = countingMode === "active"
    ? "Only active time counts toward this goal."
    : "Active and passive time count toward this goal.";
  document.getElementById("goalActiveRow").classList.toggle("hidden", displayMode === "passive");
  document.getElementById("goalPassiveRow").classList.toggle("hidden", displayMode === "active");

  const ring = document.getElementById("goalProgressRing");
  ring.style.setProperty("--active-angle", activeAngle + "deg");
  ring.style.setProperty("--passive-angle", passiveAngle + "deg");
  ring.setAttribute(
    "aria-label",
    currentMinutes + " of " + targetMinutes + (countingMode === "active" ? " active minutes: " : " minutes: ") +
      Math.round(period.active / 60) + " active and " +
      Math.round(period.passive / 60) + " passive"
  );

  document.querySelectorAll("[data-goal-period]").forEach((button) => {
    const optionalHidden = (button.dataset.goalPeriod === "monthly" || button.dataset.goalPeriod === "yearly") &&
      latestGoalPeriods[button.dataset.goalPeriod]?.goal?.enabled !== true;
    button.hidden = optionalHidden;
    button.classList.toggle("active", button.dataset.goalPeriod === selectedGoalPeriod);
    button.setAttribute("aria-pressed", String(button.dataset.goalPeriod === selectedGoalPeriod));
  });
}

function renderTotals(state) {
  const records = state.records || {};
  const timer = state.manualTimer;
  const targetCode = state.preferences?.targetLanguage?.code || "ja";
  const timerMatchesTarget = !timer?.languageCode ? targetCode === "ja" : timer.languageCode === targetCode;
  const extra = timerMatchesTarget ? manualUncommitted(timer) : 0;
  const storedToday = records[localDateKey()] || { active: 0, passive: 0, sites: {} };
  const today = {
    active: Number(storedToday.active) || 0,
    passive: Number(storedToday.passive) || 0,
    sites: { ...(storedToday.sites || {}) }
  };
  if (timer?.running && timerMatchesTarget && extra) {
    today[timer.mode] += extra;
    const site = today.sites[timer.source] || { active: 0, passive: 0 };
    today.sites[timer.source] = { ...site, [timer.mode]: (Number(site[timer.mode]) || 0) + extra };
  }

  const weekKeys = new Set(weekDateKeys());
  const week = sumRecords(records, (key) => weekKeys.has(key));
  const now = new Date();
  const monthPrefix = localDateKey(now).slice(0, 7) + "-";
  const yearPrefix = String(now.getFullYear()) + "-";
  const month = sumRecords(records, (key) => key.startsWith(monthPrefix));
  const year = sumRecords(records, (key) => key.startsWith(yearPrefix));
  if (timer?.running && timerMatchesTarget) {
    week[timer.mode] += extra;
    month[timer.mode] += extra;
    year[timer.mode] += extra;
  }

  document.getElementById("todayActive").textContent = formatDuration(today.active);
  document.getElementById("todayPassive").textContent = formatDuration(today.passive);
  document.getElementById("todayTotal").textContent = formatDuration(today.active + today.passive);
  document.getElementById("weekActive").textContent = formatDuration(week.active);
  document.getElementById("weekPassive").textContent = formatDuration(week.passive);
  document.getElementById("weekTotal").textContent = formatDuration(week.active + week.passive);

  const goals = state.preferences?.goals || {};
  latestGoalPeriods = {
    daily: { ...today, goal: goals.daily || { enabled: true, minutes: 360 } },
    weekly: { ...week, goal: goals.weekly || { enabled: true, minutes: 900 } },
    monthly: { ...month, goal: goals.monthly || { enabled: false, minutes: 3600 } },
    yearly: { ...year, goal: goals.yearly || { enabled: false, minutes: 42000 } }
  };

  if ((selectedGoalPeriod === "monthly" || selectedGoalPeriod === "yearly") &&
      latestGoalPeriods[selectedGoalPeriod].goal?.enabled !== true) {
    selectedGoalPeriod = "daily";
  }

  const goalCountingMode = normalizeGoalCountingMode(state.preferences?.goalCountingMode);
  renderGoal("daily", goalRecordTotal(today, goalCountingMode), latestGoalPeriods.daily.goal);
  renderGoal("weekly", goalRecordTotal(week, goalCountingMode), latestGoalPeriods.weekly.goal);
  renderGoal("monthly", goalRecordTotal(month, goalCountingMode), latestGoalPeriods.monthly.goal);
  renderGoal("yearly", goalRecordTotal(year, goalCountingMode), latestGoalPeriods.yearly.goal);
  renderSelectedGoalPeriod();
}

function updateCustomLanguageVisibility() {
  if (document.getElementById("targetLanguageSelect").value === "custom") {
    document.getElementById("customLanguageName").value = "";
    document.getElementById("customLanguageCode").value = "";
    document.getElementById("customLanguageDialog").showModal();
  }
}

function initializeLanguageControls(target) {
  const select = document.getElementById("targetLanguageSelect");
  let option = [...select.options].find((item) => item.value === target.code);
  if (!option) {
    option = document.createElement("option");
    option.value = target.code;
    option.textContent = target.name;
    select.insertBefore(option, select.lastElementChild);
  }
  select.value = target.code;
  languageInitialized = true;
}

function recordTotal(record) {
  return (Number(record?.active) || 0) + (Number(record?.passive) || 0);
}

function weekKeysFor(date = new Date()) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return localDateKey(day);
  });
}

function streakFor(records, threshold, totalForRecord = recordTotal) {
  const projected = Object.entries(records || {}).map(([dateKey, record]) => ({
    dateKey,
    languageCode: "current",
    source: "all",
    activeSeconds: totalForRecord(record),
    passiveSeconds: 0,
    sessionCount: 0
  }));
  return TrackerAnalytics.currentStreak(projected, new Date(), threshold);
}

function renderCalendar(state) {
  const records = state.records || {};
  const goals = state.preferences?.goals || {};
  const goalCountingMode = normalizeGoalCountingMode(state.preferences?.goalCountingMode);
  const goalTotal = (record) => goalRecordTotal(record, goalCountingMode);
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const offset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const prefix = year + "-" + String(month + 1).padStart(2, "0") + "-";
  const monthSeconds = Object.entries(records).reduce((sum, [key, record]) => key.startsWith(prefix) ? sum + recordTotal(record) : sum, 0);
  const monthGoalSeconds = Object.entries(records).reduce((sum, [key, record]) => key.startsWith(prefix) ? sum + goalTotal(record) : sum, 0);
  document.getElementById("calendarTitle").textContent = first.toLocaleDateString([], { month: "long", year: "numeric" });
  document.getElementById("calendarMonthTotal").textContent = formatDuration(monthSeconds) + " this month";
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = '<div class="calendar-day empty"></div>'.repeat(offset);
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, month, day);
    const key = localDateKey(date);
    const seconds = recordTotal(records[key]);
    const dailyGoalSeconds = goalTotal(records[key]);
    const weekGoalSeconds = weekKeysFor(date).reduce((sum, weekKey) => sum + goalTotal(records[weekKey]), 0);
    const dailyTarget = Math.max(60, Number(goals.daily?.minutes || 360) * 60);
    const intensity = seconds <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(seconds / dailyTarget * 4)));
    const classes = ["calendar-day"];
    if (key === localDateKey()) classes.push("today");
    if (seconds > 0) classes.push("has-time", "level-" + intensity);
    if (dailyGoalSeconds >= dailyTarget) classes.push("daily-complete");
    if (weekGoalSeconds >= Number(goals.weekly?.minutes || 900) * 60) classes.push("week-complete");
    const label = date.toLocaleDateString([], { month: "long", day: "numeric" }) + ": " +
      (seconds ? formatDuration(seconds) : "No immersion") +
      (dailyGoalSeconds >= dailyTarget ? ", daily goal met" : "") +
      (weekGoalSeconds >= Number(goals.weekly?.minutes || 900) * 60 ? ", weekly goal met" : "") +
      (key === localDateKey() ? ", today" : "");
    grid.insertAdjacentHTML("beforeend", '<div class="' + classes.join(" ") + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + day + (seconds ? "<small>" + Math.round(seconds / 60) + "m</small>" : "") + "</div>");
  }
  document.getElementById("calendarCard").classList.toggle("month-complete", Boolean(goals.monthly?.enabled && monthGoalSeconds >= Number(goals.monthly.minutes) * 60));
  const immersion = streakFor(records, 1);
  const goal = streakFor(records, Number(goals.daily?.minutes || 360) * 60, goalTotal);
  document.getElementById("immersionStreak").textContent = immersion + (immersion === 1 ? " day" : " days");
  document.getElementById("goalStreak").textContent = goal + (goal === 1 ? " day" : " days");
  const weekGoalSeconds = weekKeysFor().reduce((sum, key) => sum + goalTotal(records[key]), 0);
  const remaining = Math.max(0, Number(goals.weekly?.minutes || 900) - Math.round(weekGoalSeconds / 60));
  const unit = goalCountingMode === "active" ? " active minutes" : " minutes";
  document.getElementById("weekReviewText").textContent = remaining ? remaining + unit + " left to complete this week's goal." : "Weekly goal complete - excellent consistency.";
}

function renderInsights(state) {
  const records = state.records || {};
  const items = weekKeysFor().map((key) => records[key] || { active: 0, passive: 0 });
  const goalCountingMode = normalizeGoalCountingMode(state.preferences?.goalCountingMode);
  const dailyGoalMinutes = Math.max(1, Number(state.preferences?.goals?.daily?.minutes) || 360);
  const dailyGoalSeconds = dailyGoalMinutes * 60;
  const weeklyChart = document.getElementById("weeklyChart");
  const maxBarHeight = Math.max(122, Math.min(280, Math.round(weeklyChart.clientHeight - 26)));
  document.getElementById("weeklyChartScale").textContent = goalCountingMode === "active"
    ? "Each bar still compares all active and passive immersion with your " +
      formatGoalMinutes(dailyGoalMinutes) + " daily target. Goal Progress counts active time only. " +
      "Hover a color for its exact duration."
    : "Each bar shows progress toward your " + formatGoalMinutes(dailyGoalMinutes) +
      " daily goal. Hover a color for its exact duration.";
  const weeklyEmpty = items.every((record) => recordTotal(record) === 0);
  weeklyChart.classList.toggle("is-empty", weeklyEmpty);
  const weeklyBars = items.map((record, index) => {
    const active = Number(record.active) || 0;
    const passive = Number(record.passive) || 0;
    const total = active + passive;
    const goalProgress = goalRecordTotal(record, goalCountingMode);
    const filledHeight = Math.min(maxBarHeight, total / dailyGoalSeconds * maxBarHeight);
    const activeHeight = total ? filledHeight * active / total : 0;
    const passiveHeight = total ? filledHeight * passive / total : 0;
    const dayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index];
    const summary = dayName + ": Active " + formatDuration(active) + ", Passive " +
      formatDuration(passive) + ", Total " + formatDuration(total) + ", Goal progress " +
      formatDuration(goalProgress) + " of " + formatGoalMinutes(dailyGoalMinutes);
    return '<div class="chart-day"><div class="bar-stack" title="' + escapeHtml(summary) +
      '" aria-label="' + escapeHtml(summary) + '"><div class="bar-active" title="Active: ' +
      escapeHtml(formatDuration(active)) + '" style="height:' + activeHeight +
      'px"></div><div class="bar-passive" title="Passive: ' + escapeHtml(formatDuration(passive)) +
      '" style="height:' + passiveHeight + 'px"></div></div><label>' +
      ["M","T","W","T","F","S","S"][index] + "</label></div>";
  }).join("");
  weeklyChart.innerHTML = weeklyBars + (weeklyEmpty
    ? '<div class="chart-empty-state" role="status"><span>Your week starts with one session</span></div>'
    : "");
  const code = state.preferences?.targetLanguage?.code || "ja";
  const sources = Object.fromEntries(
    Object.entries(state.sourceTotals?.[code] || {}).map(([site, value]) => [site, recordTotal(value)])
  );
  const top = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  const maxSource = top[0]?.[1] || 1;
  document.getElementById("sourceChart").innerHTML = top.length ? top.map(([site, seconds]) =>
    '<div class="source-row"><span title="' + escapeHtml(sourceLabel(site)) + '">' + escapeHtml(sourceLabel(site)) + '</span><div class="source-track"><div class="source-fill" style="width:' + seconds / maxSource * 100 + '%"></div></div><strong>' + formatSourceScore(seconds) + "</strong></div>"
  ).join("") : '<div class="history-empty invitation"><strong>Your source mix starts here</strong><span>Play a video or add a manual session.</span></div>';
}

function formatSourceScore(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 360) return minutes + "m";
  const hours = minutes / 60;
  return (hours >= 100 ? Math.round(hours) : hours.toFixed(1).replace(/\.0$/, "")) + "h";
}

function sessionTotals(session) {
  return Object.values(session?.byDate || {}).reduce((sum, item) => {
    sum.active += Number(item.active) || 0;
    sum.passive += Number(item.passive) || 0;
    return sum;
  }, { active: 0, passive: 0 });
}

function renderHistory(state) {
  const code = state.preferences?.targetLanguage?.code || "ja";
  const sessions = Object.entries(state.sessions || {}).filter(([, session]) => (session.languageCode || "ja") === code).sort((a, b) => (Number(b[1].lastAt) || 0) - (Number(a[1].lastAt) || 0)).slice(0, state.preferences?.historyLimit === 10 ? 10 : 5);
  document.getElementById("undoDeleteButton").classList.toggle("hidden", !state.lastDeletedSession);
  document.getElementById("historyList").innerHTML = sessions.length ? sessions.map(([id, session]) => {
    const totals = sessionTotals(session);
    const date = Object.keys(session.byDate || {})[0] || localDateKey(new Date(session.startedAt || Date.now()));
    const locked = state.manualTimer?.running && state.manualTimer.id === id;
    return '<div class="history-item" data-session-id="' + escapeHtml(id) + '"><div><strong>' + escapeHtml(session.title || sourceLabel(session.site)) + '</strong><span class="history-meta"><span>' + escapeHtml(date + " · " + sourceLabel(session.site || "other")) + '</span><span>Active ' + escapeHtml(formatDuration(totals.active)) + ' / Passive ' + escapeHtml(formatDuration(totals.passive)) + '</span></span></div><div class="history-actions"><button data-action="edit" ' + (locked ? "disabled" : "") + '>Edit</button><button data-action="delete" class="danger" ' + (locked ? "disabled" : "") + ">Delete</button></div></div>";
  }).join("") : '<div class="history-empty invitation"><strong>Your study log is ready</strong><span>Completed immersion will appear here.</span></div>';
}

async function render() {
  const dashboard = await sendRuntimeMessage({ type: "getDashboard" });
  if (!dashboard) return;
  latestDashboard = dashboard;
  const state = dashboard.state || { records: {}, currentStatus: {}, preferences: {} };
  document.getElementById("storageErrorBanner").classList.toggle("hidden", !dashboard.storageHealth?.writeError);
  applyTheme(themeOverride || state.preferences?.theme);
  const target = state.preferences?.targetLanguage || { code: "ja", name: "Japanese" };
  if (!languageInitialized || document.getElementById("targetLanguageSelect").value !== target.code) initializeLanguageControls(target);

  let activeTab = null;
  let current = null;
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const rawCurrent = activeTab ? state.currentStatus?.[String(activeTab.id)] : null;
  const currentMatchesTarget = rawCurrent && (
    rawCurrent.languageCode === target.code ||
    (!rawCurrent.languageCode && target.code === "ja")
  );
  current = currentMatchesTarget ? rawCurrent : null;
  latestActiveTab = activeTab || null;

  renderCurrent(current, activeTab);
  renderCategoryOptions(state.preferences || {});
  renderManualTimer(state.manualTimer, state.preferences || {}, current);
  renderTotals(state);
  renderCalendar(state);
  renderInsights(state);
  renderHistory(state);
  document.getElementById("historyLimit").value = state.preferences?.historyLimit === 10 ? "10" : "5";


  if (!settingsInitialized) {
    document.getElementById("fullyManualEnabled").checked = state.preferences?.fullyManualEnabled === true;
    document.getElementById("analyticsConsent").checked = state.preferences?.analyticsConsent === true;
    document.getElementById("autoMinimizeEnabled").checked = state.preferences?.autoMinimizeEnabled !== false;
    document.getElementById("autoMinimizeSeconds").value = state.preferences?.autoMinimizeSeconds || 5;
    settingsInitialized = true;
  }

  if (!goalsInitialized) {
    const goals = state.preferences?.goals || {};
    document.getElementById("dailyGoalMinutes").value = goals.daily?.minutes || 360;
    document.getElementById("weeklyGoalMinutes").value = goals.weekly?.minutes || 900;
    document.getElementById("monthlyGoalEnabled").checked = goals.monthly?.enabled === true;
    document.getElementById("monthlyGoalMinutes").value = goals.monthly?.minutes || 3600;
    document.getElementById("yearlyGoalEnabled").checked = goals.yearly?.enabled === true;
    document.getElementById("yearlyGoalMinutes").value = goals.yearly?.minutes || 42000;
    document.getElementById("goalCountingMode").value = normalizeGoalCountingMode(state.preferences?.goalCountingMode);
    document.getElementById("goalDisplayMode").value = normalizeGoalDisplayMode(state.preferences?.goalDisplayMode);
    document.getElementById("notificationsEnabled").checked = state.preferences?.notificationsEnabled !== false;
    updateOptionalGoalInputs();
    goalsInitialized = true;
  }

  if (!onboardingHandled && state.preferences?.onboardingCompleted === false) {
    onboardingHandled = true;
    setTimeout(() => openOnboardingSetup(state.preferences), 0);
  }

  const sync = dashboard.sync || {};
  const syncStatus = document.getElementById("syncStatus");
  if (sync.pendingMonths > 0) {
    syncStatus.textContent = "Chrome Sync: " + sync.pendingMonths + " update" + (sync.pendingMonths === 1 ? "" : "s") + " pending";
  } else if (sync.lastSyncedAt) {
    const time = new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    syncStatus.textContent = "Chrome Sync: last saved " + time;
  } else {
    syncStatus.textContent = "Chrome Sync: waiting for first recorded time";
  }
}

function setOnboardingStep(nextStep) {
  onboardingStep = Math.max(0, Math.min(4, nextStep));
  document.querySelectorAll("[data-onboarding-step]").forEach((section) => {
    section.classList.toggle("hidden", Number(section.dataset.onboardingStep) !== onboardingStep);
  });
  document.getElementById("onboardingStepLabel").textContent = "Step " + (onboardingStep + 1) + " of 5";
  document.getElementById("onboardingBackButton").disabled = onboardingStep === 0;
  document.getElementById("onboardingNextButton").textContent =
    onboardingStep === 0 ? "Get started" : onboardingStep === 4 ? "Save and take tour" : "Next";
  document.getElementById("onboardingStatus").textContent = "";
}

function updateOnboardingCustomLanguage() {
  const custom = document.getElementById("onboardingLanguageSelect").value === "custom";
  document.getElementById("onboardingCustomLanguage").classList.toggle("hidden", !custom);
}

function openOnboardingSetup(preferences = {}) {
  const sourceSelect = document.getElementById("targetLanguageSelect");
  const select = document.getElementById("onboardingLanguageSelect");
  select.innerHTML = sourceSelect.innerHTML;
  const target = preferences.targetLanguage || { code: "ja", name: "Japanese" };
  select.insertAdjacentHTML("afterbegin", '<option value="later">Choose later</option>');
  const hasOption = [...select.options].some((option) => option.value === target.code);
  select.value = target.code === "und" || preferences.targetLanguageDeferred === true
    ? "later"
    : hasOption ? target.code : "custom";
  document.getElementById("onboardingCustomLanguageName").value = hasOption ? "" : target.name || "";
  document.getElementById("onboardingCustomLanguageCode").value = hasOption ? "" : target.code || "";
  document.getElementById("onboardingDailyGoal").value = preferences.goals?.daily?.minutes || 60;
  document.getElementById("onboardingWeeklyGoal").value = preferences.goals?.weekly?.minutes || 420;
  document.getElementById("onboardingNotifications").checked = preferences.notificationsEnabled !== false;
  updateOnboardingCustomLanguage();
  setOnboardingStep(0);
  const dialog = document.getElementById("onboardingDialog");
  if (!dialog.open) dialog.showModal();
}

function onboardingLanguageChoice() {
  const select = document.getElementById("onboardingLanguageSelect");
  if (select.value === "later") return { code: "und", name: "Choose a language" };
  if (select.value !== "custom") {
    return { code: select.value, name: select.selectedOptions[0]?.textContent?.trim() || select.value.toUpperCase() };
  }
  return {
    code: document.getElementById("onboardingCustomLanguageCode").value.trim().toLowerCase().replace(/_/g, "-"),
    name: document.getElementById("onboardingCustomLanguageName").value.trim()
  };
}

async function completeOnboarding({ saveSetup = true } = {}) {
  const status = document.getElementById("onboardingStatus");
  const targetLanguage = onboardingLanguageChoice();
  if (saveSetup && (targetLanguage.code !== "auto" && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(targetLanguage.code) || !targetLanguage.name)) {
    setOnboardingStep(1);
    status.textContent = "Enter a language name and a valid code such as ja, sv, es, or pt-BR.";
    return;
  }
  if (saveSetup) {
    const dailyValue = Number(document.getElementById("onboardingDailyGoal").value);
    const weeklyValue = Number(document.getElementById("onboardingWeeklyGoal").value);
    if (!Number.isFinite(dailyValue) || dailyValue <= 0 || !Number.isFinite(weeklyValue) || weeklyValue <= 0) {
      setOnboardingStep(2);
      status.textContent = "Enter daily and weekly goals greater than zero.";
      return;
    }
    const daily = Math.min(525600, Math.round(dailyValue));
    const weekly = Math.min(525600, Math.round(weeklyValue));
    const languageResponse = await sendRuntimeMessage({ type: "setTargetLanguage", targetLanguage });
    const goalsResponse = await sendRuntimeMessage({
      type: "setGoals",
      goals: { daily: { minutes: daily }, weekly: { minutes: weekly } }
    });
    if (!languageResponse?.ok || !goalsResponse?.ok) {
      status.textContent = "Setup could not be saved. Please try again.";
      return;
    }
  } else {
    const languageResponse = await sendRuntimeMessage({
      type: "setTargetLanguage",
      targetLanguage: { code: "und", name: "Choose a language" }
    });
    if (!languageResponse?.ok) {
      status.textContent = "Setup could not be postponed. Please try again.";
      return;
    }
  }
  const preferencesResponse = await sendRuntimeMessage({
    type: "setPreferences",
    preferences: {
      onboardingCompleted: true,
      ...(saveSetup ? { notificationsEnabled: document.getElementById("onboardingNotifications").checked } : {})
    }
  });
  if (!preferencesResponse?.ok) {
    status.textContent = "Setup could not be saved. Please try again.";
    return;
  }
  document.getElementById("onboardingDialog").close();
  languageInitialized = false;
  goalsInitialized = false;
  await render();
  startTutorial();
}

const TUTORIAL_STEPS = [
  { target: "targetLanguageSelect", title: "Choose your active language", body: "Free tracks one active target language at a time. You can switch whenever you like; earlier language totals and remembered choices stay safely stored." },
  { target: "trackerPanel", panel: "trackerPanel", title: "See what is recording", body: "Tracker shows the current video, active and passive time, and progress toward your goals." },
  { target: "showOverlayButton", panel: "trackerPanel", title: "Open video status", body: "Show status opens the on-video controls. If selected audio cannot be identified, confirm the current video; after repeated matching confirmations, the tracker may offer to remember strongly related videos." },
  { target: "automaticSessionCard", panel: "trackerPanel", title: "Read the minimized session badge", body: "On the video page, the minimized badge stays visible. Green means active immersion, orange means passive immersion, and grey means inactive or paused. Click the badge to open full status." },
  { target: "automaticSessionCard", panel: "trackerPanel", title: "Greenlight a YouTube channel", body: "When YouTube shows a language confirmation, choose Always count channel to greenlight that channel for this target language. Future videos from it will count automatically; a normal Yes applies only to the current video." },
  { target: "goalProgressRing", panel: "trackerPanel", title: "Customize Goal Progress", body: "In Adjust goals, choose whether active and passive time or active time only advances goals. You can show both detail rows, active only, or passive only here; Insights always keeps both." },
  { target: "goalProgressRing", panel: "trackerPanel", title: "Weekly review notifications", body: "When notifications are enabled, Chrome sends a review every Sunday at 20:00 for your selected language. It follows your goal-counting choice. Goal-complete notifications are also sent once when a goal is reached." },
  { target: "insightsPanel", panel: "insightsPanel", title: "Review your immersion", body: "Insights contains your calendar, goal-scaled weekly bars, exact hover durations, sources, and session history." },
  { target: "openDashboardButton", title: "Open the full dashboard", body: "The dashboard includes Overview, History, Settings, and advanced Pro Analytics. Pro Analytics is unlocked for everyone during beta." },
  { target: "manualPanel", panel: "manualPanel", title: "Record anything", body: "Use Manual for reading, speaking, study, or a video site the extension does not recognize." },
  { target: "openAccountInfo", title: "Account and plan", body: "This version uses a local beta profile, so there is no login yet. Open this panel to see what Free includes, what Pro unlocks, and which account features are planned later." },
  { target: "openGeneralSettings", title: "Settings and help", body: "Choose fully manual language mode, adjust the video overlay and goals, sync or export data, configure shortcuts, and replay this tutorial at any time." }
];

function clearTutorialTarget() {
  tutorialTarget?.classList.remove("tutorial-target");
  document.querySelectorAll(".tutorial-context").forEach((element) => element.classList.remove("tutorial-context"));
  tutorialTarget = null;
}

function positionTutorialCoachmark() {
  if (!tutorialTarget) return;
  const coachmark = document.getElementById("tutorialCoachmark");
  const coachHeight = coachmark.offsetHeight || 130;
  const offset = coachHeight + 16;
  document.documentElement.style.setProperty("--tutorial-offset", offset + "px");
  coachmark.style.top = "0px";
  coachmark.style.left = "0px";
}

function renderTutorialStep() {
  clearTutorialTarget();
  const step = TUTORIAL_STEPS[tutorialStep];
  if (step.panel) activatePopupTab(step.panel);
  tutorialTarget = document.getElementById(step.target);
  if (!tutorialTarget) return finishTutorial();
  tutorialTarget.closest("header, nav")?.classList.add("tutorial-context");
  tutorialTarget.classList.add("tutorial-target");
  document.getElementById("tutorialStepLabel").textContent = "Quick tour " + (tutorialStep + 1) + " of " + TUTORIAL_STEPS.length;
  document.getElementById("tutorialTitle").textContent = step.title;
  document.getElementById("tutorialBody").textContent = step.body;
  document.getElementById("tutorialBackButton").disabled = tutorialStep === 0;
  document.getElementById("tutorialNextButton").textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next";
  requestAnimationFrame(() => {
    positionTutorialCoachmark();
    tutorialTarget?.scrollIntoView({ block: "start", behavior: "auto" });
  });
}

function startTutorial() {
  tutorialStep = 0;
  document.body.classList.add("tutorial-active");
  document.getElementById("tutorialCoachmark").classList.remove("hidden");
  renderTutorialStep();
}

function finishTutorial() {
  clearTutorialTarget();
  document.body.classList.remove("tutorial-active");
  document.documentElement.style.setProperty("--tutorial-offset", "0px");
  document.getElementById("tutorialScrim").classList.add("hidden");
  document.getElementById("tutorialCoachmark").classList.add("hidden");
}

function confirmTargetLanguageSwitch(nextLanguage) {
  const current = selectedTargetLanguage();
  if (!current?.code || current.code === "und" || current.code === nextLanguage.code) return true;
  return confirm(
    "Switch your active language from " + current.name + " to " + nextLanguage.name + "?\n\n" +
    "Your " + current.name + " history will stay saved. Free supports one active language at a time. " +
    "Multi-language workspaces are planned for Pro later."
  );
}

function openAccountInfoDialog() {
  const state = latestDashboard?.state || {};
  const target = state.preferences?.targetLanguage || { code: "und", name: "Choose a language" };
  const beta = state.entitlements?.plan === "beta" || state.entitlements?.proEnabled === true;
  document.getElementById("accountPlanName").textContent = beta
    ? "Beta access · Pro Analytics unlocked"
    : "Free plan";
  document.getElementById("accountLanguageStatus").textContent =
    state.preferences?.targetLanguageDeferred === true || target.code === "und"
      ? "No target language selected"
      : "One active target · " + target.name;
  const dialog = document.getElementById("accountInfoDialog");
  if (!dialog.open) dialog.showModal();
  refreshAccountState();
}

let latestAccountState = null;
let cloudMode = "signin";

function setCloudFormStatus(message, isError = false) {
  const status = document.getElementById("cloudAccountFormStatus");
  status.textContent = message || "";
  status.classList.toggle("error", Boolean(message) && isError);
}

function setCloudMode(mode) {
  cloudMode = mode;
  document.querySelectorAll("[data-cloud-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.cloudMode === mode || (mode === "forgot-confirm" && button.dataset.cloudMode === "forgot"));
  });
  document.getElementById("cloudSignInForm").classList.toggle("hidden", mode !== "signin");
  document.getElementById("cloudSignUpForm").classList.toggle("hidden", mode !== "signup");
  document.getElementById("cloudForgotRequestForm").classList.toggle("hidden", mode !== "forgot");
  document.getElementById("cloudForgotConfirmForm").classList.toggle("hidden", mode !== "forgot-confirm");
  setCloudFormStatus("");
}

function renderAccountSection() {
  const account = latestAccountState?.account;
  const signedIn = account?.status === "authenticated" && account?.connected;
  document.getElementById("cloudSignedInView").classList.toggle("hidden", !signedIn);
  document.getElementById("cloudGuestView").classList.toggle("hidden", signedIn);
  const statusText = document.getElementById("cloudAccountStatus");
  if (!latestAccountState) {
    statusText.textContent = "Checking cloud sync status...";
  } else if (!latestAccountState.cloudReady) {
    statusText.textContent = "Cloud sync isn't set up on this build yet. Local tracking keeps working either way.";
  } else if (signedIn) {
    statusText.textContent = "Signed in.";
  } else if (account?.status === "expired") {
    statusText.textContent = "Your session expired. Sign in again to keep using cloud sync.";
  } else {
    statusText.textContent = "Not signed in · your local history keeps working either way.";
  }
  const trialStatusEl = document.getElementById("cloudTrialStatus");
  if (signedIn) {
    document.getElementById("cloudAccountEmail").textContent = latestAccountState.email || "your account";
    const trial = latestAccountState.trial;
    if (!trial?.startedAt) {
      trialStatusEl.textContent = "Cloud sync is starting up on this device...";
    } else if (trial.active) {
      trialStatusEl.textContent = trial.daysRemaining <= 1
        ? "Free cloud-sync trial ends today."
        : `Free cloud-sync trial — ${trial.daysRemaining} days left.`;
    } else {
      trialStatusEl.textContent = "Your 3-month cloud-sync trial has ended. Local tracking keeps working — cloud sync is paused.";
    }
  } else {
    setCloudMode(cloudMode === "forgot-confirm" ? cloudMode : "signin");
  }
}

async function refreshAccountState() {
  const response = await sendRuntimeMessage({ type: "getAccountState" });
  latestAccountState = response?.ok ? response : { ok: false, cloudReady: false, account: { status: "guest", connected: false } };
  renderAccountSection();
}

document.querySelectorAll("[data-cloud-mode]").forEach((button) => {
  button.addEventListener("click", () => setCloudMode(button.dataset.cloudMode));
});

document.getElementById("cloudForgotBack").addEventListener("click", () => setCloudMode("signin"));

document.getElementById("cloudSignInForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("cloudSignInEmail").value.trim();
  const password = document.getElementById("cloudSignInPassword").value;
  setCloudFormStatus("Signing in...");
  const response = await sendRuntimeMessage({ type: "cloudSignIn", email, password });
  if (response?.ok) {
    document.getElementById("cloudSignInPassword").value = "";
    await refreshAccountState();
  } else {
    setCloudFormStatus(response?.error?.message || "Could not sign in.", true);
  }
});

document.getElementById("cloudSignUpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("cloudSignUpEmail").value.trim();
  const password = document.getElementById("cloudSignUpPassword").value;
  setCloudFormStatus("Creating your account...");
  const response = await sendRuntimeMessage({ type: "cloudSignUp", email, password });
  if (response?.ok) {
    document.getElementById("cloudSignUpPassword").value = "";
    await refreshAccountState();
  } else {
    setCloudFormStatus(response?.error?.message || "Could not create your account.", true);
  }
});

document.getElementById("cloudForgotRequestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("cloudForgotEmail").value.trim();
  setCloudFormStatus("Sending code...");
  const response = await sendRuntimeMessage({ type: "cloudRequestPasswordReset", email });
  if (response?.ok) {
    setCloudMode("forgot-confirm");
    setCloudFormStatus("If that email has an account, a code is on its way. Enter it below.");
  } else {
    setCloudFormStatus(response?.error?.message || "Enter a valid email address.", true);
  }
});

document.getElementById("cloudForgotConfirmForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("cloudForgotEmail").value.trim();
  const code = document.getElementById("cloudForgotCode").value.trim();
  const newPassword = document.getElementById("cloudForgotNewPassword").value;
  setCloudFormStatus("Setting your new password...");
  const response = await sendRuntimeMessage({ type: "cloudConfirmPasswordReset", email, code, newPassword });
  if (response?.ok) {
    document.getElementById("cloudForgotCode").value = "";
    document.getElementById("cloudForgotNewPassword").value = "";
    await refreshAccountState();
  } else {
    setCloudFormStatus(response?.error?.message || "That code is invalid or expired.", true);
  }
});

document.getElementById("cloudSignOutButton").addEventListener("click", async () => {
  await sendRuntimeMessage({ type: "cloudSignOut" });
  await refreshAccountState();
});

document.getElementById("targetLanguageSelect").addEventListener("change", async (event) => {
  if (event.target.value === "custom") {
    updateCustomLanguageVisibility();
    return;
  }
  const nextLanguage = { code: event.target.value, name: event.target.selectedOptions[0].textContent };
  if (!confirmTargetLanguageSwitch(nextLanguage)) {
    initializeLanguageControls(selectedTargetLanguage());
    return;
  }
  const response = await sendRuntimeMessage({
    type: "setTargetLanguage",
    targetLanguage: nextLanguage
  });
  if (response?.ok) {
    languageInitialized = false;
    manualFieldsInitialized = false;
    await render();
  }
});

document.getElementById("closeLanguageDialog").addEventListener("click", () => {
  document.getElementById("customLanguageDialog").close();
  initializeLanguageControls(selectedTargetLanguage());
});

document.getElementById("saveLanguageButton").addEventListener("click", async () => {
  const select = document.getElementById("targetLanguageSelect");
  const custom = select.value === "custom";
  const code = (custom
    ? document.getElementById("customLanguageCode").value
    : select.value).trim().toLowerCase().replace(/_/g, "-");
  const name = (custom
    ? document.getElementById("customLanguageName").value
    : select.selectedOptions[0]?.textContent || code.toUpperCase()).trim();
  const status = document.getElementById("languageStatus");
  if ((code !== "auto" && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)) || !name) {
    status.textContent = "Enter a language name and a valid code such as ja, sv, es, or pt-BR.";
    return;
  }
  if (!confirmTargetLanguageSwitch({ code, name })) {
    document.getElementById("customLanguageDialog").close();
    initializeLanguageControls(selectedTargetLanguage());
    return;
  }
  const response = await sendRuntimeMessage({
    type: "setTargetLanguage",
    targetLanguage: { code, name }
  });
  status.textContent = response?.ok ? "Now tracking " + response.targetLanguage.name + "." : "Could not change language.";
  if (response?.ok) {
    document.getElementById("customLanguageDialog").close();
    languageInitialized = false;
    await render();
  }
});

document.getElementById("startManualButton").addEventListener("click", async () => {
  const actionInput = document.getElementById("manualAction");
  const action = actionInput.value.trim();
  const source = document.getElementById("manualSource").value;
  const mode = document.getElementById("manualMode").value;
  const status = document.getElementById("manualStatus");
  if (!action) {
    status.textContent = "Describe the action before starting the timer.";
    actionInput.focus();
    return;
  }
  if (source === "__custom__") {
    showCustomCategoryBuilder("manualSource");
    return;
  }
  status.textContent = "";
  const response = await sendRuntimeMessage({
    type: "startManualTimer",
    source,
    action,
    mode,
    languageCode: selectedTargetLanguage().code
  });
  const current = latestActiveTab
    ? latestDashboard?.state?.currentStatus?.[String(latestActiveTab.id)]
    : null;
  if (
    response?.timer?.running &&
    latestActiveTab &&
    (current?.state === "recording-active" || current?.state === "recording-passive")
  ) {
    await sendTabMessage(latestActiveTab.id, { type: "toggleTrackerPause" });
  }
  await render();
});
document.getElementById("pauseManualButton").addEventListener("click", async () => {
  await sendRuntimeMessage({ type: "pauseManualTimer" });
  await render();
});

document.getElementById("customImmersionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = document.getElementById("customAction").value.trim();
  const selectedDate = document.getElementById("customDate").value;
  const source = document.getElementById("customSource").value;
  const mode = document.getElementById("customMode").value;
  const hours = Math.max(0, Number(document.getElementById("customHours").value) || 0);
  const minutes = Math.max(0, Number(document.getElementById("customMinutes").value) || 0);
  const seconds = hours * 3600 + minutes * 60;
  const status = document.getElementById("customStatus");
  if (source === "__custom__") {
    showCustomCategoryBuilder("customSource");
    return;
  }
  if (!action || !seconds) {
    status.textContent = "Enter an action and a duration greater than zero.";
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || selectedDate > localDateKey()) {
    status.textContent = "Choose today or an earlier date.";
    return;
  }
  const response = await sendRuntimeMessage({
    type: "addCustomImmersion",
    source,
    action,
    mode,
    seconds,
    date: selectedDate,
    languageCode: selectedTargetLanguage().code
  });
  status.textContent = response?.ok
    ? "Added " + formatDuration(seconds) + " of " + mode + " immersion to " + selectedDate + "."
    : response?.reason === "invalid-date"
      ? "Choose today or an earlier date."
      : "Could not add this entry.";
  if (response?.ok) {
    document.getElementById("customAction").value = "";
    await render();
  }
});

function showCustomCategoryBuilder(targetId) {
  customCategoryTargetId = targetId;
  const builder = document.getElementById("customCategoryBuilder");
  builder.classList.remove("hidden");
  document.getElementById("customCategoryStatus").textContent = "";
  document.getElementById("newCustomCategory").focus();
}

["manualSource", "customSource"].forEach((id) => {
  document.getElementById(id).addEventListener("change", (event) => {
    if (event.target.value === "__custom__") showCustomCategoryBuilder(id);
  });
});

document.getElementById("cancelCustomCategory").addEventListener("click", () => {
  document.getElementById("customCategoryBuilder").classList.add("hidden");
  const select = document.getElementById(customCategoryTargetId);
  if (select.value === "__custom__") select.value = "reading";
});

document.getElementById("addCustomCategory").addEventListener("click", async () => {
  const input = document.getElementById("newCustomCategory");
  const category = normalizeCategory(input.value);
  const status = document.getElementById("customCategoryStatus");
  if (!category || category === "__custom__") {
    status.textContent = "Enter a category name.";
    input.focus();
    return;
  }
  const current = latestDashboard?.state?.preferences?.customManualCategories || [];
  const categories = [...current];
  if (!categories.some((item) => item.toLowerCase() === category.toLowerCase()) &&
      !DEFAULT_MANUAL_CATEGORIES.includes(category.toLowerCase())) categories.push(category);
  const response = await sendRuntimeMessage({
    type: "setPreferences",
    preferences: { customManualCategories: categories }
  });
  if (!response?.ok) {
    status.textContent = "Could not save this category.";
    return;
  }
  latestDashboard.state.preferences.customManualCategories = response.preferences.customManualCategories;
  categoryOptionsSignature = "";
  renderCategoryOptions(response.preferences);
  document.getElementById(customCategoryTargetId).value = response.preferences.customManualCategories.find(
    (item) => item.toLowerCase() === category.toLowerCase()
  ) || category.toLowerCase();
  input.value = "";
  document.getElementById("customCategoryBuilder").classList.add("hidden");
});
function updateOptionalGoalInputs() {
  document.getElementById("monthlyGoalMinutes").disabled = !document.getElementById("monthlyGoalEnabled").checked;
  document.getElementById("yearlyGoalMinutes").disabled = !document.getElementById("yearlyGoalEnabled").checked;
}

document.getElementById("monthlyGoalEnabled").addEventListener("change", updateOptionalGoalInputs);
document.getElementById("yearlyGoalEnabled").addEventListener("change", updateOptionalGoalInputs);

document.getElementById("saveGoalSettings").addEventListener("click", async () => {
  const response = await sendRuntimeMessage({
    type: "setGoals",
    goals: {
      daily: { minutes: document.getElementById("dailyGoalMinutes").value },
      weekly: { minutes: document.getElementById("weeklyGoalMinutes").value },
      monthly: {
        enabled: document.getElementById("monthlyGoalEnabled").checked,
        minutes: document.getElementById("monthlyGoalMinutes").value
      },
      yearly: {
        enabled: document.getElementById("yearlyGoalEnabled").checked,
        minutes: document.getElementById("yearlyGoalMinutes").value
      }
    }
  });
  const preferencesResponse = await sendRuntimeMessage({
    type: "setPreferences",
    preferences: {
      notificationsEnabled: document.getElementById("notificationsEnabled").checked,
      goalCountingMode: document.getElementById("goalCountingMode").value,
      goalDisplayMode: document.getElementById("goalDisplayMode").value
    }
  });
  const saved = response?.ok && preferencesResponse?.ok;
  document.getElementById("goalSettingsStatus").textContent = saved ? "Goals saved." : "Could not save goals.";
  if (saved) {
    goalsInitialized = false;
    await render();
    document.getElementById("goalSettingsDialog").close();
  }
});

document.getElementById("saveTrackingSettings").addEventListener("click", async () => {
  const enabled = document.getElementById("fullyManualEnabled").checked;
  const response = await sendRuntimeMessage({
    type: "setPreferences",
    preferences: { fullyManualEnabled: enabled }
  });
  const status = document.getElementById("trackingSettingsStatus");
  if (!response?.ok) {
    status.textContent = "Could not save the language mode.";
    return;
  }
  if (latestDashboard?.state?.preferences) {
    latestDashboard.state.preferences.fullyManualEnabled = enabled;
    renderCurrent(
      latestActiveTab ? latestDashboard.state.currentStatus?.[String(latestActiveTab.id)] : null,
      latestActiveTab
    );
  }
  status.textContent = enabled
    ? "Fully manual language mode enabled."
    : "Automatic language checks enabled.";
});

document.getElementById("saveAnalyticsSettings").addEventListener("click", async () => {
  const enabled = document.getElementById("analyticsConsent").checked;
  const response = await sendRuntimeMessage({
    type: "setPreferences",
    preferences: { analyticsConsent: enabled }
  });
  const status = document.getElementById("analyticsSettingsStatus");
  if (!response?.ok) {
    status.textContent = "Could not save the analytics preference.";
    return;
  }
  if (latestDashboard?.state?.preferences) {
    latestDashboard.state.preferences.analyticsConsent = enabled;
  }
  status.textContent = enabled
    ? "Thanks - anonymous usage analytics are now on."
    : "Anonymous usage analytics are off.";
});

document.getElementById("saveOverlaySettings").addEventListener("click", async () => {
  const enabled = document.getElementById("autoMinimizeEnabled").checked;
  const seconds = Math.min(300, Math.max(1, Number(document.getElementById("autoMinimizeSeconds").value) || 5));
  const response = await sendRuntimeMessage({
    type: "setPreferences",
    preferences: { autoMinimizeEnabled: enabled, autoMinimizeSeconds: seconds }
  });
  document.getElementById("settingsStatus").textContent = response?.ok ? "Overlay settings saved." : "Could not save settings.";
});

async function setThemePreference(value) {
  const previousTheme = normalizeTheme(themeOverride || latestDashboard?.state?.preferences?.theme);
  const theme = normalizeTheme(value);
  const changeSequence = ++themeChangeSequence;
  themeOverride = theme;
  applyTheme(theme);
  const status = document.getElementById("themeStatus");
  status.textContent = "Saving...";
  const response = await sendRuntimeMessage({ type: "setPreferences", preferences: { theme } });
  if (changeSequence !== themeChangeSequence) return;
  if (!response?.ok) {
    themeOverride = previousTheme;
    applyTheme(previousTheme);
    status.textContent = "Could not save the theme.";
    return;
  }
  if (latestDashboard?.state?.preferences) latestDashboard.state.preferences.theme = theme;
  status.textContent = theme === "light" ? "Light mode enabled." : "Dark mode enabled.";
}

["lightThemeButton", "darkThemeButton"].forEach((id) => {
  const button = document.getElementById(id);
  button.addEventListener("click", () => setThemePreference(button.dataset.themeValue));
});

document.getElementById("quickThemeToggle").addEventListener("click", (event) => {
  setThemePreference(event.currentTarget.dataset.nextTheme);
});

document.getElementById("syncButton").addEventListener("click", async () => {
  const button = document.getElementById("syncButton");
  button.disabled = true;
  button.textContent = "Syncing...";
  const response = await sendRuntimeMessage({ type: "syncNow" });
  await render();
  if (!response?.ok) {
    document.getElementById("syncStatus").textContent =
      "Chrome Sync: could not save. Check your Chrome Sync connection or storage quota.";
  }
  button.disabled = false;
  button.textContent = "Sync now";
});
document.getElementById("refreshStorageUsage").addEventListener("click", refreshStorageUsage);

(() => {
  const ring = document.getElementById("goalProgressRing");
  const tooltip = document.getElementById("chartTooltip");
  function angleForEvent(event) {
    const rect = ring.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(event.clientX - cx, -(event.clientY - cy)) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    return angle;
  }
  const show = (event) => {
    if (!ringSegments.length) return;
    const angle = angleForEvent(event);
    const segment = ringSegments.find((entry) => angle >= entry.start && angle < entry.end) || ringSegments[ringSegments.length - 1];
    if (!segment || segment.start === segment.end) { tooltip.hidden = true; return; }
    const rect = ring.getBoundingClientRect();
    tooltip.innerHTML = '<span class="' + segment.className + '"><i></i>' + escapeHtml(segment.label) + "</span>";
    tooltip.style.left = (rect.left + rect.width / 2) + "px";
    tooltip.style.top = rect.top + "px";
    tooltip.hidden = false;
  };
  ring.addEventListener("mouseenter", show);
  ring.addEventListener("mousemove", show);
  ring.addEventListener("mouseleave", () => { tooltip.hidden = true; });
})();

document.getElementById("seedRandomDataButton").addEventListener("click", async () => {
  const button = document.getElementById("seedRandomDataButton");
  button.disabled = true;
  button.textContent = "Adding random immersion...";
  const response = await sendRuntimeMessage({ type: "seedRandomImmersion" });
  const status = document.getElementById("dataStatus");
  status.textContent = response?.ok
    ? "TEST DATA: added immersion for " + response.seededDays + " days (" + response.seededSessions + " History entries)."
    : "Could not add test data.";
  button.disabled = false;
  button.textContent = "Add random immersion (test data)";
  render();
});

document.getElementById("resetButton").addEventListener("click", async () => {
  if (!confirm("Reset immersion history, the manual timer, and remembered decisions across synced Chrome devices?")) return;
  await sendRuntimeMessage({ type: "resetAllData" });
  themeOverride = null;
  settingsInitialized = false;
  goalsInitialized = false;
  languageInitialized = false;
  manualFieldsInitialized = false;
  render();
});

const hotkeyDescriptions = {
  "toggle-manual-timer": "Start or pause the manual timer",
  "toggle-video-tracking": "Pause or resume automatic video tracking",
  "toggle-status-overlay": "Expand or minimize the video timer",
  "show-hotkeys": "Open this hotkey guide"
};

async function showHotkeys() {
  const commands = await chrome.commands.getAll();
  const list = document.getElementById("hotkeyList");
  list.innerHTML = commands
    .filter((command) => hotkeyDescriptions[command.name])
    .map((command) => '<div class="hotkey-row"><span>' + escapeHtml(hotkeyDescriptions[command.name]) +
      '</span><kbd>' + escapeHtml(command.shortcut || "Unassigned") + '</kbd></div>')
    .join("");
  const dialog = document.getElementById("hotkeysDialog");
  if (!dialog.open) dialog.showModal();
}

document.getElementById("hotkeysButton").addEventListener("click", showHotkeys);
document.getElementById("closeHotkeysButton").addEventListener("click", () => document.getElementById("hotkeysDialog").close());
document.getElementById("manageHotkeysButton").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

async function maybeShowRequestedHotkeys() {
  const fromQuery = new URLSearchParams(location.search).get("hotkeys") === "1";
  const result = await chrome.storage.session.get("jitShowHotkeysRequestedAt");
  const requestedAt = Number(result.jitShowHotkeysRequestedAt) || 0;
  if (requestedAt) await chrome.storage.session.remove("jitShowHotkeysRequestedAt");
  if (fromQuery || Date.now() - requestedAt < 5000) showHotkeys();
}

function updateManualClock() {
  const timer = latestDashboard?.state?.manualTimer;
  if (timer) document.getElementById("manualElapsed").textContent = formatClock(manualElapsed(timer));
}

document.getElementById("previousMonth").addEventListener("click", () => {
  calendarCursor.setMonth(calendarCursor.getMonth() - 1);
  renderCalendar(latestDashboard.state);
});
document.getElementById("nextMonth").addEventListener("click", () => {
  calendarCursor.setMonth(calendarCursor.getMonth() + 1);
  renderCalendar(latestDashboard.state);
});

document.getElementById("historyList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.closest(".history-item")?.dataset.sessionId;
  const session = latestDashboard?.state?.sessions?.[id];
  if (!session) return;
  if (button.dataset.action === "delete") {
    if (!confirm("Delete this session? You can undo the latest deletion.")) return;
    await sendRuntimeMessage({ type: "deleteHistorySession", sessionId: id });
    await render();
    return;
  }
  const totals = sessionTotals(session);
  document.getElementById("editSessionId").value = id;
  document.getElementById("editSessionDate").value = Object.keys(session.byDate || {})[0] || localDateKey();
  document.getElementById("editSessionSource").value = session.site || "other";
  document.getElementById("editSessionTitle").value = session.title || "";
  document.getElementById("editSessionActive").value = Math.round(totals.active / 60);
  document.getElementById("editSessionPassive").value = Math.round(totals.passive / 60);
  document.getElementById("editSessionDialog").showModal();
});
document.getElementById("undoDeleteButton").addEventListener("click", async () => {
  await sendRuntimeMessage({ type: "undoHistoryDelete" });
  await render();
});
document.getElementById("closeEditSession").addEventListener("click", () => document.getElementById("editSessionDialog").close());
document.getElementById("saveEditedSession").addEventListener("click", async () => {
  const response = await sendRuntimeMessage({
    type: "editHistorySession",
    sessionId: document.getElementById("editSessionId").value,
    date: document.getElementById("editSessionDate").value,
    source: document.getElementById("editSessionSource").value,
    title: document.getElementById("editSessionTitle").value,
    activeSeconds: Math.max(0, Number(document.getElementById("editSessionActive").value) || 0) * 60,
    passiveSeconds: Math.max(0, Number(document.getElementById("editSessionPassive").value) || 0) * 60
  });
  if (response?.ok) {
    document.getElementById("editSessionDialog").close();
    await render();
  } else {
    document.getElementById("editSessionStatus").textContent = "Could not edit this session.";
  }
});

function downloadFile(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {
  let text = String(value ?? "");
  // Prevent spreadsheet programs from interpreting imported text as a formula.
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
function formatStorageBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return Math.round(value) + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + " KB";
  return (value / (1024 * 1024)).toFixed(2) + " MB";
}

async function refreshStorageUsage() {
  const status = document.getElementById("storageUsageStatus");
  status.textContent = "Checking...";
  const usage = await sendRuntimeMessage({ type: "getStorageUsage" });
  if (!usage?.ok) {
    status.textContent = "Storage information unavailable";
    return;
  }
  const localLabel = formatStorageBytes(usage.localBytes) + " local" +
    (usage.localUnlimited ? " (unlimited quota)" : " of " + formatStorageBytes(usage.localQuotaBytes));
  const syncLabel = formatStorageBytes(usage.syncBytes) + " of " + formatStorageBytes(usage.syncQuotaBytes) + " Sync";
  status.textContent = localLabel + " • " + syncLabel;
  document.getElementById("storageRetentionStatus").textContent =
    "Daily totals, source breakdowns, and streak dates stay on this device until you reset them. " +
    "Only the latest " + (usage.readableHistoryLimit || 10) + " History entries retain readable titles.";
}
document.getElementById("exportJsonButton").addEventListener("click", async () => {
  const response = await sendRuntimeMessage({ type: "exportData" });
  if (response?.ok) downloadFile("language-immersion-" + localDateKey() + ".json", "application/json", JSON.stringify(response.state, null, 2));
});
document.getElementById("exportCsvButton").addEventListener("click", async () => {
  const response = await sendRuntimeMessage({ type: "exportData" });
  if (!response?.ok) return;
  const rows = [["date","languageCode","languageName","source","activeSeconds","passiveSeconds","activeMinutes","passiveMinutes","title"]];
  Object.entries(response.state.languageRecords || {}).forEach(([code, records]) => {
    Object.entries(records || {}).forEach(([date, record]) => {
      const sites = Object.entries(record.sites || {});
      if (!sites.length && ((Number(record.active) || 0) + (Number(record.passive) || 0) > 0)) rows.push([
        date, code, response.state.preferences.languageNames?.[code] || code.toUpperCase(), "compacted total",
        Number(record.active) || 0, Number(record.passive) || 0,
        (Number(record.active) || 0) / 60, (Number(record.passive) || 0) / 60, ""
      ]);
      sites.forEach(([source, value]) => rows.push([
        date, code, response.state.preferences.languageNames?.[code] || code.toUpperCase(), source,
        Number(value.active) || 0, Number(value.passive) || 0,
        (Number(value.active) || 0) / 60, (Number(value.passive) || 0) / 60, ""
      ]));
    });
  });
  downloadFile("language-immersion-" + localDateKey() + ".csv", "text/csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"));
});
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}
document.getElementById("importFileInput").addEventListener("change", async function() {
  const file = this.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) {
      document.getElementById("dataStatus").textContent = "Import failed: the maximum backup size is 5 MB.";
      return;
    }
    const text = await file.text();
    let response;
    if (file.name.toLowerCase().endsWith(".json")) {
      if (!confirm("Replace local and synced tracker data with this JSON backup?")) return;
      response = await sendRuntimeMessage({ type: "importData", state: JSON.parse(text) });
    } else {
      const rows = parseCsv(text).map((row) => ({
        date: row.date, languageCode: row.languageCode, languageName: row.languageName,
        source: row.source, title: row.title,
        activeSeconds: Number(row.activeSeconds) || Number(row.activeMinutes) * 60,
        passiveSeconds: Number(row.passiveSeconds) || Number(row.passiveMinutes) * 60
      }));
      response = await sendRuntimeMessage({ type: "importCsvRows", rows });
    }
    document.getElementById("dataStatus").textContent = response?.ok
      ? (response.warning || "Import complete" + (response.imported != null ? ": " + response.imported + " rows." : "."))
      : "Import failed.";
    if (response?.ok) themeOverride = null;
    await render();
  } catch {
    document.getElementById("dataStatus").textContent = "Could not read this file.";
  }
  this.value = "";
});

document.getElementById("openDashboardButton").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("store-assets/dashboard.html") });
});

function openGoalSettingsDialog() {
  const general = document.getElementById("generalSettingsDialog");
  if (general.open) general.close();
  document.getElementById("goalSettingsDialog").showModal();
}
document.getElementById("openGoalSettingsFromGeneral").addEventListener("click", openGoalSettingsDialog);
document.getElementById("openGeneralSettings").addEventListener("click", () => {
  document.getElementById("generalSettingsDialog").showModal();
  refreshStorageUsage();
});
document.getElementById("onboardingLanguageSelect").addEventListener("change", updateOnboardingCustomLanguage);
document.getElementById("onboardingChooseLater").addEventListener("click", () => {
  document.getElementById("onboardingLanguageSelect").value = "later";
  updateOnboardingCustomLanguage();
  setOnboardingStep(2);
});
document.getElementById("onboardingBackButton").addEventListener("click", () => setOnboardingStep(onboardingStep - 1));
document.getElementById("onboardingNextButton").addEventListener("click", () => {
  if (onboardingStep < 4) setOnboardingStep(onboardingStep + 1);
  else completeOnboarding();
});
document.getElementById("skipOnboardingButton").addEventListener("click", () => completeOnboarding({ saveSetup: false }));
document.getElementById("replayTutorialButton").addEventListener("click", () => {
  const dialog = document.getElementById("generalSettingsDialog");
  if (dialog.open) dialog.close();
  startTutorial();
});
document.getElementById("openAccountInfo").addEventListener("click", openAccountInfoDialog);
document.getElementById("openAccountInfoFromSettings").addEventListener("click", () => {
  const settings = document.getElementById("generalSettingsDialog");
  if (settings.open) settings.close();
  openAccountInfoDialog();
});
document.getElementById("tutorialBackButton").addEventListener("click", () => {
  tutorialStep = Math.max(0, tutorialStep - 1);
  renderTutorialStep();
});
document.getElementById("tutorialNextButton").addEventListener("click", () => {
  if (tutorialStep >= TUTORIAL_STEPS.length - 1) finishTutorial();
  else { tutorialStep += 1; renderTutorialStep(); }
});
document.getElementById("tutorialSkipButton").addEventListener("click", finishTutorial);
window.addEventListener("resize", positionTutorialCoachmark);
document.querySelector(".file-button").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    document.getElementById("importFileInput").click();
  }
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.getElementById("hotkeysButton").addEventListener("click", () => {
  const general = document.getElementById("generalSettingsDialog");
  if (general.open) general.close();
});

function activatePopupTab(panelId) {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === panelId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.id === panelId;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  chrome.storage.session.set({ litActivePopupTab: panelId }).catch(() => null);
}

document.querySelectorAll("[data-tab-target]").forEach((button) => {
  button.addEventListener("click", () => activatePopupTab(button.dataset.tabTarget));
});

document.querySelectorAll("[data-goal-period]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedGoalPeriod = button.dataset.goalPeriod;
    renderSelectedGoalPeriod();
  });
});

document.getElementById("historyLimit").addEventListener("change", async (event) => {
  const historyLimit = Number(event.target.value) === 10 ? 10 : 5;
  const response = await sendRuntimeMessage({ type: "setUiPreferences", historyLimit });
  if (response?.ok && latestDashboard?.state?.preferences) {
    latestDashboard.state.preferences.historyLimit = historyLimit;
    renderHistory(latestDashboard.state);
  }
});

chrome.storage.session.get("litActivePopupTab").then((result) => {
  if (["trackerPanel", "insightsPanel", "manualPanel"].includes(result.litActivePopupTab)) {
    activatePopupTab(result.litActivePopupTab);
  }
}).catch(() => null);

const customDateInput = document.getElementById("customDate");
customDateInput.value = localDateKey();
customDateInput.max = localDateKey();

render();
maybeShowRequestedHotkeys();
setInterval(updateManualClock, 250);
setInterval(render, 4000);
