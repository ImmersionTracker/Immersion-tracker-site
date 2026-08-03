# Language Immersion Tracker

A Chrome Manifest V3 extension for tracking active and passive immersion in any target language. It detects supported video playback on YouTube and major streaming services, provides a persistent manual timer for any source, tracks goals, and keeps each language's totals and remembered video decisions separate.

The extension is completely free. It includes an optional Supabase account and cloud-sync path - sign-in UI, an upload queue, a three-month free sync trial, and self-service account deletion - in `lib/account-state.js`, `lib/supabase-auth.js`, `lib/supabase-rest.js`, `lib/cloud-contract.js`, `background.js`, and `supabase/`. Signing in is never required: local tracking, goals, history, and exports work fully without an account and are unaffected if an account is never created, is signed out of, or its free sync trial ends - only the cloud mirror stops updating. It also includes optional, consent-based product analytics (off by default, independent of cloud sync, and limited to the seven fields described in `PRIVACY.md`). See `PRIVACY.md` for exactly what cloud sync and analytics do and do not send.

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
