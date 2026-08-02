(function exposeTrackerAnalytics(globalScope) {
  "use strict";

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function localDateKey(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function filter(records, { languageCode = "ja", startKey = "", endKey = "" } = {}) {
    return Object.values(records || {}).filter((record) =>
      String(record?.languageCode || "ja") === languageCode &&
      (!startKey || String(record?.dateKey) >= startKey) &&
      (!endKey || String(record?.dateKey) <= endKey)
    );
  }

  function totals(records) {
    return records.reduce((result, record) => {
      result.active += number(record?.activeSeconds);
      result.passive += number(record?.passiveSeconds);
      result.sessions += Math.max(0, Math.floor(Number(record?.sessionCount) || 0));
      return result;
    }, { active: 0, passive: 0, sessions: 0, total: 0 });
  }

  function withTotal(value) {
    return { ...value, total: value.active + value.passive };
  }

  function totalsFor(records, options) {
    return withTotal(totals(filter(records, options)));
  }

  function rangeForDays(days, reference = new Date()) {
    const end = new Date(reference);
    end.setHours(0, 0, 0, 0);
    const start = addDays(end, -(Math.max(1, days) - 1));
    const previousEnd = addDays(start, -1);
    const previousStart = addDays(previousEnd, -(Math.max(1, days) - 1));
    return {
      startKey: localDateKey(start), endKey: localDateKey(end),
      previousStartKey: localDateKey(previousStart), previousEndKey: localDateKey(previousEnd)
    };
  }

  function percentChange(current, previous) {
    if (!previous) return current ? 100 : 0;
    return Math.round((current - previous) / previous * 100);
  }

  function dailyTotals(records) {
    const days = {};
    for (const record of records) {
      days[record.dateKey] ||= { active: 0, passive: 0, sessions: 0, total: 0 };
      days[record.dateKey].active += number(record.activeSeconds);
      days[record.dateKey].passive += number(record.passiveSeconds);
      days[record.dateKey].sessions += Math.max(0, Math.floor(Number(record.sessionCount) || 0));
      days[record.dateKey].total = days[record.dateKey].active + days[record.dateKey].passive;
    }
    return days;
  }

  function sourceTotals(records) {
    const sources = {};
    for (const record of records) {
      const name = String(record.source || "other");
      sources[name] ||= { active: 0, passive: 0, sessions: 0, total: 0 };
      sources[name].active += number(record.activeSeconds);
      sources[name].passive += number(record.passiveSeconds);
      sources[name].sessions += Math.max(0, Math.floor(Number(record.sessionCount) || 0));
      sources[name].total = sources[name].active + sources[name].passive;
    }
    return sources;
  }

  function currentStreak(records, reference = new Date(), minimumSeconds = 1) {
    const days = dailyTotals(records);
    const threshold = Math.max(1, Number(minimumSeconds) || 1);
    let cursor = new Date(reference);
    cursor.setHours(0, 0, 0, 0);
    if ((days[localDateKey(cursor)]?.total || 0) < threshold) cursor = addDays(cursor, -1);
    let streak = 0;
    while ((days[localDateKey(cursor)]?.total || 0) >= threshold) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function longestStreak(records) {
    const keys = Object.entries(dailyTotals(records))
      .filter(([, day]) => day.total > 0)
      .map(([key]) => key)
      .sort();
    let longest = 0;
    let running = 0;
    let previous = null;
    for (const key of keys) {
      const date = parseDateKey(key);
      running = previous && Math.round((date - previous) / 86400000) === 1 ? running + 1 : 1;
      longest = Math.max(longest, running);
      previous = date;
    }
    return longest;
  }

  function mondayFor(date) {
    const monday = new Date(date);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));
    return monday;
  }

  function weeklyTotals(records) {
    const weeks = {};
    for (const [dateKey, values] of Object.entries(dailyTotals(records))) {
      const date = parseDateKey(dateKey);
      if (!date) continue;
      const key = localDateKey(mondayFor(date));
      weeks[key] ||= { active: 0, passive: 0, sessions: 0, total: 0 };
      weeks[key].active += values.active;
      weeks[key].passive += values.passive;
      weeks[key].sessions += values.sessions;
      weeks[key].total = weeks[key].active + weeks[key].passive;
    }
    return weeks;
  }

  function weeklyConsistency(records, weeklyGoalMinutes) {
    const goalSeconds = Math.max(1, Number(weeklyGoalMinutes) || 1) * 60;
    const weeks = weeklyTotals(records);
    const values = Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0]));
    const completed = values.filter(([, week]) => week.total >= goalSeconds).length;
    return { weeks, completed, rate: values.length ? completed / values.length : 0, goalSeconds };
  }

  function highlights(records) {
    const days = dailyTotals(records);
    const weeks = weeklyTotals(records);
    const sources = sourceTotals(records);
    const bestDay = Object.entries(days).sort((a, b) => b[1].total - a[1].total)[0] || null;
    const bestWeek = Object.entries(weeks).sort((a, b) => b[1].total - a[1].total)[0] || null;
    const topSource = Object.entries(sources).sort((a, b) => b[1].total - a[1].total)[0] || null;
    return { bestDay, bestWeek, topSource, longestStreak: longestStreak(records) };
  }

  function trend(records, { startKey, endKey, points = 8 } = {}) {
    const start = parseDateKey(startKey);
    const end = parseDateKey(endKey);
    if (!start || !end) return [];
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const bucketSize = Math.max(1, Math.ceil(days / points));
    const selected = dailyTotals(records);
    const result = [];
    for (let offset = 0; offset < days; offset += bucketSize) {
      const bucketStart = addDays(start, offset);
      const bucketEnd = addDays(start, Math.min(days - 1, offset + bucketSize - 1));
      const value = { startKey: localDateKey(bucketStart), endKey: localDateKey(bucketEnd), active: 0, passive: 0, total: 0 };
      for (let cursor = new Date(bucketStart); cursor <= bucketEnd; cursor = addDays(cursor, 1)) {
        const day = selected[localDateKey(cursor)];
        if (!day) continue;
        value.active += day.active;
        value.passive += day.passive;
      }
      value.total = value.active + value.passive;
      result.push(value);
    }
    return result;
  }

  function analyzePeriod(allRecords, { languageCode = "ja", days = 30, reference = new Date(), dailyGoalMinutes = 60 } = {}) {
    const range = rangeForDays(days, reference);
    const currentRecords = filter(allRecords, { languageCode, startKey: range.startKey, endKey: range.endKey });
    const previousRecords = filter(allRecords, { languageCode, startKey: range.previousStartKey, endKey: range.previousEndKey });
    const current = withTotal(totals(currentRecords));
    const previous = withTotal(totals(previousRecords));
    const dayValues = dailyTotals(currentRecords);
    const goalSeconds = Math.max(1, Number(dailyGoalMinutes) || 60) * 60;
    const goalDays = Object.values(dayValues).filter((day) => day.total >= goalSeconds).length;
    return {
      days,
      range,
      current,
      previous,
      comparisonPercent: percentChange(current.total, previous.total),
      dailyAverage: current.total / days,
      previousDailyAverage: previous.total / days,
      activeRatio: current.total ? current.active / current.total : 0,
      streak: currentStreak(filter(allRecords, { languageCode }), reference),
      goalConsistency: goalDays / days,
      goalDays,
      trend: trend(currentRecords, { startKey: range.startKey, endKey: range.endKey }),
      previousTrend: trend(previousRecords, { startKey: range.previousStartKey, endKey: range.previousEndKey }),
      sources: sourceTotals(currentRecords),
      highlights: highlights(currentRecords)
    };
  }

  const api = {
    localDateKey,
    parseDateKey,
    filter,
    totals,
    totalsFor,
    rangeForDays,
    percentChange,
    dailyTotals,
    sourceTotals,
    currentStreak,
    longestStreak,
    weeklyTotals,
    weeklyConsistency,
    highlights,
    trend,
    analyzePeriod
  };
  globalScope.TrackerAnalytics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
