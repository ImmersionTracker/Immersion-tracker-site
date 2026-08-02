# Language Immersion Tracker - version 1.9.2

A Chrome Manifest V3 extension for tracking active and passive immersion in any target language. It detects supported video playback on YouTube and major streaming services, provides a persistent manual timer for any source, tracks goals, and keeps each language's totals and remembered video decisions separate.

The extension is completely free. It now includes an optional Supabase account and cloud-sync path - sign-in UI, an upload queue, a three-month free sync trial - in `lib/account-state.js`, `lib/supabase-auth.js`, `lib/supabase-rest.js`, `lib/cloud-contract.js`, `background.js`, and `supabase/`. Signing in is never required: local tracking, goals, history, and exports work fully without an account and are unaffected if an account is never created, is signed out of, or its free sync trial ends - only the cloud mirror stops updating. The RLS checklist in `supabase/tests/rls-checklist.md` has been run live against the production Supabase project with two real accounts (see `release/RELEASE_CHECKLIST.md`), so this release ships with the `https://*.supabase.co/*` host permission and cloud sign-in enabled. See `PRIVACY.md` for exactly what cloud sync does and does not send.

## What changed in version 1.9.2

- Verified the full RLS checklist (`supabase/tests/rls-checklist.md`) live against the production Supabase project with two real accounts: cross-account isolation, anon-role lockout, immutable plan/entitlement fields, device/generation-gated uploads, upsert-replaces-not-adds, reset-and-regenerate, and cascading account deletion all passed.
- Enabled optional Supabase sign-in and cloud sync in the shipped package (host permission and cloud configuration now included; previously held back pending the RLS verification above).
- Updated `PRIVACY.md` and `STORE_LISTING.md` to describe cloud sync as live rather than pending.

## What changed in version 1.9.1

- Restored the labelled PayPal "Donate" button in the popup, Account & Plan panel, and dashboard.
- Finished the Insights layout: full-size calendar, compact Weekly Immersion, five History entries shown normally and up to ten scrollable without resizing cards.
- Built (but did not enable in this release) optional Supabase sign-in, an idempotent cloud-sync upload queue, and a three-month free sync trial that never affects local tracking.
- Updated `PRIVACY.md` to disclose the optional account/cloud-sync and (not-yet-enabled) consent-based analytics capabilities now present in the code.

## What changed in version 1.9.0

- Added the full responsive dashboard, History & Analytics, settings surface, and beta Pro Analytics experience.
- Added the database-ready daily-total data service and future account/cloud contracts while keeping the current release local-only.
- Redesigned the extension and store assets with consistent dark/light themes and an 800x600 action popup, Chrome's maximum supported popup size.
- Added onboarding, account and Free/Pro explanations, local language selection, safer migration checks, and expanded UI/release validation.

## What changed in version 1.6.0

- Removed the movie/TV classification question. When spoken-language evidence is unavailable, the tracker now remembers the user's answer for the exact video and can learn a related-video group only from strong page metadata and explicit user approval.
- Kept selected-audio evidence as the highest-priority signal. A current selected audio track overrides remembered exact-video or related-video choices.
- Added an in-memory confirmation buffer so eligible playback while the language question is visible can be credited after **Yes** without saving uncertain time first. The buffer is discarded after **No** or navigation.
- Added **Fully manual counting**. When enabled, every real, audible video on a supported playback page counts toward the selected language without language questions; playback, sound, ad, idle, and active/passive rules still apply.
- Added a goal contribution preference for **Active + passive** or **Active only**, plus an independent Goal Progress detail preference for showing both time types, active only, or passive only. Insights continues to show the complete active/passive history.
- Replaced the former support button with an **Open dashboard** action for the responsive full-page tracker.
- Retired the obsolete content-type storage workflow and kept existing immersion totals, streaks, history, and language decisions compatible.

## What changed in version 1.5.6

- Removed the locale-derived shortened-label and single-letter episode heuristics added in 1.5.5. Real Netflix playback pages did not reliably expose the text those heuristics depended on, so they did not improve detection in practice.
- Kept the reliable numbered full-word season/episode detection, compact `S1E2` patterns, explicit playback routes, matching Open Graph/JSON-LD metadata, remembered decisions, and manual movie/TV fallback.
- Watchmode was evaluated but not integrated: it cannot identify the selected audio language, requires an API key, and would send viewed title information to an external service, conflicting with the extension's local-only privacy model.

