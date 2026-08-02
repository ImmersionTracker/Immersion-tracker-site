const extensionApi = typeof chrome !== "undefined" && chrome.runtime?.id;
const dashboardParams = new URLSearchParams(location.search);
const forceDemo = dashboardParams.get("demo") === "1";
const demoTheme = dashboardParams.get("theme") === "light" ? "light" : "dark";
const now = () => extensionApi && !forceDemo ? new Date() : new Date(2026, 7, 28, 18, 42);
let latestDashboard = null;
let latestAccountState = null;
let refreshTimer = null;
let selectedProDays = 30;
let weekOffset = 0;
let calendarCursor = now();
let dailyGoalSegments = [];
let sourceDonutSegments = [];
let activityDonutSegments = [];

function weekReference() {
  return offsetDate(now(), weekOffset * 7);
}

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

function localDateKey(date = now()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function dateFromKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function offsetDate(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weekKeys(reference = now()) {
  const monday = offsetDate(reference, -(reference.getDay() === 0 ? 6 : reference.getDay() - 1));
  return Array.from({ length: 7 }, (_, index) => localDateKey(offsetDate(monday, index)));
}

function recordTotal(record, activeOnly = false) {
  return (Number(record?.active) || 0) + (activeOnly ? 0 : (Number(record?.passive) || 0));
}

function sumRecords(records) {
  return Object.values(records || {}).reduce((total, record) => {
    total.active += Number(record?.active) || 0;
    total.passive += Number(record?.passive) || 0;
    return total;
  }, { active: 0, passive: 0 });
}

function formatDuration(seconds, compact = false) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return compact || !remainder ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${hours}h ${remainder}m`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function sourceLabel(source) {
  const labels = { youtube: "YouTube", netflix: "Netflix", reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking", watching: "Watching", vocab: "Vocabulary", grammar: "Grammar", other: "Other" };
  return labels[String(source || "").toLowerCase()] || String(source || "Other").replace(/(^|[-_])([a-z])/g, (_, space, letter) => `${space ? " " : ""}${letter.toUpperCase()}`);
}

function streakFor(records) {
  let cursor = new Date(now());
  if (!recordTotal(records[localDateKey(cursor)])) cursor = offsetDate(cursor, -1);
  let streak = 0;
  while (recordTotal(records[localDateKey(cursor)])) {
    streak += 1;
    cursor = offsetDate(cursor, -1);
  }
  return streak;
}

function demoDashboard() {
  const base = now();
  const pattern = [[126,52],[101,39],[67,30],[94,43],[54,18],[71,35],[42,28],[84,21],[76,32],[95,15],[62,28],[80,18]];
  const records = {};
  const dailyRecords = {};
  const demoSources = ["youtube", "reading", "listening", "netflix", "vocab"];
  Array.from({ length: 75 }, (_, index) => {
    const [active, passive] = pattern[index % pattern.length];
    const scale = index < 30 ? 1 : .82;
    const dateKey = localDateKey(offsetDate(base, -index));
    records[dateKey] = { active: active * 60 * scale, passive: passive * 60 * scale, sources: {} };
    const source = demoSources[index % demoSources.length];
    const id = `${dateKey}|ja|${source}`;
    dailyRecords[id] = { id, dateKey, languageCode: "ja", source, activeSeconds: active * 60 * scale, passiveSeconds: passive * 60 * scale, sessionCount: 1 + (index % 3), schemaVersion: 1 };
  });
  return { state: {
    records,
    dailyRecords,
    entitlements: { plan: "beta", proEnabled: true, features: { free: true, pro_analytics: true, cloud_sync: false } },
    sourceTotals: { ja: { youtube: { active: 54 * 3600, passive: 18 * 3600 }, reading: { active: 39 * 3600, passive: 0 }, listening: { active: 12 * 3600, passive: 19 * 3600 }, netflix: { active: 18 * 3600, passive: 6 * 3600 }, vocab: { active: 18 * 3600, passive: 0 } } },
    sessions: {
      a: { title: "日本語の一日｜東京Vlog", site: "youtube", languageCode: "ja", lastAt: base.getTime(), byDate: { [localDateKey(base)]: { active: 38 * 60, passive: 0 } } },
      b: { title: "Japanese podcast #84", site: "listening", languageCode: "ja", lastAt: offsetDate(base, -0.2).getTime(), byDate: { [localDateKey(base)]: { active: 0, passive: 52 * 60 } } },
      c: { title: "コンビニ人間 – Chapter 6", site: "reading", languageCode: "ja", lastAt: offsetDate(base, -1).getTime(), byDate: { [localDateKey(offsetDate(base, -1))]: { active: 46 * 60, passive: 0 } } },
      d: { title: "Terrace House – Episode 12", site: "netflix", languageCode: "ja", lastAt: offsetDate(base, -2).getTime(), byDate: { [localDateKey(offsetDate(base, -2))]: { active: 74 * 60, passive: 0 } } },
      e: { title: "Core 2k review", site: "vocab", languageCode: "ja", lastAt: offsetDate(base, -2.3).getTime(), byDate: { [localDateKey(offsetDate(base, -2))]: { active: 24 * 60, passive: 0 } } }
    },
    preferences: { targetLanguage: { code: "ja", name: "Japanese" }, targetLanguageDeferred: false, theme: demoTheme, fullyManualEnabled: false, autoMinimizeEnabled: true, autoMinimizeSeconds: 8, notificationsEnabled: true, goalCountingMode: "both", goals: { daily: { enabled: true, minutes: 120 }, weekly: { enabled: true, minutes: 600 } } }
  }, sync: { lastSyncedAt: base.getTime(), pendingMonths: 0 } };
}

function sendMessage(message) {
  if (!extensionApi) return Promise.resolve(null);
  return new Promise(resolve => chrome.runtime.sendMessage(message, response => resolve(chrome.runtime.lastError ? null : response || null)));
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderStats(state) {
  const records = state.records || {};
  const preferences = state.preferences || {};
  const goals = preferences.goals || {};
  const activeOnly = preferences.goalCountingMode === "active";
  const languageCode = preferences.targetLanguage?.code || "ja";
  const analyticsRecords = Object.entries(records).map(([dateKey, record]) => ({
    dateKey,
    languageCode,
    source: "all",
    activeSeconds: Number(record?.active) || 0,
    passiveSeconds: Number(record?.passive) || 0,
    sessionCount: 0
  }));
  const dailyAnalytics = TrackerAnalytics.dailyTotals(analyticsRecords);
  const todayKey = localDateKey();
  const yesterdayKey = localDateKey(offsetDate(now(), -1));
  const todayValue = dailyAnalytics[todayKey] || {};
  const yesterdayValue = dailyAnalytics[yesterdayKey] || {};
  const today = { active: todayValue.active || 0, passive: todayValue.passive || 0 };
  const yesterday = { active: yesterdayValue.active || 0, passive: yesterdayValue.passive || 0 };
  const todayTotal = recordTotal(today);
  const difference = Math.round((todayTotal - recordTotal(yesterday)) / 60);
  const keys = weekKeys(weekReference());
  const week = keys.reduce((sum, key) => sum + recordTotal(records[key]), 0);
  const currentWeekKeys = weekKeys();
  const currentWeek = weekOffset === 0 ? week : currentWeekKeys.reduce((sum, key) => sum + recordTotal(records[key]), 0);
  const weekGoalMinutes = Number(goals.weekly?.minutes) || 900;
  const totals = TrackerAnalytics.totals(analyticsRecords);
  const total = totals.active + totals.passive;
  const streak = TrackerAnalytics.currentStreak(analyticsRecords, now());

  setText("todayMetric", formatDuration(todayTotal));
  setText("todayComparison", todayTotal === 0 ? "Start with one focused session" : difference === 0 ? "Same as yesterday" : `${difference > 0 ? "↑" : "↓"} ${Math.abs(difference)} min from yesterday`);
  document.getElementById("todayComparison").classList.toggle("up", difference > 0);
  setText("weekMetricLabel", weekOffset === 0 ? "This week" : "Selected week");
  setText("weekMetric", formatDuration(week));
  setText("weekGoalCaption", weekOffset === 0 ? `of ${formatDuration(weekGoalMinutes * 60)} weekly goal` : "goal tracking applies to the current week only");
  document.querySelector(".goal-mini strong").textContent = formatDuration(currentWeek);
  document.querySelector(".goal-mini i").style.width = `${Math.min(100, currentWeek / (weekGoalMinutes * 60) * 100)}%`;
  document.querySelector(".goal-mini span").textContent = `${Math.round(currentWeek / (weekGoalMinutes * 60) * 100)}% of weekly goal`;
  setText("streakMetric", `${streak} ${streak === 1 ? "day" : "days"}`);
  setText("streakCaption", streak ? "Keep the momentum going" : "Start immersing today");
  setText("activeRatioMetric", `${total ? Math.round(totals.active / total * 100) : 0}%`);
  setText("activeRatioCaption", `${formatDuration(totals.active)} focused`);

  const dailyGoalMinutes = Number(goals.daily?.minutes) || 360;
  const goalSeconds = dailyGoalMinutes * 60;
  const counted = recordTotal(today, activeOnly);
  const percent = Math.min(100, Math.round(counted / goalSeconds * 100));
  const activeAngle = Math.min(360, (Number(today.active) || 0) / goalSeconds * 360);
  const passiveAngle = Math.min(360, activeAngle + (activeOnly ? 0 : (Number(today.passive) || 0) / goalSeconds * 360));
  setText("dailyGoalTitle", `${Math.round(counted / 60)} of ${dailyGoalMinutes} minutes`);
  setText("dailyGoalPercent", `${percent}%`);
  setText("dailyActive", formatDuration(today.active));
  setText("dailyPassive", formatDuration(today.passive));
  setText("dailyGoalRemaining", counted >= goalSeconds ? "Daily goal complete — excellent work" : `${Math.ceil((goalSeconds - counted) / 60)} minutes to reach today’s goal`);
  document.getElementById("dailyGoalDonut").style.background = `conic-gradient(var(--green) 0 ${activeAngle}deg,var(--orange) ${activeAngle}deg ${passiveAngle}deg,#27364e ${passiveAngle}deg)`;
  dailyGoalSegments = [
    { start: 0, end: activeAngle, color: "var(--green)", label: "Active " + formatDuration(today.active) },
    { start: activeAngle, end: passiveAngle, color: "var(--orange)", label: "Passive " + formatDuration(today.passive) },
    { start: passiveAngle, end: 360, color: "var(--muted)", label: counted >= goalSeconds ? "Goal complete" : "Remaining " + formatDuration(Math.max(0, goalSeconds - counted)) }
  ];

  setText("chartMax", formatDuration(dailyGoalMinutes * 60));
  setText("chartMid", formatDuration(dailyGoalMinutes * 30));
  const weeklyBars = document.getElementById("bars");
  const weeklyChart = weeklyBars.closest(".chart");
  const weekIsEmpty = week === 0;
  weeklyBars.classList.toggle("is-empty", weekIsEmpty);
  weeklyChart?.classList.toggle("is-empty", weekIsEmpty);
  weeklyChart?.setAttribute("aria-label", weekIsEmpty
    ? "No weekly immersion recorded yet"
    : `Active and passive immersion for the ${weekOffset === 0 ? "current" : "selected"} week`);
  const weeklyBarMarkup = keys.map((key, index) => {
    const record = records[key] || {};
    const active = Number(record.active) || 0;
    const passive = Number(record.passive) || 0;
    const combined = active + passive;
    const height = Math.min(190, combined / goalSeconds * 180);
    const activeShare = combined ? active / combined * 100 : 0;
    const passiveShare = combined ? passive / combined * 100 : 0;
    return `<div class="bar-day"><b>${formatDuration(combined)}</b><div class="bar-stack" title="Active ${formatDuration(active)}, passive ${formatDuration(passive)}" style="height:${height}px"><i class="a" style="height:${activeShare}%"></i><i class="p" style="height:${passiveShare}%"></i></div><span>${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][index]}</span></div>`;
  }).join("");
  weeklyBars.innerHTML = weeklyBarMarkup + (week === 0
    ? '<div class="chart-empty-state" role="status"><span>Your week starts with one focused session</span></div>'
    : "");
  renderCalendar(records, dailyGoalMinutes, weekGoalMinutes, activeOnly, streak);
}

function renderCalendar(records, dailyGoalMinutes, weeklyGoalMinutes, activeOnly, streak) {
  const reference = calendarCursor;
  const current = now();
  setText("calendarMonth", reference.toLocaleDateString([], { month: "long", year: "numeric" }));
  setText("calendarStreak", `${streak} day streak${streak ? " 🔥" : ""}`);
  const nextMonthButton = document.getElementById("calendarNextMonth");
  if (nextMonthButton) {
    nextMonthButton.disabled = reference.getFullYear() === current.getFullYear() && reference.getMonth() === current.getMonth();
  }
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const offset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const daysInMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  document.getElementById("days").innerHTML = Array.from({ length: cellCount }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > daysInMonth) return "<div></div>";
    const date = new Date(reference.getFullYear(), reference.getMonth(), day);
    const key = localDateKey(date);
    const recordedTotal = recordTotal(records[key]);
    const countedTotal = recordTotal(records[key], activeOnly);
    const dailyGoalSeconds = Math.max(60, dailyGoalMinutes * 60);
    const intensity = recordedTotal <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(recordedTotal / dailyGoalSeconds * 4)));
    const mondayOffset = date.getDay() === 0 ? -6 : 1 - date.getDay();
    const monday = offsetDate(date, mondayOffset);
    const weekTotal = Array.from({ length: 7 }, (_, weekIndex) =>
      recordTotal(records[localDateKey(offsetDate(monday, weekIndex))], activeOnly)
    ).reduce((sum, seconds) => sum + seconds, 0);
    const goalHit = countedTotal >= dailyGoalSeconds;
    const weekHit = weekTotal >= Math.max(60, weeklyGoalMinutes * 60);
    const isToday = key === localDateKey();
    const classes = [
      intensity ? `level-${intensity}` : "",
      recordedTotal ? "has-time" : "",
      goalHit ? "daily-complete" : "",
      weekHit ? "week-complete" : "",
      isToday ? "today" : ""
    ].filter(Boolean).join(" ");
    const dateLabel = date.toLocaleDateString([], { month: "long", day: "numeric" });
    const detailParts = [recordedTotal ? formatDuration(recordedTotal) : "No immersion"];
    if (goalHit) detailParts.push("daily goal met");
    if (weekHit) detailParts.push("weekly goal met");
    if (isToday) detailParts.push("today");
    const detailLabel = detailParts.join(", ");
    return `<div class="${classes}" data-date="${escapeHtml(dateLabel)}" data-detail="${escapeHtml(detailLabel)}" aria-label="${escapeHtml(dateLabel + ": " + detailLabel)}">${day}</div>`;
  }).join("");
}

