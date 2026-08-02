# Chrome Web Store submission notes

## Single purpose

Track active and passive target-language immersion time from supported video playback and user-added manual activities.

## Suggested short description

Track active and passive language immersion, goals, streaks, manual entries, and supported video sessions.

## Suggested detailed description

Language Immersion Tracker helps you build a consistent language-learning habit by tracking the time you spend immersed in your target language.

It can automatically track supported videos and streaming sessions when it recognizes that the spoken language matches your choice. If it cannot tell, it asks you to confirm and remembers the choice to reduce repeated questions. An optional fully manual mode can count every eligible video on supported playback pages as your selected language.

See active and passive immersion separately, choose whether goals use all immersion or active time only, maintain streaks, add missed time manually, and review your progress. Each target language keeps its own progress. The extension also includes reminders, backups, optional Chrome Sync, and Light and Dark modes.

Your tracker data stays in your browser and optional Chrome Sync. The extension has no ads, analytics, external servers, or database. Open the responsive full-page dashboard whenever you want a wider view of your progress.

## Permission justifications

- `storage`: saves tracker history, preferences, decisions, goals, and optional Chrome Sync data.
- `unlimitedStorage`: preserves long-term local daily totals and source breakdowns without reaching Chrome's default local quota; readable titles are limited to the latest ten History entries.
- `tabs`: reads the current tab's supported URL, active and muted state; communicates with the supported-site content script; and opens user-requested dashboard or shortcut pages.
- `windows`: distinguishes foreground active immersion from background passive immersion.
- `alarms`: checkpoints manual timers, retries Chrome Sync, and schedules the weekly review notification.
- `idle`: pauses eligible tracking when the computer is idle or locked.
- `notifications`: shows enabled goal-completion and weekly-review notifications.
- Supported-site host permissions: reads only the playback state, title identity, and language information needed for tracking on the supported services declared in the extension package.

## Privacy-practices declarations

Conservatively disclose that the extension handles:

- website content, because it reads video titles and player language metadata on supported services;
- web browsing activity, because it recognizes supported video URLs and remembers content identities;
- user activity, because it observes playback, focus, mute, and idle state for time classification; and
- user-provided content, because it stores target languages, goals, manual entries, categories, and imported backups.

Also certify, consistently with `PRIVACY.md`, that the data:

- is used only for the extension's single purpose and user-facing features;
- is not sold or transferred for unrelated purposes;
- is not used for advertising, creditworthiness, or lending;
- is not sent to a developer-operated server; and
- is not made available for humans to read except with specific user consent for support or when required for law or security.

Host `PRIVACY.md` at a stable public HTTPS URL and place that URL in the Developer Dashboard privacy-policy field before submission.

## Reviewer test instructions

1. Install the extension and complete first-run setup.
2. Open a supported YouTube video and start playback.
3. If automatic language metadata is unavailable, press **Count as [language]** or open **Show status** and confirm it.
4. Verify that foreground playback records active time and background audible playback records passive time.
5. Open a supported streaming-service playback page. Explain that logged-in subscription content may be required and that the extension asks for confirmation when it cannot identify the spoken language.
6. Open the popup's Manual tab to test the persistent timer and a completed entry.
7. Use Tracker Settings to test Fully manual counting, the goal contribution/detail choices, Light and Dark modes, notifications, backups, Chrome Sync, and the tutorial.

## Publisher checklist

- Register the dedicated publisher Google account and enable two-step verification.
- Choose a publisher name and verify a frequently monitored contact email.
- Declare Trader or Non-Trader accurately; EU trader information may be displayed publicly.
- Upload `release/Language-Immersion-Tracker-1.6.0.zip`.
- Do not include a manifest `key` in the Chrome Web Store package. Chrome Web Store assigns and maintains the published extension ID.
- Provide at least one real 1280x800 or 640x400 product screenshot and a 440x280 promotional image.
- Complete the Store listing, Privacy practices, Distribution, and Test instructions tabs.
- Start with Private or Unlisted trusted testing, then submit the same compliant item publicly after real-service testing.

## AI disclosure

The extension does not call an AI service or send user data to an AI model. Its language checks are local deterministic metadata and text heuristics. Current Chrome Web Store documentation does not require disclosure that an AI coding assistant helped write source code. If the dashboard later asks about AI-powered product functionality, answer based on the shipped behavior: this release does not contain an AI-powered feature. The publisher remains responsible for the extension, its code, disclosures, and policy compliance.