## What changed in version 1.5.5 (superseded by 1.5.6)

- Added locale-aware shortened season and episode labels derived from every language offered by the extension, including Netflix-style forms such as `Avs. 4`, `Säs. 1`, `Ep. 4`, and comparable localized prefixes.
- Added guarded narrow episode labels such as Swedish `A4`. Single-letter labels count only when the player also exposes a separate series title that matches the playback title, preventing an isolated title like `A4` from being assumed to be a TV show.
- Shortened season labels can also provide the season number when the page language and separate series information make the abbreviation reliable.
- Added regressions based on the observed Swedish Netflix layouts for `Avs. 4` and `A4`.

## What changed in version 1.5.4

- Added a **Reconnect** button to confirmed on-video sessions beside **Not [language] - remove time**.
- Reconnect first saves pending session time, briefly waits for the save to finish, and then reloads the current playback page so Chrome can inject a fresh tracker connection.
- Reconnecting does not remove or change the remembered language decision.

## What changed in version 1.5.3

- Fixed YouTube being classified as passive while its tab and Chrome window were actively focused, including fullscreen playback. Chrome's active-tab/window state is now authoritative, with page focus retained as a fallback.
- Added numbered season and episode terms for every language offered by the extension, including forms such as `Säsong 1`, `Avsnitt 2`, `第1話`, and their supported-language equivalents.
- Season or episode words only count as TV evidence when paired with a number, preventing numberless words in movie titles from triggering TV-show detection.
- Fullscreen changes now refresh active/passive status immediately.

## What changed in version 1.5.2

- Added reliable movie/TV classification from explicit playback routes where services expose it, while preserving the three-tier fallback for ambiguous pages.
- JSON-LD detection now matches metadata to the title that is actually playing, preventing unrelated recommendations or carousels from causing false movie/TV matches.
- Dynamic Open Graph and JSON-LD changes are detected across the whole page, including streaming sites that update metadata without a full reload.
- Content-type decisions now use opaque stored keys, so remembered movie/TV choices do not retain readable viewing titles. Older readable keys are migrated automatically.
- Navigating to another title cancels an outdated movie/TV prompt, and the two-step label can no longer leak into a later unrelated language prompt.
- Added accessible names to settings, goals, language, hotkey, and session-edit dialogs and their icon-only close buttons.
- Updated regression coverage for version 1.5.x, single-season shows, explicit movie/episode routes, unrelated metadata, storage privacy, and prompt navigation.

## What changed in version 1.5.1

- The "TV Show or Movie?" prompt and the language-confirmation prompt now read as a single two-step flow ("Step 1 of 2" / "Step 2 of 2") when both are needed for the same title, instead of two unrelated-looking popups.
- Added a console.debug log showing which content-type tier matched and the raw evidence (og:type value or ld+json @type/name), to help diagnose false positives from third-party page metadata.

## What changed in version 1.5.0

- Fixed movie vs. TV show detection incorrectly falling back to "movie" whenever season/episode text wasn't found on the page (e.g. single-season shows).
- Added a universal Open Graph / JSON-LD content-type detector as a second detection tier, with live re-checks as streaming SPAs update the page.
- Added a one-time "TV Show or Movie?" prompt, matching the existing confirmation card, for the rare titles neither automatic tier can resolve. The answer is remembered per title so it is never asked twice.

## What changed in version 1.4.2

- Split Weekly immersion and Total source score into separate Insights cards so weekly and lifetime data cannot be confused.
- Expanded the weekly chart to the full card width.
- Total source score is explicitly labelled as all-time history and now lists every recorded general source rather than only the top five.

## What changed in version 1.4.1

- Fixed Sync now doing nothing when no monthly record was marked dirty.
- Manual Sync now always writes the cumulative lifetime source score and updates the last-saved timestamp.
- Added a clear Settings error when Chrome Sync is unavailable or over quota.
- Confirmed that Total source score is lifetime data and is not limited by the six-month per-day source-detail window.

## What changed in version 1.4.0