function renderHistory(state) {
  const code = state.preferences?.targetLanguage?.code || "ja";
  const sources = Object.entries(state.sourceTotals?.[code] || {}).map(([name, record]) => [name, recordTotal(record)]).sort((a, b) => b[1] - a[1]);
  const allTime = sources.reduce((sum, [, seconds]) => sum + seconds, 0) || recordTotal(sumRecords(state.records));
  setText("allTimeTotal", `${formatDuration(allTime)} total`);
  setText("activityTotal", formatDuration(allTime));
  const sourcePalette = ["var(--green)", "var(--blue)", "var(--purple)", "var(--orange)", "var(--cyan)"];
  const visibleSources = sources.slice(0, 5);
  const sourceStops = [];
  let sourceCursor = 0;
  sourceDonutSegments = [];
  visibleSources.forEach(([name, seconds], index) => {
    const share = allTime ? seconds / allTime * 100 : 0;
    const end = sourceCursor + share;
    sourceStops.push(`${sourcePalette[index]} ${sourceCursor.toFixed(2)}% ${end.toFixed(2)}%`);
    sourceDonutSegments.push({ start: sourceCursor / 100 * 360, end: end / 100 * 360, color: sourcePalette[index], label: `${sourceLabel(name)} — ${Math.round(share)}%` });
    sourceCursor = end;
  });
  if (sourceCursor < 100) {
    sourceStops.push(`var(--surface-3) ${sourceCursor.toFixed(2)}% 100%`);
    sourceDonutSegments.push({ start: sourceCursor / 100 * 360, end: 360, color: "var(--surface-3)", label: "Other sources" });
  }
  document.getElementById("sourceDonut").style.background = `conic-gradient(${sourceStops.length ? sourceStops.join(",") : "var(--surface-3) 0 100%"})`;
  setText("topSourceName", visibleSources.length ? sourceLabel(visibleSources[0][0]) : "No data");
  setText("topSourceTime", visibleSources.length ? formatDuration(visibleSources[0][1]) : "0m");
  document.getElementById("sources").innerHTML = visibleSources.length ? visibleSources.map(([name, seconds], index) => {
    const percent = allTime ? Math.round(seconds / allTime * 100) : 0;
    return `<div class="source-item"><i style="background:${sourcePalette[index]}"></i><span>${escapeHtml(sourceLabel(name))}<small>${percent}%</small></span><b>${formatDuration(seconds)}</b></div>`;
  }).join("") : '<div class="empty-state invitation"><b>Your source mix starts here</b><span>Play a supported video or record a manual session.</span></div>';

  const grouped = { Watching: 0, Listening: 0, Reading: 0, Other: 0 };
  sources.forEach(([name, seconds]) => {
    const normalized = String(name).toLowerCase();
    if (["youtube","netflix","watching","crunchyroll","disneyplus","primevideo","hulu","max"].includes(normalized)) grouped.Watching += seconds;
    else if (normalized === "listening") grouped.Listening += seconds;
    else if (normalized === "reading") grouped.Reading += seconds;
    else grouped.Other += seconds;
  });
  const colors = { Watching: "green", Listening: "blue", Reading: "purple", Other: "orange" };
  const percentages = Object.fromEntries(Object.entries(grouped).map(([name, seconds]) => [name, allTime ? Math.round(seconds / allTime * 100) : 0]));
  document.getElementById("activityMix").innerHTML = Object.entries(percentages).map(([name, percent]) => `<li><i class="${colors[name]}"></i>${name}<b>${percent}%</b></li>`).join("");
  const stops = [percentages.Watching, percentages.Watching + percentages.Listening, percentages.Watching + percentages.Listening + percentages.Reading];
  document.getElementById("activityDonut").style.background = `conic-gradient(var(--green) 0 ${stops[0]}%,var(--blue) ${stops[0]}% ${stops[1]}%,var(--purple) ${stops[1]}% ${stops[2]}%,var(--orange) ${stops[2]}% 100%)`;
  const activityBoundaries = [0, stops[0], stops[1], stops[2], 100];
  activityDonutSegments = ["Watching", "Listening", "Reading", "Other"].map((name, index) => ({
    start: activityBoundaries[index] / 100 * 360,
    end: activityBoundaries[index + 1] / 100 * 360,
    color: `var(--${colors[name]})`,
    label: `${name} — ${percentages[name]}%`
  }));

  const sessions = Object.values(state.sessions || {}).filter(session => (session.languageCode || "ja") === code).sort((a, b) => (Number(b.lastAt) || 0) - (Number(a.lastAt) || 0)).slice(0, 5);
  document.getElementById("sessions").innerHTML = sessions.length ? sessions.map(session => {
    const totals = sumRecords(session.byDate || {});
    const active = totals.active;
    const passive = totals.passive;
    const type = active >= passive ? "Active" : "Passive";
    const date = Object.keys(session.byDate || {})[0] || localDateKey(new Date(session.lastAt || Date.now()));
    return `<tr><td class="activity-title" title="${escapeHtml(session.title || sourceLabel(session.site))}">${escapeHtml(session.title || sourceLabel(session.site))}</td><td>${escapeHtml(sourceLabel(session.site))}</td><td class="utility-text">${escapeHtml(date)}</td><td><span class="type">${type}</span></td><td class="utility-text">${formatDuration(active + passive)}</td></tr>`;
  }).join("") : '<tr class="empty-row"><td colspan="5"><div class="empty-state invitation"><b>Your session log is ready</b><span>Completed immersion will appear here.</span></div></td></tr>';
}

