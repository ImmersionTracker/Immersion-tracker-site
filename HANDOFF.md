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

Done in the previous session: fixed a privacy-policy accuracy bug and added a
tripwire for it; removed the nonexistent `"windows"` permission; wrote
`STORE_SUBMISSION_FIELDS.md` (paste-ready dashboard text) and
`release/MANUAL_QA_WALKTHROUGH.md`; fixed three UI regressions the Playwright
suite caught; stopped manual time being recorded against the "Choose a language"
placeholder; made the weekly-goal marker a continuous band on both surfaces.

## Fixed, awaiting browser QA

All of the below pass `npm run test:foundation` and the regression suite in a
sandbox. **The two Playwright suites have not run** — no Chromium available —
so `npm test` on the user's machine is still the gate. The release zip has
deliberately **not** been rebuilt; do that only once QA passes.

- **Automatic language mode now records the language it detects.** It used to
  file everything under an `"auto"` bucket, so an English video counted as
  "Automatic". `identifyPageLanguage()` in content.js asks "what is this?"
  instead of "is this the target?", using the same evidence in the same order
  of trust (selected audio → declared audio track → audio hints →
  auto-captions → title script). `isStorableLanguageCode()` in background.js is
  now the single rule that `"auto"` and `"und"` are modes, never buckets, and
  `addTick` holds time rather than inventing one. Switching audio track
  mid-title moves subsequent time to the new language. When nothing can be
  identified the overlay asks, offering a dropdown ranked by the user's own
  most-immersed languages, and remembers the answer per video or per channel.
  Automatic mode's dashboard shows every language added together.
- **Manual time in Automatic mode** resolves through `manualLanguageCode()` —
  most-used language, never `"auto"`. See "Still open" below.
- **Chrome Sync failures name the limit** they hit (per-item 8KB with the
  oversized key, 100KB total, 512 items, 120/min, 1800/hour) instead of the old
  "connection or storage quota" guess. Stored on `state.sync.lastError` so the
  popup shows it without a manual retry.
- **Weekly Immersion chart no longer clips labels.** The plot is now the space
  left after the label rows rather than a fixed 180px scale in a 195px box;
  axis ticks, gridlines and bar tops all derive from `--chart-label-block`.
- **Mismatch messages name the detected language** instead of "another
  language", falling back to the vague wording only when nothing is nameable.
- **Manual timer**: a "Save progress" button banks time without stopping, and a
  global violet "M" toolbar badge shows the timer is running.
- `applySessionContribution` / `rollbackSession` no longer default to `"ja"`.
- `dashboard-ui.test.cjs` line 139 asserted nothing; it now checks the `::after`
  band's content, colour, height and overhang against the grid gap.

A review pass over the diff caught seven bugs, all now fixed and covered by
tests: `manualLanguageCode` could never reach its fallbacks (because
`normalizeLanguageCode` answers `"ja"` for unparseable input — use the new
`strictLanguageCode` when you need to detect "no code was given"); the
one-second retry loop rebuilt the language picker under the user; the badge
blanked the manifest tooltip permanently; legacy `"auto"` data disappeared from
all views; a remembered language overruled "don't count this video"; an audio
switch resurrected a declined video; and `sync.lastError` was sticky.

**The repo has stale `.git/HEAD.lock` and `.git/index.lock`** that the sandbox
cannot delete ("Operation not permitted"), so nothing can be committed from a
sandbox until they are removed from Windows. Same filesystem limitation that
makes `zip -u` fail.

## Still open

- **Legacy `"auto"` bucket data** is preserved and counted in Automatic mode's
  combined view, and rolls back from the bucket it was written to, but it is
  still invisible in any single-language view — correctly, since there is no way
  to know retroactively what language those hours were. If the user wants it
  attributed, it needs a deliberate reassignment step.
- **Manual entry in Automatic mode** silently picks the most-used language.
  A language selector on the manual timer and Quick add forms would make that
  explicit; the user has not been asked yet.
- A session whose language switches mid-play keeps its original
  `session.languageCode`, so History attributes the whole session to the first
  language. Daily records and totals are correct.

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