- Readable video, movie, series, and channel titles are now limited to the latest ten History entries; sessions beyond that count are removed regardless of age.
- Remembered language decisions now use opaque hashed identifiers, and older readable decision keys are removed from Chrome Sync during the privacy migration.
- Daily active/passive totals, source breakdowns, and streak dates remain locally until the user resets them or removes the extension.
- Added a cumulative Total source score to Insights without storing viewing titles; values switch from minutes to hours after 360 minutes.
- Manual timer checkpoints now split correctly at midnight so both dates and streak calculations receive the right time.
- Local write failures return an explicit error and display a warning in the popup instead of failing silently.
- Added cumulative source-total Sync snapshots and expanded regression coverage for privacy compaction, History limits, midnight boundaries, and storage errors.

## What changed in version 1.3.9

- Added local and Chrome Sync storage usage to Tracker Settings.
- Added unlimited local-storage permission for long-term immersion history.
- Detailed session and source history is retained for two months; older days keep active/passive totals and dates so lifetime totals and streaks remain intact.
- Compacted daily totals remain available in CSV exports.
- JSON backup restores now replace stale synchronized device snapshots to prevent doubled totals after recovery.
- Storage maintenance runs at most once per day and future state updates recover cleanly after a failed write.

## What changed in version 1.3.8

- Goal progress now hides the Month and Year period buttons unless their optional goals are enabled.
- Visible period buttons remain grouped against the right edge and automatically close the gaps left by hidden options.
- Disabling the currently selected Month or Year goal safely returns Goal progress to Day.

## What changed in version 1.3.7

- Added a date picker to Manual > Quick add, defaulting to today.
- Completed immersion can now be recorded for an earlier day so its totals, calendar activity, and goal streaks are credited to the correct date.
- Future and invalid dates are rejected, while repeated entries keep the selected date for faster backfilling.

## What changed in version 1.3.6

- Removed the redundant Ready/Active/Passive pill from the popup header beside PayPal.
- Kept the manual-timer status and all on-video tracking indicators unchanged.

## What changed in version 1.3.5

- Fixed the small on-video status position: its default is now the top-right of the page beneath Chrome's toolbar, and a dragged custom position is remembered across videos and reloads.
- Migrated the accidental legacy top-left position back to the new top-right default.
- Added a Reconnect tracker action when an already-open playback tab has an obsolete content script after an extension install or update.
- Strengthened active/passive classification by combining Chrome tab/window focus with the playback page's visibility and focus signals.
- Added immediate focus, blur, and visibility status updates so active tracking resumes promptly after closing the extension popup or returning to YouTube.

## What changed in version 1.3.4

- Added a compact sun/moon theme toggle to the fixed popup header so Light and Dark modes can be switched without opening Settings.
- Prevented an older four-second dashboard refresh from reverting a newly selected theme.
- Tightened header spacing so the language, status, PayPal, theme, and Settings controls all remain visible.

## What changed in version 1.3.3

- Added a saved Light/Dark appearance selector to Tracker Settings with sun and moon controls.
- Kept the existing dark appearance as the default and added a complete light palette for the dashboard, cards, charts, forms, dialogs, onboarding, and tutorial.
- Theme changes apply immediately without reloading and do not affect immersion history.

## What changed in version 1.3.2

- Fixed the real Chrome extension popup collapsing into a very narrow column because of circular viewport-relative intrinsic sizing.
- Restored a reliable 500 px extension popup canvas while keeping all content and controls constrained inside it.

## What changed in version 1.3.1

- Connected the PayPal support button to `https://paypal.me/ImmersionTrack`.
- Added a self-only Content Security Policy and disabled operation in incognito windows.
- Restricted background messages to this extension and stopped accepting caller-supplied tab IDs.
- Added a 5 MB backup-import limit and spreadsheet-formula protection for CSV exports.
- Added a Chrome Web Store privacy policy describing local storage, Chrome Sync, supported-site access, and Limited Use compliance.

## What changed in version 1.3.0