function canonicalRecordsForState(state, languageCode) {
  const canonical = Object.values(state.dailyRecords || {});
  if (canonical.length) return canonical;
  return Object.entries(state.records || {}).map(([dateKey, record]) => ({
    id: `${dateKey}|${languageCode}|other`,
    dateKey,
    languageCode,
    source: "other",
    activeSeconds: Number(record?.active) || 0,
    passiveSeconds: Number(record?.passive) || 0,
    sessionCount: 0
  }));
}

function comparisonText(current, previous, noun = "from previous period") {
  const change = TrackerAnalytics.percentChange(current, previous);
  if (!current && !previous) return { text: "No data in either period", className: "" };
  if (!previous) return { text: "New activity vs previous period", className: "up" };
  if (!change) return { text: `No change ${noun}`, className: "" };
  return { text: `${change > 0 ? "↑" : "↓"} ${Math.abs(change)}% ${noun}`, className: change > 0 ? "up" : "down" };
}

function setComparison(id, current, previous, noun) {
  const element = document.getElementById(id);
  const comparison = comparisonText(current, previous, noun);
  element.textContent = comparison.text;
  element.classList.toggle("up", comparison.className === "up");
  element.classList.toggle("down", comparison.className === "down");
}

function svgPath(values, key, width, height, maximum) {
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index / (values.length - 1) * width;
    const y = height - ((Number(value[key]) || 0) / maximum * (height - 20)) - 10;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function trendRangeLabel(value) {
  const start = dateFromKey(value.startKey).toLocaleDateString([], { month: "short", day: "numeric" });
  if (value.startKey === value.endKey) return start;
  const end = dateFromKey(value.endKey).toLocaleDateString([], { month: "short", day: "numeric" });
  return `${start} – ${end}`;
}

function showChartTooltip(anchorRect, html) {
  const tooltip = document.getElementById("chartTooltip");
  if (!tooltip) return;
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  tooltip.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
  tooltip.style.top = `${anchorRect.top}px`;
}

function hideChartTooltip() {
  const tooltip = document.getElementById("chartTooltip");
  if (tooltip) tooltip.hidden = true;
}

function angleForPointerEvent(event, element) {
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let angle = Math.atan2(event.clientX - cx, -(event.clientY - cy)) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

function wireSegmentDonut(elementId, getSegments) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const show = (event) => {
    const segments = getSegments();
    if (!segments || !segments.length) { hideChartTooltip(); return; }
    const angle = angleForPointerEvent(event, element);
    const segment = segments.find((entry) => angle >= entry.start && angle < entry.end) || segments[segments.length - 1];
    if (!segment || segment.start === segment.end) { hideChartTooltip(); return; }
    showChartTooltip(element.getBoundingClientRect(), `<span><i style="background:${segment.color}"></i>${escapeHtml(segment.label)}</span>`);
  };
  element.addEventListener("mouseenter", show);
  element.addEventListener("mousemove", show);
  element.addEventListener("mouseleave", hideChartTooltip);
}

function renderProTrend(analysis) {
  const svg = document.getElementById("proTrendChart");
  const axis = document.getElementById("proTrendAxis");
  const yAxis = document.getElementById("proTrendYAxis");
  const markerLayer = document.getElementById("proTrendMarkers");
  const values = analysis.trend;
  const width = 640;
  const height = 160;
  const maximum = Math.max(1, ...values.flatMap(value => [value.active, value.passive]));
  const activePath = svgPath(values, "active", width, height, maximum);
  const passivePath = svgPath(values, "passive", width, height, maximum);
  const labelCount = Math.min(5, values.length);
  const labelIndexes = values.length ? [...new Set(Array.from({ length: labelCount }, (_, index) =>
    Math.round(index / Math.max(1, labelCount - 1) * (values.length - 1))
  ))] : [];

  const points = values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : index / (values.length - 1) * width,
    activeY: height - ((Number(value.active) || 0) / maximum * (height - 20)) - 10,
    passiveY: height - ((Number(value.passive) || 0) / maximum * (height - 20)) - 10,
    value
  }));
  const bucketWidth = values.length > 1 ? width / values.length : width;
  const hoverZones = points.map((point, index) => {
    const bucketStart = values.length > 1 ? Math.max(0, point.x - bucketWidth / 2) : 0;
    return `<rect class="pro-trend-hover" data-index="${index}" x="${bucketStart.toFixed(1)}" y="0" width="${bucketWidth.toFixed(1)}" height="${height}" fill="transparent"></rect>`;
  }).join("");

  const yTicks = [1, 0.667, 0.333, 0].map((fraction) => ({
    fraction,
    y: height - fraction * (height - 20) - 10,
    seconds: fraction * maximum
  }));

  svg.innerHTML = `<defs><linearGradient id="activeFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#43dc80" stop-opacity=".23"/><stop offset="1" stop-color="#43dc80" stop-opacity="0"/></linearGradient><linearGradient id="passiveFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5a623" stop-opacity=".15"/><stop offset="1" stop-color="#f5a623" stop-opacity="0"/></linearGradient></defs>${yTicks.map(tick => `<line class="pro-gridline" x1="0" x2="640" y1="${tick.y.toFixed(1)}" y2="${tick.y.toFixed(1)}"/>`).join("")}${values.length ? `<path class="pro-area-active" d="${activePath} L640,160 L0,160 Z"/><path class="pro-area-passive" d="${passivePath} L640,160 L0,160 Z"/><path class="pro-line-active" d="${activePath}"/><path class="pro-line-passive" d="${passivePath}"/><line id="proTrendHoverLine" class="pro-trend-hover-line" x1="0" x2="0" y1="0" y2="${height}" hidden></line>${hoverZones}` : ""}`;

  yAxis.innerHTML = yTicks.map(tick => `<span style="top:${(tick.y / height * 100).toFixed(2)}%">${escapeHtml(formatDuration(tick.seconds, true))}</span>`).join("");

  markerLayer.innerHTML = values.length ? points.map(point =>
    `<i class="pro-trend-marker pro-marker-active" style="left:${(point.x / width * 100).toFixed(2)}%;top:${(point.activeY / height * 100).toFixed(2)}%"></i><i class="pro-trend-marker pro-marker-passive" style="left:${(point.x / width * 100).toFixed(2)}%;top:${(point.passiveY / height * 100).toFixed(2)}%"></i>`
  ).join("") : "";

  axis.style.setProperty("--trend-label-count", String(Math.max(labelIndexes.length, 1)));
  axis.innerHTML = labelIndexes.map((valueIndex, labelIndex) => {
    const value = values[valueIndex];
    const label = labelIndex === labelIndexes.length - 1 ? value.endKey.slice(5) : value.startKey.slice(5);
    return `<span>${escapeHtml(label)}</span>`;
  }).join("");

  if (!values.length) { hideChartTooltip(); return; }
  const hoverLine = document.getElementById("proTrendHoverLine");
  const showPoint = (point) => {
    const svgBox = svg.getBoundingClientRect();
    const scaleX = svgBox.width / width;
    hoverLine.hidden = false;
    hoverLine.setAttribute("x1", point.x.toFixed(1));
    hoverLine.setAttribute("x2", point.x.toFixed(1));
    const anchor = { left: svgBox.left + point.x * scaleX, top: svgBox.top, width: 0 };
    showChartTooltip(anchor, `<b>${escapeHtml(trendRangeLabel(point.value))}</b><span class="active"><i></i>Active ${escapeHtml(formatDuration(point.value.active))}</span><span class="passive"><i></i>Passive ${escapeHtml(formatDuration(point.value.passive))}</span>`);
  };
  svg.querySelectorAll(".pro-trend-hover").forEach((zone) => {
    const point = points[Number(zone.dataset.index)];
    zone.addEventListener("mouseenter", () => showPoint(point));
    zone.addEventListener("mousemove", () => showPoint(point));
    zone.addEventListener("mouseleave", () => { hideChartTooltip(); hoverLine.hidden = true; });
  });
}

