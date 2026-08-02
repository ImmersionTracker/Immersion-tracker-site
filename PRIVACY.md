# Privacy Policy for Language Immersion Tracker

Effective date: July 18, 2026

Language Immersion Tracker records active and passive language-immersion time on supported video websites and from entries that the user adds manually. This policy explains the information the extension handles and how it is used.

## Information handled

To provide its tracking features, the extension processes limited information from supported video pages:

- the supported service and current video page;
- the video, related-content group, or channel identity needed to remember a user-approved language decision;
- selected audio-language and caption metadata exposed by the video player;
- playback, sound, tab-focus, window-focus, mute, and computer-idle state; and
- time recorded as active or passive immersion.

The extension also handles information entered directly by the user, including target-language choices, goals, manual timer entries, custom categories, settings, and imported backup data.

If **Fully manual counting** is enabled, eligible playback on supported video pages is counted toward the selected target language without checking or remembering that video's language. The normal playback, sound, focus, idle, and active/passive rules still apply.

The extension does not capture or transcribe audio, read passwords or payment information, access cookies, or inspect pages outside the supported video services listed in its manifest.

## How information is used

The information is used only to:

- determine whether eligible target-language playback should be recorded;
- calculate immersion totals, goals, streaks, history, and notifications;
- remember user-approved language decisions for exact videos, channels, and explicitly approved related-content groups;
- synchronize supported tracker data between the user's Chrome installations when Chrome Sync is enabled; and
- provide user-requested JSON and CSV backup import and export.

## Storage and sharing

Complete tracker history and settings are stored in Chrome extension storage on the user's device. Compact daily totals, remembered language decisions, goal settings, and reset markers may be stored through `chrome.storage.sync` so Chrome can synchronize them between the user's signed-in Chrome installations. Chrome Sync is operated by Google and is subject to the user's Chrome and Google account settings.

Language Immersion Tracker has no developer-operated backend, analytics service, advertising SDK, payment integration, or database. The developer does not receive, sell, rent, or share tracker data. The dashboard and popup read the same data directly from extension storage.

## Data control and retention

Daily active/passive totals, their dates, and source breakdowns remain on the device until the user edits them, uses **Reset all data**, or removes the extension. These daily records contain only date, language, general source, active time, passive time, and session count—not titles or URLs. Readable video, channel, and manual-action titles are limited to the latest ten History entries, regardless of their age; older readable sessions are removed. Remembered exact-video, channel, and related-content language choices use opaque hashed identifiers rather than readable titles. Unconfirmed playback time exists only in memory while a language question is awaiting an answer and is discarded if the user rejects it or leaves the video. Cumulative source totals contain only general sources such as YouTube, Netflix, reading, or listening. Users can export their data as JSON or CSV. To ensure synchronized copies are cleared, users should use **Reset all data** before uninstalling the extension.

## Security

The extension uses Chrome's Manifest V3 security model, executes only code packaged with the extension, restricts its website access to declared supported video services, and does not send tracker data to developer-controlled servers.

## Limited Use disclosure

Language Immersion Tracker's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Such information is used only to provide or improve the extension's user-facing immersion-tracking features. It is not used for advertising, creditworthiness, lending, or sale to third parties, and is not made available for humans to read except when the user explicitly supplies specific information for support or when required by law or security needs.

## Changes and contact

Material changes to this policy will be published with an updated effective date. Questions can be submitted through the support channel on the extension's Chrome Web Store listing.
