(function exposeEntitlements(globalScope) {
  "use strict";

  const FEATURE_KEYS = Object.freeze([
    "free",
    "pro_analytics",
    "cloud_sync",
    "multiple_languages",
    "advanced_goals",
    "custom_reports"
  ]);

  const PLAN_FEATURES = Object.freeze({
    free: Object.freeze({
      free: true,
      pro_analytics: false,
      cloud_sync: false,
      multiple_languages: false,
      advanced_goals: false,
      custom_reports: false
    }),
    beta: Object.freeze({
      free: true,
      pro_analytics: true,
      cloud_sync: false,
      multiple_languages: false,
      advanced_goals: false,
      custom_reports: false
    }),
    pro: Object.freeze({
      free: true,
      pro_analytics: true,
      cloud_sync: true,
      multiple_languages: true,
      advanced_goals: true,
      custom_reports: false
    })
  });

  const DEFAULT_ENTITLEMENTS = Object.freeze({
    schemaVersion: 1,
    authority: "local-beta",
    plan: "beta",
    proEnabled: true,
    expiresAt: 0,
    checkedAt: 0,
    features: PLAN_FEATURES.beta
  });

  function timestamp(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function planName(value, fallback = "free") {
    return value === "pro" || value === "beta" || value === "free" ? value : fallback;
  }

  function featureSet(plan, overrides, allowCloud) {
    const baseline = PLAN_FEATURES[plan] || PLAN_FEATURES.free;
    return Object.fromEntries(FEATURE_KEYS.map((feature) => {
      const allowed = baseline[feature] === true && (feature !== "cloud_sync" || allowCloud === true);
      return [feature, allowed && overrides?.[feature] !== false];
    }));
  }

  function normalizeLocal(value) {
    const source = value && typeof value === "object" ? value : {};
    const disabled = source.proEnabled === false || source.plan === "free";
    const plan = disabled ? "free" : "beta";
    return {
      schemaVersion: 1,
      authority: "local-beta",
      plan,
      proEnabled: plan === "beta",
      expiresAt: 0,
      checkedAt: timestamp(source.checkedAt),
      features: featureSet(plan, source.features, false)
    };
  }

  function normalizeServer(value, now = Date.now()) {
    const source = value && typeof value === "object" ? value : {};
    const expiresAt = timestamp(source.expiresAt ?? source.pro_expires_at);
    let plan = planName(source.plan, "free");
    if (plan === "pro" && expiresAt && expiresAt <= Number(now)) plan = "free";
    return {
      schemaVersion: 1,
      authority: "server",
      plan,
      proEnabled: plan === "pro" || plan === "beta",
      expiresAt: plan === "pro" ? expiresAt : 0,
      checkedAt: timestamp(source.checkedAt) || Math.floor(Number(now) || Date.now()),
      features: featureSet(plan, source.features, plan === "pro" || plan === "beta")
    };
  }

  function normalize(value, now = Date.now()) {
    return value?.authority === "server" ? normalizeServer(value, now) : normalizeLocal(value);
  }

  function has(entitlements, feature, now = Date.now()) {
    return normalize(entitlements, now).features[String(feature)] === true;
  }

  function requiresServer(feature) {
    return feature === "cloud_sync" || feature === "multiple_languages";
  }

  const api = {
    FEATURE_KEYS,
    PLAN_FEATURES,
    DEFAULT_ENTITLEMENTS,
    normalizeLocal,
    normalizeServer,
    normalize,
    has,
    requiresServer
  };
  globalScope.TrackerEntitlements = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