function openSourceDrawer(source, state) {
  const drawer = document.getElementById("proSourceDrawer");
  const languageCode = state.preferences?.targetLanguage?.code || "ja";
  const sessions = Object.values(state.sessions || {})
    .filter(session => (session.languageCode || "ja") === languageCode && String(session.site || "other").toLowerCase() === String(source).toLowerCase())
    .sort((a, b) => (Number(b.lastAt) || 0) - (Number(a.lastAt) || 0));
  setText("proDrawerTitle", `${sourceLabel(source)} activity`);
  setText("proDrawerNote", sessions.length ? "Recent related sessions saved on this device." : "Daily totals exist, but no readable recent session is retained for this source.");
  document.getElementById("proDrawerSessions").innerHTML = sessions.length ? sessions.map(session => {
    const totals = sumRecords(session.byDate || {});
    const date = Object.keys(session.byDate || {}).sort().at(-1) || localDateKey(new Date(session.lastAt || Date.now()));
    return `<li>${escapeHtml(session.title || sourceLabel(session.site))}<span>${escapeHtml(date)} · ${formatDuration(totals.active + totals.passive)} · ${totals.active >= totals.passive ? "Active" : "Passive"}</span></li>`;
  }).join("") : "<li>No readable recent sessions.</li>";
  drawer.hidden = false;
}

