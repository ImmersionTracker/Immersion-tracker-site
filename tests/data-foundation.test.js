const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const TrackerData = require(path.join(root, "lib", "tracker-data.js"));
const TrackerAnalytics = require(path.join(root, "lib", "tracker-analytics.js"));
const TrackerEntitlements = require(path.join(root, "lib", "entitlements.js"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dashboardHtml = fs.readFileSync(path.join(root, "store-assets", "dashboard.html"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "store-assets", "dashboard.js"), "utf8");

function testLosslessMigration() {
  const legacy = {
    version: 8,
    languageRecords: {
      ja: {
        "2026-07-01": { active: 300, passive: 120, sites: { youtube: { active: 180, passive: 120 }, reading: { active: 120, passive: 0 } } },
        "2026-07-02": { active: 90, passive: 60, sites: {} }
      },
      sv: { "2026-07-01": { active: 45, passive: 0, sites: { listening: { active: 45, passive: 0 } } } }
    },
    sessions: {
      real: { languageCode: "ja", site: "youtube", byDate: { "2026-07-01": { active: 180, passive: 120 } } }
    }
  };
  const result = TrackerData.migrate(structuredClone(legacy), 123456);
  assert.equal(result.ok, true, "migration must pass its dry-run total diff");
  assert.equal(result.state.version, 9);
  assert.deepEqual(TrackerData.diffTotals(legacy, result.state.dailyRecords), [], "per-language/date totals must be identical");
  assert.equal(result.state.dailyRecords[TrackerData.recordId("2026-07-01", "ja", "youtube")].sessionCount, 1,
    "a genuine retained session may contribute to session count");
  assert.equal(result.state.dailyRecords[TrackerData.recordId("2026-07-02", "ja", "compacted")].sessionCount, 0,
    "missing session history must not be invented");
  assert.equal(result.state.dailyRecords[TrackerData.recordId("2026-07-02", "ja", "compacted")].legacy, true,
    "unknown historical source residuals must be labelled as legacy compacted data");
}

function testReconciliationAndSessionCounts() {
  const state = {
    version: 9,
    languageRecords: { ja: { "2026-08-01": { active: 60, passive: 30, sites: { youtube: { active: 60, passive: 30 } } } } },
    dailyRecords: {},
    dailySessionCounts: {}
  };
  TrackerData.adjustSessionCount(state, { dateKey: "2026-08-01", languageCode: "ja", source: "youtube" }, 1);
  const checked = TrackerData.reconcile(state, 2000);
  assert.equal(checked.ok, true);
  const id = TrackerData.recordId("2026-08-01", "ja", "youtube");
  assert.equal(state.dailyRecords[id].sessionCount, 1, "first-session counts must survive canonical projection");
  state.languageRecords.ja["2026-08-01"].active += 15;
  state.languageRecords.ja["2026-08-01"].sites.youtube.active += 15;
  assert.equal(TrackerData.reconcile(state, 3000).ok, true);
  assert.equal(state.dailyRecords[id].activeSeconds, 75);
  assert.equal(state.dailyRecords[id].sessionCount, 1);
}

function testLegacySourceNormalizationAndRepair() {
  const floatingLegacy = {
    version: 8,
    languageRecords: { ja: { "2026-06-01": {
      active: 0.1 + 0.2 + 0.3,
      passive: 0,
      sites: {
        YouTube: { active: 0.1 + 0.3, passive: 0 },
        youtube: { active: 0.2, passive: 0 }
      }
    } } },
    sessions: {}
  };
  const floating = TrackerData.migrate(structuredClone(floatingLegacy), 4000);
  assert.equal(floating.ok, true, "equivalent source names and fractional seconds must not block migration");
  assert.equal(Object.keys(floating.state.dailyRecords).length, 1, "normalized source collisions should be combined, not overwritten");
  assert.deepEqual(TrackerData.diffTotals(floatingLegacy, floating.state.dailyRecords), []);

  const inconsistentLegacy = {
    version: 8,
    languageRecords: { ja: { "2026-06-02": {
      active: 100,
      passive: 40,
      sites: {
        youtube: { active: 80, passive: 30 },
        reading: { active: 40, passive: 20 }
      }
    } } },
    sessions: {}
  };
  const repaired = TrackerData.migrate(structuredClone(inconsistentLegacy), 5000);
  assert.equal(repaired.ok, true, "historically inconsistent source splits should be repaired during migration");
  assert.deepEqual(TrackerData.diffTotals(inconsistentLegacy, repaired.state.dailyRecords), [],
    "source repair must preserve authoritative daily active/passive totals");
  assert.equal(repaired.state.dataModel.repairedSourceBreakdowns, 1);
}

function testSharedAnalytics() {
  const records = {};
  for (let day = 1; day <= 14; day += 1) {
    const dateKey = `2026-07-${String(day).padStart(2, "0")}`;
    const source = day % 2 ? "youtube" : "reading";
    const id = TrackerData.recordId(dateKey, "ja", source);
    records[id] = TrackerData.createRecord({ dateKey, languageCode: "ja", sourceName: source, activeSeconds: day * 60, passiveSeconds: 30, sessionCount: 1 });
  }
  const analysis = TrackerAnalytics.analyzePeriod(records, {
    languageCode: "ja", days: 7, reference: new Date(2026, 6, 14), dailyGoalMinutes: 5
  });
  assert.equal(analysis.current.sessions, 7);
  assert(analysis.current.total > analysis.previous.total, "period comparison should use the immediately preceding range");
  assert.equal(Object.keys(analysis.sources).length, 2);
  assert.equal(analysis.highlights.longestStreak, 7);
  const consistency = TrackerAnalytics.weeklyConsistency(TrackerAnalytics.filter(records, { languageCode: "ja" }), 20);
  assert.equal(Object.keys(consistency.weeks).length, 3);
  assert(consistency.rate >= 0 && consistency.rate <= 1);
}

function testEntitlementsAndUiContracts() {
  const beta = TrackerEntitlements.normalize();
  assert.equal(TrackerEntitlements.has(beta, "pro_analytics"), true, "Pro Analytics should be on for beta users");
  assert.equal(TrackerEntitlements.has(beta, "cloud_sync"), false, "future cloud features must remain off");
  const free = TrackerEntitlements.normalize({ proEnabled: false, features: { pro_analytics: false } });
  assert.equal(TrackerEntitlements.has(free, "pro_analytics"), false, "the real gate must also have an off path");
  for (const label of ["Total immersion", "Daily average", "Active vs passive time", "Current streak", "IMMERSION TREND", "SOURCE COMPARISON", "WEEKLY GOAL CONSISTENCY", "HIGHLIGHTS"]) {
    assert(dashboardHtml.includes(label), `Pro Analytics is missing ${label}`);
  }
  assert(dashboardJs.includes("TrackerAnalytics.analyzePeriod") && dashboardJs.includes("TrackerEntitlements.has"));
  assert(dashboardJs.includes("openSourceDrawer"), "source rows must open related local sessions");
}

function testMigrationAndSyncBoundaries() {
  assert(background.includes('MIGRATION_BACKUP_KEY') && background.includes('MIGRATION_STAGE_KEY'),
    "migration must retain a raw backup and verify a staged copy");
  assert(background.includes("TrackerData.diffTotals(legacyCopy, staged?.dailyRecords)"),
    "staged migration must be diffed before promotion");
  assert(background.includes('reason: "canonical-divergence"'), "divergent dual writes must be blocked");
  assert(!background.includes("DETAIL_RETENTION_MONTHS"), "daily source history must no longer be compacted by age");
  const syncStart = background.indexOf("async function flushDirtyMonths");
  const syncEnd = background.indexOf("async function checkRemoteReset", syncStart);
  assert(!background.slice(syncStart, syncEnd).includes("dailyRecords"),
    "canonical long-term history must not be added to Chrome Sync");
}

testLosslessMigration();
testReconciliationAndSessionCounts();
testLegacySourceNormalizationAndRepair();
testSharedAnalytics();
testEntitlementsAndUiContracts();
testMigrationAndSyncBoundaries();
console.log("Data foundation checks passed.");
