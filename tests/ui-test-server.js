const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT) || 8765;
const today = new Date().toISOString().slice(0, 10);

const mockScript = `<script>
(() => {
  const today = ${JSON.stringify(today)};
  const dashboardDelay = Math.min(3000, Math.max(0, Number(new URLSearchParams(location.search).get("dashboardDelay")) || 0));
  const sessionStorage = {};
  const calls = window.__mockCalls = [];
  function record(call) {
    calls.push(call);
    const output = document.getElementById("mockCallLog");
    if (output) output.textContent = JSON.stringify(calls);
  }
  window.addEventListener("DOMContentLoaded", () => {
    const output = document.createElement("output");
    output.id = "mockCallLog";
    output.hidden = true;
    document.body.appendChild(output);
    output.textContent = JSON.stringify(calls);
  });
  const todayRecord = { active: 1800, passive: 600, sites: {
    netflix: { active: 900, passive: 300 },
    primevideo: { active: 900, passive: 300 }
  } };
  const state = window.__mockState = {
    records: { [today]: todayRecord },
    dailyRecords: {
      [today + "|ja|netflix"]: { id: today + "|ja|netflix", dateKey: today, languageCode: "ja", source: "netflix", activeSeconds: 900, passiveSeconds: 300, sessionCount: 1, schemaVersion: 1 },
      [today + "|ja|primevideo"]: { id: today + "|ja|primevideo", dateKey: today, languageCode: "ja", source: "primevideo", activeSeconds: 900, passiveSeconds: 300, sessionCount: 1, schemaVersion: 1 }
    },
    entitlements: { plan: "beta", proEnabled: true, features: { free: true, pro_analytics: true, cloud_sync: false } },
    languageRecords: {
      ja: { [today]: todayRecord }
    },
    sourceTotals: {
      ja: {
        youtube: { active: 18000, passive: 9000 },
        netflix: { active: 7200, passive: 21600 },
        reading: { active: 1200, passive: 0 }
      }
    },
    sessions: {
      sample: {
        site: "primevideo", title: "Sample movie", languageCode: "ja",
        startedAt: Date.now() - 3600000, lastAt: Date.now(),
        byDate: { [today]: { active: 900, passive: 300 } }
      }
    },
    lastDeletedSession: null,
    manualTimer: null,
    currentStatus: {
      "1": {
        state: "awaiting", languageState: "awaiting", languageCode: "ja",
        site: "netflix", title: "Sample series — Season 1", contentKey: "netflix:sample",
        sessionActive: 120, sessionPassive: 30,
        detectionReason: "Netflix did not expose a reliable selected audio language."
      }
    },
    preferences: {
      targetLanguage: { code: "ja", name: "Japanese" },
      targetLanguageDeferred: false,
      languageNames: { ja: "Japanese" }, historyLimit: 5,
      autoMinimizeEnabled: true, autoMinimizeSeconds: 5,
      notificationsEnabled: true, fullyManualEnabled: false,
      goalCountingMode: "both", goalDisplayMode: "both",
      onboardingCompleted: true, customManualCategories: [],
      theme: new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
      lastManualSource: "reading", lastManualAction: "", lastManualMode: "active",
      goals: {
        daily: { enabled: true, minutes: 360 }, weekly: { enabled: true, minutes: 900 },
        monthly: { enabled: false, minutes: 3600 }, yearly: { enabled: false, minutes: 42000 }
      }
    }
  };
  const fixture = new URLSearchParams(location.search);
  if (fixture.get("empty") === "1") {
    state.records = {};
    state.dailyRecords = {};
    state.languageRecords.ja = {};
  }
  if (fixture.get("calendarStates") === "1") {
    const monthPrefix = today.slice(0, 8);
    const fixtureMinutes = [90, 180, 270, 330, 360];
    state.records = Object.fromEntries(fixtureMinutes.map((minutes, index) => [
      monthPrefix + String(index + 3).padStart(2, "0"),
      { active: minutes * 60, passive: 0 }
    ]));
    state.languageRecords.ja = { ...state.records };
  }
  if (new URLSearchParams(location.search).get("new") === "1") {
    state.preferences.onboardingCompleted = false;
  }
  if (new URLSearchParams(location.search).get("reconnect") === "1") {
    state.currentStatus = {};
  }

  function snapshot(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function handle(message) {
    record({ channel: "runtime", message: snapshot(message) });
    if (message.type === "getDashboard") {
      const dashboard = {
        state: snapshot(state),
        sync: { pendingMonths: 0, lastSyncedAt: Date.now() },
        storageHealth: new URLSearchParams(location.search).get("storageError") === "1"
          ? { writeError: { at: Date.now(), message: "quota full" } }
          : { writeError: null }
      };
      if (dashboardDelay) await new Promise((resolve) => setTimeout(resolve, dashboardDelay));
      return dashboard;
    }
    if (message.type === "getStorageUsage") {
      return {
        ok: true, localBytes: 184320, syncBytes: 24576,
        localUnlimited: true, localQuotaBytes: 10485760, syncQuotaBytes: 102400,
        dailyBreakdownsPermanent: true, readableHistoryLimit: 10
      };
    }
    if (message.type === "setTargetLanguage") {
      state.preferences.targetLanguage = snapshot(message.targetLanguage);
      state.preferences.targetLanguageDeferred = message.targetLanguage.code === "und";
      state.preferences.languageNames[message.targetLanguage.code] = message.targetLanguage.name;
      return { ok: true, targetLanguage: snapshot(message.targetLanguage), preferences: snapshot(state.preferences) };
    }
    if (message.type === "startManualTimer") {
      state.manualTimer = {
        id: "manual-test", source: message.source, action: message.action, mode: message.mode,
        languageCode: message.languageCode, running: true, startedAt: Date.now(),
        lastCheckpointAt: Date.now(), committedSeconds: 0
      };
      return { ok: true, timer: snapshot(state.manualTimer) };
    }
    if (message.type === "pauseManualTimer") {
      if (state.manualTimer) state.manualTimer.running = false;
      return { ok: true, timer: snapshot(state.manualTimer) };
    }
    if (message.type === "addCustomImmersion") return { ok: true, added: message.seconds };
    if (message.type === "setPreferences") {
      Object.assign(state.preferences, snapshot(message.preferences));
      return { ok: true, preferences: snapshot(state.preferences) };
    }
    if (message.type === "setGoals") {
      for (const [period, goal] of Object.entries(message.goals || {})) {
        state.preferences.goals[period] = {
          ...state.preferences.goals[period], ...goal,
          minutes: Math.max(1, Number(goal.minutes) || 1)
        };
      }
      return { ok: true, goals: snapshot(state.preferences.goals) };
    }
    if (message.type === "setUiPreferences") {
      state.preferences.historyLimit = message.historyLimit;
      return { ok: true };
    }
    if (message.type === "deleteHistorySession") {
      state.lastDeletedSession = { id: message.sessionId, session: state.sessions[message.sessionId] };
      delete state.sessions[message.sessionId];
      return { ok: true };
    }
    if (message.type === "undoHistoryDelete") {
      if (state.lastDeletedSession) state.sessions[state.lastDeletedSession.id] = state.lastDeletedSession.session;
      state.lastDeletedSession = null;
      return { ok: true };
    }
    if (message.type === "editHistorySession") {
      const session = state.sessions[message.sessionId];
      if (!session) return { ok: false };
      session.site = message.source; session.title = message.title;
      session.byDate = { [message.date]: { active: message.activeSeconds, passive: message.passiveSeconds } };
      return { ok: true };
    }
    if (message.type === "exportData") return { ok: true, state: snapshot(state) };
    if (message.type === "syncNow") {
      return new URLSearchParams(location.search).get("syncFail") === "1"
        ? { ok: false, reason: "chrome-sync-unavailable" }
        : { ok: true, sourceTotalsSynced: true, lastSyncedAt: Date.now() };
    }
    if (message.type === "resetAllData") return { ok: true };
    return { ok: true };
  }

  window.alert = (message) => record({ channel: "alert", message: String(message) });
  window.confirm = (message) => { record({ channel: "confirm", message: String(message) }); return true; };
  const mockChrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) { Promise.resolve(handle(message)).then((response) => callback?.(response)); }
    },
    tabs: {
      async query() { return [{ id: 1, active: true, url: "https://www.netflix.com/watch/1" }]; },
      sendMessage(tabId, message, callback) {
        record({ channel: "tab", tabId, message: snapshot(message) });
        callback?.({ ok: true });
      },
      async create(details) { record({ channel: "tabs.create", details: snapshot(details) }); return { id: 2 }; },
      async reload(tabId) { record({ channel: "tabs.reload", tabId }); }
    },
    commands: {
      async getAll() {
        return [
          { name: "toggle-manual-timer", shortcut: "Alt+Shift+M" },
          { name: "toggle-video-tracking", shortcut: "Alt+Shift+P" },
          { name: "toggle-status-overlay", shortcut: "Alt+Shift+O" },
          { name: "show-hotkeys", shortcut: "Alt+Shift+H" }
        ];
      }
    },
    storage: {
      session: {
        async get(key) { return typeof key === "string" ? { [key]: sessionStorage[key] } : snapshot(sessionStorage); },
        async set(values) { Object.assign(sessionStorage, snapshot(values)); },
        async remove(key) { delete sessionStorage[key]; }
      }
    }
  };
  if (window.chrome) Object.assign(window.chrome, mockChrome);
  else Object.defineProperty(window, "chrome", { configurable: true, value: mockChrome });
})();
</script>`;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

http.createServer((request, response) => {
  const requested = request.url === "/" ? "/popup.html" : request.url.split("?")[0];
  const filePath = path.resolve(root, "." + requested);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  let body = fs.readFileSync(filePath);
  if (filePath.endsWith("popup.html")) {
    body = Buffer.from(body.toString("utf8").replace('<script src="popup.js"></script>', mockScript + '<script src="popup.js"></script>'));
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(body);
}).listen(port, "127.0.0.1", () => {
  console.log(`UI test server listening on http://127.0.0.1:${port}`);
});