function renderProAnalytics(state) {
  const entitled = TrackerEntitlements.has(state.entitlements, "pro_analytics");
  document.getElementById("proGate").hidden = entitled;
  document.getElementById("proContent").hidden = !entitled;
  if (!entitled) return;

  const languageCode = state.preferences?.targetLanguage?.code || "ja";
  const records = canonicalRecordsForState(state, languageCode);
  const dailyGoalMinutes = Number(state.preferences?.goals?.daily?.minutes) || 360;
  const weeklyGoalMinutes = Number(state.preferences?.goals?.weekly?.minutes) || 900;
  const analysis = TrackerAnalytics.analyzePeriod(records, { languageCode, days: selectedProDays, reference: now(), dailyGoalMinutes });
  const previousStreak = TrackerAnalytics.currentStreak(
    TrackerAnalytics.filter(records, { languageCode, startKey: analysis.range.previousStartKey, endKey: analysis.range.previousEndKey }),
    TrackerAnalytics.parseDateKey(analysis.range.previousEndKey)
  );
  setText("proPeriodLabel", selectedProDays === 365 ? "Last year" : `Last ${selectedProDays} days`);
  setText("proTotal", formatDuration(analysis.current.total));
  setText("proAverage", formatDuration(analysis.dailyAverage));
  setText("proActive", formatDuration(analysis.current.active));
  setText("proPassive", formatDuration(analysis.current.passive));
  setText("proStreak", `${analysis.streak} ${analysis.streak === 1 ? "day" : "days"}`);
  setComparison("proTotalCompare", analysis.current.total, analysis.previous.total);
  setComparison("proAverageCompare", analysis.dailyAverage, analysis.previousDailyAverage);
  setComparison("proStreakCompare", analysis.streak, previousStreak, "vs previous period end");
  const activeComparison = comparisonText(analysis.current.active, analysis.previous.active);
  setText("proSplitCompare", `${Math.round(analysis.activeRatio * 100)}% active · ${activeComparison.text}`);

  renderProTrend(analysis);
  const sources = Object.entries(analysis.sources).sort((a, b) => b[1].total - a[1].total);
  const maxSource = sources[0]?.[1].total || 1;
  setText("proSourceTotal", formatDuration(analysis.current.total));
  const sourceRows = document.getElementById("proSourceRows");
  sourceRows.innerHTML = sources.length ? sources.slice(0, 3).map(([source, values]) => `<button class="pro-source-row" data-source="${escapeHtml(source)}"><span>${escapeHtml(sourceLabel(source))}</span><span class="pro-source-track"><i style="width:${values.total / maxSource * 100}%"></i></span><b>${formatDuration(values.total)}</b><small>${formatDuration(values.active)} active · ${formatDuration(values.passive)} passive · ${values.sessions} sessions</small></button>`).join("") : '<div class="pro-empty"><b>Record a few sessions</b><span>Your source comparison will build itself.</span></div>';
  sourceRows.querySelectorAll("[data-source]").forEach(row => row.addEventListener("click", () => openSourceDrawer(row.dataset.source, state)));

  const selectedRecords = TrackerAnalytics.filter(records, { languageCode, startKey: analysis.range.startKey, endKey: analysis.range.endKey });
  const consistency = TrackerAnalytics.weeklyConsistency(selectedRecords, weeklyGoalMinutes);
  const weeks = Object.entries(consistency.weeks).sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  const maxWeek = Math.max(consistency.goalSeconds, ...weeks.map(([, week]) => week.total), 1);
  setText("proGoalRate", `${Math.round(consistency.rate * 100)}% hit rate`);
  const weekBars = document.getElementById("proWeekBars");
  weekBars.className = "pro-week-bars";
  weekBars.style.setProperty("--week-count", String(Math.max(weeks.length, 1)));
  weekBars.innerHTML = weeks.length ? weeks.map(([key, week]) => `<div class="pro-week ${week.total >= consistency.goalSeconds ? "hit" : ""}" title="${key}: ${formatDuration(week.total)}"><i style="height:${Math.max(2, week.total / maxWeek * 100)}%"></i><span>${key.slice(5)}</span></div>`).join("") : '<div class="pro-empty"><b>Your first week is waiting</b><span>Consistency appears after you start immersing.</span></div>';

  const highlights = analysis.highlights;
  const allTimeHighlights = TrackerAnalytics.highlights(TrackerAnalytics.filter(records, { languageCode }));
  const highlightItems = [
    ["Best day", highlights.bestDay ? formatDuration(highlights.bestDay[1].total) : "—", highlights.bestDay?.[0] || "No record yet"],
    ["Best week", highlights.bestWeek ? formatDuration(highlights.bestWeek[1].total) : "—", highlights.bestWeek ? `Week of ${highlights.bestWeek[0]}` : "No record yet"],
    ["Most-used source", highlights.topSource ? sourceLabel(highlights.topSource[0]) : "—", highlights.topSource ? formatDuration(highlights.topSource[1].total) : "No record yet"],
    ["Personal record", `${allTimeHighlights.longestStreak || 0} day streak`, `${analysis.current.sessions} sessions in period`]
  ];
  document.getElementById("proHighlights").innerHTML = highlightItems.map(([label, value, detail]) => `<div class="highlight"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join("");
}

function ensureLanguageOption(target) {
  const select = document.getElementById("dashboardLanguage");
  if (![...select.options].some(option => option.value === target.code)) select.add(new Option(target.name, target.code));
  select.value = target.code;
}

function renderSettings(dashboard) {
  const preferences = dashboard.state.preferences || {};
  const goals = preferences.goals || {};
  document.documentElement.dataset.theme = preferences.theme === "light" ? "light" : "dark";
  document.getElementById("automaticDetection").checked = preferences.fullyManualEnabled !== true;
  document.getElementById("autoMinimize").checked = preferences.autoMinimizeEnabled !== false;
  const delaySelect = document.getElementById("autoMinimizeSeconds");
  const delay = String(preferences.autoMinimizeSeconds || 5);
  if (![...delaySelect.options].some(option => option.value === delay)) delaySelect.add(new Option(`${delay} seconds`, delay));
  delaySelect.value = delay;
  document.getElementById("dailyGoalInput").value = goals.daily?.minutes || 360;
  document.getElementById("weeklyGoalInput").value = goals.weekly?.minutes || 900;
  document.getElementById("goalCountingMode").value = preferences.goalCountingMode === "active" ? "active" : "both";
  document.getElementById("goalNotifications").checked = preferences.notificationsEnabled !== false;
  ensureLanguageOption(preferences.targetLanguage || { code: "ja", name: "Japanese" });
  document.getElementById("dashboardDarkTheme").classList.toggle("selected", preferences.theme !== "light");
  document.getElementById("dashboardLightTheme").classList.toggle("selected", preferences.theme === "light");
  setText("dashboardPlanStatus", TrackerEntitlements.has(dashboard.state.entitlements, "pro_analytics")
    ? "Beta access · Pro Analytics unlocked"
    : "Free plan · Overview analytics");
  setText("dashboardSyncStatus", dashboard.sync?.pendingMonths ? `${dashboard.sync.pendingMonths} updates pending` : dashboard.sync?.lastSyncedAt ? `Last synced ${new Date(dashboard.sync.lastSyncedAt).toLocaleString()}` : "Waiting for the first recorded session");
}

function renderDashboard(dashboard) {
  latestDashboard = dashboard;
  const state = dashboard.state || {};
  const target = state.preferences?.targetLanguage || { code: "ja", name: "Japanese" };
  document.querySelector(".profile span").childNodes[0].nodeValue = target.name;
  document.querySelector(".profile>b").textContent = target.code.toUpperCase().slice(0, 2);
  setText("dashboardProfileMeta", state.preferences?.targetLanguageDeferred === true || target.code === "und"
    ? "Choose a target language"
    : latestAccountState?.account?.connected
      ? (latestAccountState.email || "Signed in")
      : "Local beta profile");
  const keys = weekKeys(weekReference());
  const start = dateFromKey(keys[0]);
  const end = dateFromKey(keys[6]);
  const rangeLabel = `${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  const dateRangeButton = document.getElementById("dateRangeButton");
  if (dateRangeButton) {
    dateRangeButton.textContent = rangeLabel;
    dateRangeButton.title = weekOffset === 0 ? "This week" : "Jump back to this week";
  }
  const nextWeekButton = document.getElementById("nextWeekButton");
  if (nextWeekButton) nextWeekButton.disabled = weekOffset >= 0;
  renderStats(state);
  renderHistory(state);
  renderProAnalytics(state);
  renderSettings(dashboard);
}

async function refreshDashboard() {
  const dashboard = extensionApi && !forceDemo ? await sendMessage({ type: "getDashboard" }) : demoDashboard();
  if (dashboard) renderDashboard(dashboard);
  else setStatus("Could not read tracker data.", true);
}

function renderAccountCard() {
  const summary = document.getElementById("dashboardAccountSummary");
  const status = document.getElementById("dashboardAccountStatus");
  const signOutButton = document.getElementById("dashboardSignOutButton");
  const deleteButton = document.getElementById("dashboardDeleteAccountButton");
  const signedIn = Boolean(latestAccountState?.account?.connected);
  if (summary) {
    summary.textContent = signedIn
      ? "Cloud sync account connected. Manage sign-in from the extension popup's Account & plan panel."
      : "Optional login, 3-month free cloud-sync trial. Sign in from the extension popup's Account & plan panel.";
  }
  if (status) {
    status.textContent = !latestAccountState
      ? ""
      : signedIn
        ? `Signed in as ${latestAccountState.email || "your account"}`
        : latestAccountState.account?.status === "expired"
          ? "Your session expired - sign in again from the popup."
          : "Not signed in.";
  }
  if (signOutButton) signOutButton.hidden = !signedIn;
  if (deleteButton) deleteButton.hidden = !signedIn;
}

async function refreshAccountState() {
  const response = extensionApi && !forceDemo ? await sendMessage({ type: "getAccountState" }) : null;
  latestAccountState = response?.ok ? response : { ok: false, cloudReady: false, email: "", account: { status: "guest", connected: false } };
  renderAccountCard();
  // Profile-meta text (header + account card heading) depends on account
  // state too - re-render against the last-known dashboard snapshot rather
  // than duplicating that branch here.
  if (latestDashboard) renderDashboard(latestDashboard);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshDashboard, 150);
}

function setStatus(message, isError = false) {
  const status = document.getElementById("dashboardStatus");
  status.textContent = message;
  status.classList.toggle("error", isError);
  if (message) setTimeout(() => { if (status.textContent === message) status.textContent = ""; }, 3500);
}

async function savePreferences(preferences, success) {
  if (!extensionApi) { setStatus("Demo mode: install or reload the extension to save settings.", true); return; }
  const response = await sendMessage({ type: "setPreferences", preferences });
  setStatus(response?.ok ? success : "Could not save this setting.", !response?.ok);
  if (response?.ok) await refreshDashboard();
}

function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const meta = { stats: ["OVERVIEW","Your immersion at a glance"], history: ["HISTORY & ANALYTICS","See how your immersion adds up"], pro: ["PRO ANALYTICS","Understand your immersion patterns"], settings: ["SETTINGS","Tune your tracking experience"] };
function selectView(name) {
  if (!meta[name]) name = "stats";
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === name));
  document.querySelectorAll("nav button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  setText("eyebrow", meta[name][0]); setText("title", meta[name][1]);
  const weekNav = document.querySelector(".week-nav");
  if (weekNav) weekNav.hidden = name !== "stats";
  history.replaceState(null, "", `?view=${name}`);
}