- Added automatic-session support for Disney+, Prime Video and Amazon Video, Hulu, Max, Apple TV+, Paramount+, Peacock, Crunchyroll, HIDIVE, and Tubi.
- Added reusable streaming-site route, title, series, season, and episode detection.
- Streaming services now use selected audio-track evidence only. Subtitle and caption selections never confirm a streaming session.
- When a service exposes a reliable selected audio language, matching target-language audio starts tracking automatically and known other-language audio prevents tracking.
- When selected audio metadata is unavailable, playback asks for a manual target-language decision instead of silently ignoring the video.
- Manual streaming decisions are remembered per movie or per series season, so later episodes in the same season inherit the choice.
- A newly exposed or changed selected audio track overrides a remembered manual decision, preventing a different-language dub from being counted accidentally.
- Added a first-install setup for target language, daily/weekly goals, notifications, and the streaming audio rules.
- Added a six-step guided popup tutorial plus a replay button in Tracker Settings.
- Weekly active/passive bars now scale against the configured daily goal instead of the busiest day, and hover text shows exact active, passive, total, and goal durations.
- Show status now opens a useful prompt even while an unconfirmed video is paused, checking, rejected, or waiting to play.
- Expanded Netflix selected-audio detection for checked/selected player menu items and added a clear prompt to briefly open Audio & Subtitles when Netflix keeps that metadata out of the page.
- Changed passive tracking in the on-video UI from blue to the same orange used by the dashboard; minimized badge colors are green for active, orange for passive, and grey for inactive.
- Simplified the minimized session badge: hovering no longer reveals quick-action buttons, and clicking it only opens the full status view.
- Made the tutorial a compact sticky panel above the scrollable dashboard, removed the blocking dim layer, and changed highlighted controls from blue to high-visibility orange.
- Added tutorial guidance for the minimized session colors and YouTube's remembered Always count channel greenlight.
- Added Goals directly below Video overlay in the top-right Tracker Settings menu and made Export JSON, Export CSV, and Import equal-sized controls.
- Removed the duplicate Goals entry from Manual and simplified the Tracker Settings shortcuts to two compact buttons.
- Improved spacing and alignment throughout the goal editor, including the monthly and yearly controls.
- Fixed the popup header and Tracker/Insights/Manual navigation to the top while dashboard content scrolls independently.
- Made the tutorial span the full popup width and added a weekly-review explanation.
- Changed the passive `P` extension badge from blue to orange.
- Kept all storage local/Chrome Sync based; no database or backend changes were added.

## What changed in version 1.1.0

- Reorganized the popup into focused Tracker, Insights, and Manual tabs.
- Replaced stacked goal bars with one daily/weekly/monthly/yearly progress ring.
- Splits the ring into green active immersion and orange passive immersion, with the unfilled target shown separately.
- Added clear active/passive chart legends and calendar-state legends.
- Upgraded the draggable video timer with direct Record/Pause control and expandable Manual timer, Full status, and Hide UI actions.
- Keeps automatic capture from overlapping with a newly started manual timer.
- Preserved multi-language detection, editable local history, notifications, backups, hotkeys, Chrome Sync, and optional monthly/yearly goals.
- Added descriptive Action fields and reusable Category dropdowns for manual tracking.
- Added Reading, Listening, Writing, Speaking, Watching, Vocab, and Grammar defaults plus locally saved custom categories.
- Goal values above 300 minutes now use compact hour formatting, such as `6h`.
- Added a small PayPal support button linked to the project's PayPal.Me page.
## Choosing a language

Use the compact target-language dropdown beside the hotkey button in the popup header.

The built-in list covers common languages. Select Other / custom language for any language not listed, then enter:

- a readable name, such as `Georgian`;
- a valid language code, such as `ka`.

Totals shown in the dashboard belong only to the selected language. If a manual timer is already running when the target changes, that timer stays assigned to the language under which it started.

## Detection strategy

For YouTube, the extension checks language evidence in this order:

1. selected or default audio-track metadata;
2. YouTube audio-language hints;
3. automatic speech-caption language;
4. selected caption language;
5. cautious title, source, and comment-script evidence.

Reliable target-language audio or automatic speech captions can confirm the language automatically. Reliable evidence that the primary language is different suppresses the prompt.

For languages with distinctive writing systems, title and comment text can provide weaker candidate evidence. For languages sharing the Latin alphabet, such as Swedish, English, Spanish, and French, text alone is not reliable enough, so audio and caption metadata are prioritized.

On streaming services, selected audio-track metadata is the strongest signal. Subtitles, captions, page text, and title scripts are intentionally ignored as proof of spoken language. If selected audio is unavailable, the extension asks whether the current video is in the target language and remembers that exact choice. When a service exposes strong related-video metadata, the user can explicitly choose to reuse the answer for related episodes or videos. A selected audio track always takes priority over remembered choices.

