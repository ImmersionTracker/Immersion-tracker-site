const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));

const manifest = json("manifest.json");
assert.equal(manifest.manifest_version, 3, "Manifest V3 is required");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest version must use x.y.z");
assert.equal(manifest.incognito, "not_allowed", "incognito must remain disabled for this data-bearing extension");
assert.equal(manifest.content_security_policy?.extension_pages, "script-src 'self'; object-src 'self';");
assert(!("key" in manifest), "Chrome Web Store packages must not contain a manifest key");

const allowedPermissions = new Set(["storage", "unlimitedStorage", "tabs", "windows", "alarms", "idle", "notifications"]);
for (const permission of manifest.permissions || []) assert(allowedPermissions.has(permission), `review new permission before release: ${permission}`);
for (const host of manifest.host_permissions || []) assert(host.startsWith("https://"), `host permission must use HTTPS: ${host}`);

const sourceFiles = [
  "background.js", "content.js", "page-probe.js", "popup.js",
  "lib/tracker-data.js", "lib/tracker-analytics.js", "lib/entitlements.js", "lib/account-state.js",
  "lib/cloud-config.js", "lib/cloud-contract.js", "lib/supabase-auth.js", "lib/supabase-rest.js",
  "lib/analytics-contract.js", "lib/analytics-rest.js",
  "popup.html", "store-assets/dashboard.html", "store-assets/capture.html"
];
for (const file of sourceFiles) {
  const contents = read(file);
  assert(!/<script[^>]+src=["']https?:/i.test(contents), `${file} contains remotely hosted executable code`);
  assert(!/\beval\s*\(/.test(contents), `${file} contains eval()`);
}

const cloudConfig = json("config/cloud-config.example.json");
assert.equal(cloudConfig.enabled, false, "example cloud configuration must remain disabled");
assert(String(cloudConfig.supabaseUrl).includes("YOUR_PROJECT"), "do not commit a real Supabase project URL");
assert(String(cloudConfig.supabaseAnonKey).includes("YOUR_PUBLIC_ANON_KEY"), "do not commit a real Supabase key");

for (const required of [
  "PRIVACY.md",
  "STORE_LISTING.md",
  "TECHNICAL_FOUNDATION.md",
  "NEXT_PHASE_ROADMAP.md",
  "supabase/migrations/0001_cloud_foundation.sql",
  "supabase/tests/rls-checklist.md",
  "supabase/migrations/0002_analytics_events.sql",
  "supabase/tests/analytics-rls-checklist.md"
]) assert(fs.existsSync(path.join(root, required)), `missing release document: ${required}`);

const readme = read("README.md");
assert(readme.includes(`version ${manifest.version}`), "README version must match manifest version");
const privacy = read("PRIVACY.md");
// Tripwires, not a full policy review: these force a conscious PRIVACY.md
// edit (and re-reading of this assertion) whenever the underlying disclosure
// it guards actually changes, rather than letting it drift silently.
assert(privacy.includes("Optional account and cloud sync"), "cloud-sync privacy disclosure is missing or was renamed unexpectedly");
assert(privacy.includes("Row Level Security") && privacy.includes("never embeds a Supabase service-role key"),
  "cloud-sync privacy disclosure must keep describing RLS and the no-service-role-key guarantee - update deliberately if the cloud architecture changes");
assert(manifest.host_permissions.includes("https://*.supabase.co/*"),
  "cloud sync is documented as live in PRIVACY.md but the Supabase host permission is missing from manifest.json");
assert(privacy.includes("no advertising SDK and no payment integration"), "advertising/payment privacy disclosure changed unexpectedly");
assert(privacy.includes("Optional product analytics") && privacy.includes("off by default and stays off until turned on in Tracker Settings"),
  "analytics privacy disclosure changed unexpectedly - update deliberately together with the actual consent toggle and event-shaping code if this changes");
assert(privacy.includes("cannot be linked to a person, a device, or to other events from the same install"),
  "analytics anonymity guarantee wording changed unexpectedly - this must stay true of the actual event payload, not just the policy text");

const output = path.join(root, "store-assets", "output");
const screenshots = [
  "01-popup-video-playing.png",
  "02-popup-japanese-detected.png",
  "03-daily-weekly-statistics.png",
  "04-history-analytics.png",
  "05-settings.png"
];
for (const name of screenshots) {
  const data = fs.readFileSync(path.join(output, name));
  assert.equal(data.toString("ascii", 1, 4), "PNG", `${name} must be PNG`);
  assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [1280, 800], `${name} must be 1280x800`);
}

console.log(`Release checks passed for Language Immersion Tracker ${manifest.version}.`);