wireSegmentDonut("dailyGoalDonut", () => dailyGoalSegments);
wireSegmentDonut("sourceDonut", () => sourceDonutSegments);
wireSegmentDonut("activityDonut", () => activityDonutSegments);

document.getElementById("calendarPrevMonth")?.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  if (latestDashboard) renderDashboard(latestDashboard);
});
document.getElementById("calendarNextMonth")?.addEventListener("click", () => {
  const candidate = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  const currentMonthStart = new Date(now().getFullYear(), now().getMonth(), 1);
  if (candidate > currentMonthStart) return;
  calendarCursor = candidate;
  if (latestDashboard) renderDashboard(latestDashboard);
});

(() => {
  const daysContainer = document.getElementById("days");
  if (!daysContainer) return;
  daysContainer.addEventListener("mouseover", (event) => {
    const cell = event.target.closest("[data-date]");
    if (!cell || !daysContainer.contains(cell)) return;
    showChartTooltip(cell.getBoundingClientRect(), `<b>${escapeHtml(cell.dataset.date)}</b><span>${escapeHtml(cell.dataset.detail)}</span>`);
  });
  daysContainer.addEventListener("mouseout", (event) => {
    if (!event.relatedTarget || !daysContainer.contains(event.relatedTarget)) hideChartTooltip();
  });
})();

