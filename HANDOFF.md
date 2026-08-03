# Handoff prompt — paste this into a new chat

Continue work on the Language Immersion Tracker Chrome extension (the
japanese-immersion-tracker folder). Read your memory files first — release
state, Supabase verification history, the git sandbox quirk, and the Chrome
Store submission notes. Then run `git log --oneline -8` and `git status`.

## Where things stand

v1.9.4. Local `main` is ~20 commits ahead of `origin/main` and **needs a force
push** (`git push --force origin main`) — history was rewritten to remove a
personal email from the initial commit, so origin's old root is no longer an
ancestor. Content was verified unchanged through the rewrite.

The full test suite passes on the user's machine: `npm test`, including both
Playwright UI suites. Do not assume it still passes after your changes — the
sandbox cannot run Playwright (no Chromium download), so the user must run
`npm test` on their machine and report back.

Done this session: fixed a privacy-policy accuracy bug and added a tripwire for
it; removed the nonexistent `"windows"` permission; wrote
`STORE_SUBMISSION_FIELDS.md` (paste-ready dashboard text) and
`release/MANUAL_QA_WALKTHROUGH.md`; fixed three UI regressions the Playwright
suite caught; stopped manual time being recorded against the "Choose a language"
placeholder; made the weekly-goal marker a continuous band on both surfaces.

## Open bugs, in priority order

1. ~~**"Show status" does nothing.**~~ **FIXED, needs confirming in the
   browser.** It was never broken: DevTools showed the host at 121x37 with
   `display: block`, `position: fixed`, `opacity: 1`, on-screen. The expanded
   card is 310px, so what was visible was the *compact pill* —
   `showExpandedOverlay()` opened the card and then `scheduleAutoMinimize()`
   collapsed it after 5 seconds. The `overlayManuallyShown` flag existed for
   exactly this and was set immediately before the call, but
   `scheduleAutoMinimize()` was the one place that never read it. Now a
   deliberately opened overlay stays open, and `minimizeOverlay()` clears the
   flag so auto-minimize resumes for later auto-opened overlays.

2. **Chrome Sync fails** with "could not save. Check your Chrome Sync
   connection or storage quota" after seeding test data. Sync limits: 100KB
   total, 8KB per item, 120 writes/min, 1800/hour. User was at 17KB total, so
   suspect the per-minute write cap or an oversized item. The code currently
   swallows the real error — surface `chrome.runtime.lastError` so the message
   names the actual limit.

3. **Weekly Immersion chart clips its X-axis labels**, worse as recorded time
   grows (dashboard).

4. **Show which language was detected.** The message "YouTube's automatic
   captions identify another spoken language" should name it. Detection reads
   player metadata only (`page-probe.js`: `defaultAudioLanguage`,
   `audioTrack.languageCode`, caption tracklist) — never audio, never AI.

5. **Manual timer: save progress**, and show a running indicator (the user
   suggested an icon badge like the A/P badge for automatic tracking).

6. `applySessionContribution` in `background.js` (~line 705) defaults
   `languageCode` to `"ja"` — a leftover from the Japanese-only origin. Should
   fall back to the current target language.

7. `dashboard-ui.test.cjs` line 139 asserts
   `getComputedStyle(day, "::after").backgroundColor !== "transparent"`, but
   that property returns `"rgba(0, 0, 0, 0)"` when no `::after` exists, so the
   assertion passes unconditionally and verifies nothing.

## Before the Chrome Web Store submission

- **The hosted privacy policy is dangerously out of date.** Live at
  `https://immersiontracker.github.io/Immersion-tracker-site/privacy`, it is
  still the July 17 version claiming the extension has "no developer-operated
  backend, analytics service, advertising SDK, or database" — untrue since
  v1.9.2. It must be replaced with this repo's `PRIVACY.md` before submitting.
  The site lives in a separate `Immersion-tracker-site` repo; ask the user to
  mount that folder so it can be edited and diffed directly.
- The user is mid-submission in the Developer Dashboard. `STORE_SUBMISSION_FIELDS.md`
  has paste-ready text for every field. Still to tick: **Web history** under
  Data usage. Still to decide: category, trader status, and which five of the
  seven screenshots to upload (the store caps it at five).
- Manual QA sections 7–10 of `release/MANUAL_QA_WALKTHROUGH.md` are not done:
  account signup, cloud sync, account deletion end-to-end, and reset-all-data.
  Sections 1–6 passed apart from the bugs above.
- Rebuild `release/Language-Immersion-Tracker-1.9.4.zip` after any source change
  — use python `zipfile` into `/tmp` then `mv`, since this sandbox's filesystem
  refuses the unlink that `zip -u` needs.

## Working notes

Ask before pushing, and before anything destructive. The user prefers concise,
direct answers. Verify claims against the code rather than asserting from
memory — several bugs this session came from documentation drifting away from
what the code actually does.