**Fully manual counting** is available in Tracker Settings for users who prefer complete control. It skips language checks and treats every eligible video on a supported playback page as the selected target language until the setting is turned off. It does not bypass the normal audible-playback, ad, pause, or idle safeguards.

On YouTube, when evidence suggests the target language but does not prove the spoken language, the extension asks whether the video is mostly in the selected target language. When there is no target-language evidence, it stays silent. The popup's Count as button remains available for manual correction.

The extension does not capture or transcribe audio. Detection accuracy depends on metadata exposed by YouTube or the current streaming player interface.

## Supported automatic video pages

YouTube tracking is limited to real video routes:

- `/watch`
- `/shorts/`
- `/live/`
- `/embed/`

Supported streaming services:

- Netflix
- Disney+
- Prime Video and Amazon Video
- Hulu
- Max
- Apple TV+
- Paramount+
- Peacock
- Crunchyroll
- HIDIVE
- Tubi

Known playback routes are recognized directly. A large, audible, actively playing video is also accepted on supported service domains as a fallback when a provider changes its player URL.

Language detection begins only after a real main video element is playing.

## Counting rules

Time counts while the confirmed target-language video:

- is playing and advancing;
- has audible sound;
- is not paused, ended, seeking, or buffering;
- is not showing a detectable YouTube advertisement;
- is not manually paused in the tracker.

Active means the video tab is selected and its Chrome window is in the foreground. Passive means confirmed audible playback continues in the background. The extension popup and video overlay do not need to remain open.

## Manual immersion

The manual timer and completed-immersion form separate an Action (what you did) from a Category (how you immersed). Built-in categories cover Reading, Listening, Writing, Speaking, Watching, Vocab, and Grammar. Select Add custom category to save another category locally for reuse. Example text in Action fields is a placeholder only and is never recorded as real activity.

The timer keeps running after the popup closes and checkpoints every minute. It pauses automatically when the computer is idle or locked.

Add completed immersion records a finished duration immediately. Both tools assign time to the target language selected when the entry or timer starts.

## Goals

Daily and weekly goals are shown by default at 360 and 900 minutes. Monthly and yearly goals are optional and hidden until enabled.

Goal totals include automatic tracking, completed custom entries, and the uncommitted part of a running manual timer when that timer belongs to the currently selected language. Tracker Settings can make goals use active time only or active and passive time together. A separate Goal Progress preference controls which active/passive detail rows are visible without hiding either type from Insights.

When notifications are enabled, Chrome sends goal-complete notifications once when an enabled goal is reached. It also sends a weekly review every Sunday at 20:00 local time for the currently selected target language, showing recorded minutes against the weekly goal.


## Full dashboard

Use **Dashboard** in the popup header, the extension's Options page, or assign the **Open the full immersion dashboard** command at `chrome://extensions/shortcuts`. The dashboard reads and updates the same local extension state as the popup.
## Chrome Sync and local data

Complete history remains local in extension storage. Compact recent daily records, remembered language decisions, and goal preferences use `chrome.storage.sync` when Chrome Sync is enabled.

Cross-device daily aggregates retain the most recent twelve months. The extension does not require Supabase, a custom account, or another external database.

Different browser brands do not share Chrome Sync. A separate backend would be needed later for custom accounts or Chrome-to-Firefox/Edge/Brave synchronization.

## Migration from version 0.5

Existing records and remembered decisions are treated as Japanese because previous versions tracked Japanese only. No history is deleted.

The extension continues using its original internal storage keys so an update can find and migrate the existing data.

## Keyboard shortcuts

- `Alt+Shift+M`: start or pause the manual timer.
- `Alt+Shift+P`: pause or resume automatic video tracking.
- `Alt+Shift+O`: expand or minimize the video status timer.
- `Alt+Shift+H`: open the hotkey guide.

On macOS the defaults use Command+Shift. Chrome may leave conflicting shortcuts unassigned; use the Hotkeys window to inspect or manage them.

## Install or update

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load or reload this extension folder.
4. Refresh any open YouTube or supported streaming tabs.
5. Open the extension and select the target language.