document.getElementById("prevWeekButton")?.addEventListener("click", () => {
  weekOffset -= 1;
  if (latestDashboard) renderDashboard(latestDashboard);
});
document.getElementById("nextWeekButton")?.addEventListener("click", () => {
  weekOffset = Math.min(0, weekOffset + 1);
  if (latestDashboard) renderDashboard(latestDashboard);
});
document.getElementById("dateRangeButton")?.addEventListener("click", () => {
  weekOffset = 0;
  if (latestDashboard) renderDashboard(latestDashboard);
});
document.querySelectorAll("nav button").forEach(button => button.addEventListener("click", () => selectView(button.dataset.view)));
document.querySelectorAll(".period-switch [data-days]").forEach(button => button.addEventListener("click", () => {
  selectedProDays = Number(button.dataset.days) || 30;
  document.querySelectorAll(".period-switch [data-days]").forEach(candidate => candidate.classList.toggle("active", candidate === button));
  if (latestDashboard?.state) renderProAnalytics(latestDashboard.state);
}));
document.getElementById("proDrawerClose").addEventListener("click", () => { document.getElementById("proSourceDrawer").hidden = true; });
document.getElementById("automaticDetection").addEventListener("change", event => savePreferences({ fullyManualEnabled: !event.target.checked }, "Tracking mode saved."));
document.getElementById("autoMinimize").addEventListener("change", event => savePreferences({ autoMinimizeEnabled: event.target.checked }, "Overlay preference saved."));
document.getElementById("autoMinimizeSeconds").addEventListener("change", event => savePreferences({ autoMinimizeSeconds: Number(event.target.value) }, "Overlay delay saved."));
document.getElementById("goalNotifications").addEventListener("change", event => savePreferences({ notificationsEnabled: event.target.checked }, "Notification preference saved."));
document.getElementById("saveDashboardGoals").addEventListener("click", async () => {
  if (!extensionApi) { setStatus("Demo mode: install or reload the extension to save goals.", true); return; }
  const daily = Math.max(1, Math.min(525600, Number(document.getElementById("dailyGoalInput").value) || 360));
  const weekly = Math.max(1, Math.min(525600, Number(document.getElementById("weeklyGoalInput").value) || 900));
  const existingGoals = latestDashboard?.state?.preferences?.goals || {};
  const goalsResponse = await sendMessage({ type: "setGoals", goals: {
    daily: { ...existingGoals.daily, minutes: daily },
    weekly: { ...existingGoals.weekly, minutes: weekly },
    monthly: { ...existingGoals.monthly },
    yearly: { ...existingGoals.yearly }
  } });
  const preferencesResponse = await sendMessage({ type: "setPreferences", preferences: { goalCountingMode: document.getElementById("goalCountingMode").value } });
  setStatus(goalsResponse?.ok && preferencesResponse?.ok ? "Goals saved." : "Could not save goals.", !(goalsResponse?.ok && preferencesResponse?.ok));
  await refreshDashboard();
});
document.getElementById("dashboardLanguage").addEventListener("change", async event => {
  if (!extensionApi) { setStatus("Demo mode: install or reload the extension to change language.", true); return; }
  const code = event.target.value;
  const current = latestDashboard?.state?.preferences?.targetLanguage || { code: "und", name: "Choose a language" };
  const nextName = LANGUAGE_NAMES[code] || event.target.selectedOptions[0].textContent;
  if (current.code !== "und" && current.code !== code && !confirm(
    `Switch your active language from ${current.name} to ${nextName}?\n\n` +
    `Your ${current.name} history will stay saved. Free supports one active language at a time. ` +
    "Multi-language workspaces are planned for Pro later."
  )) {
    event.target.value = current.code;
    return;
  }
  const response = await sendMessage({ type: "setTargetLanguage", targetLanguage: { code, name: nextName } });
  setStatus(response?.ok ? `Now showing ${response.targetLanguage.name}.` : "Could not change language.", !response?.ok);
  await refreshDashboard();
});
document.getElementById("dashboardDarkTheme").addEventListener("click", () => savePreferences({ theme: "dark" }, "Dark theme saved."));
document.getElementById("dashboardLightTheme").addEventListener("click", () => savePreferences({ theme: "light" }, "Light theme saved."));
document.getElementById("dashboardProfile").addEventListener("click", () => {
  selectView("settings");
  const card = document.getElementById("dashboardAccountCard");
  card.classList.add("account-focus");
  setTimeout(() => card.classList.remove("account-focus"), 1800);
});
document.getElementById("dashboardSignOutButton").addEventListener("click", async () => {
  await sendMessage({ type: "cloudSignOut" });
  await refreshAccountState();
});
document.getElementById("dashboardDeleteAccountButton").addEventListener("click", async () => {
  if (!extensionApi) { setStatus("Demo mode: install or reload the extension to manage your account.", true); return; }
  if (!confirm("Permanently delete your account and everything stored in cloud sync? Your local tracking history on this device is not affected, but the account itself cannot be recovered.")) return;
  const response = await sendMessage({ type: "cloudDeleteAccount" });
  setStatus(response?.ok ? "Account deleted." : (response?.error?.message || "Could not delete your account."), !response?.ok);
  await refreshAccountState();
});
document.getElementById("dashboardExportJson").addEventListener("click", async () => {
  const response = await sendMessage({ type: "exportData" });
  if (!response?.ok) { setStatus("Could not export data.", true); return; }
  download(`immersion-tracker-${localDateKey()}.json`, "application/json", JSON.stringify(response.state, null, 2));
  setStatus("Backup exported.");
});
document.getElementById("dashboardExportCsv").addEventListener("click", async () => {
  const response = await sendMessage({ type: "exportData" });
  if (!response?.ok) { setStatus("Could not export data.", true); return; }
  const rows = [["date","languageCode","source","activeSeconds","passiveSeconds"]];
  Object.entries(response.state.languageRecords || {}).forEach(([code, records]) => Object.entries(records || {}).forEach(([date, record]) => rows.push([date,code,"all",Number(record.active)||0,Number(record.passive)||0])));
  download(`immersion-tracker-${localDateKey()}.csv`, "text/csv", rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n"));
});
document.getElementById("dashboardImportButton").addEventListener("click", () => document.getElementById("dashboardImportFile").click());
document.getElementById("dashboardImportFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file || file.size > 5 * 1024 * 1024) { setStatus("Choose a JSON backup smaller than 5 MB.", true); return; }
  if (!confirm("Replace local and synced tracker data with this JSON backup?")) { event.target.value = ""; return; }
  try {
    const response = await sendMessage({ type: "importData", state: JSON.parse(await file.text()) });
    setStatus(response?.ok ? "Backup imported." : "Could not import this backup.", !response?.ok);
    await refreshDashboard();
  } catch { setStatus("This is not a valid tracker backup.", true); }
  event.target.value = "";
});
document.getElementById("dashboardReset").addEventListener("click", async () => {
  if (!extensionApi || !confirm("Reset all immersion history, settings, and synced tracking data? This cannot be undone.")) return;
  const response = await sendMessage({ type: "resetAllData" });
  setStatus(response?.ok ? "Tracker data reset." : "Could not reset tracker data.", !response?.ok);
  await refreshDashboard();
});

if (extensionApi) {
  chrome.storage.onChanged.addListener(scheduleRefresh);
  setInterval(refreshDashboard, 5000);
  // Signing in/out happens from the popup, which this already-open tab has
  // no other way to hear about - poll occasionally so it doesn't show stale
  // "Local beta profile" text after the user signs in elsewhere.
  setInterval(refreshAccountState, 5000);
}
selectView(new URLSearchParams(location.search).get("view") || "stats");
refreshDashboard();
refreshAccountState();
