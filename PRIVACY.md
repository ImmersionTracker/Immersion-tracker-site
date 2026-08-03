---
title: Privacy Policy for Language Immersion Tracker
---

# Privacy Policy for Language Immersion Tracker

Effective date: August 3, 2026

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

If **Automatic** is selected instead of a specific target language, the extension identifies the spoken language of each video from the audio-language and caption metadata the player already exposes, and records the time under the language it identifies. It does not capture, transcribe, or analyse audio to do this. When the player exposes nothing usable, the extension asks the user which language to count the video as, and remembers that answer for the exact video or the channel using the same opaque hashed identifiers described under **Data control and retention**.

The extension does not capture or transcribe audio, read passwords or payment information, access cookies, or inspect pages outside the supported video services listed in its manifest.

## How information is used

The information is used only to:

- determine whether eligible target-language playback should be recorded;
- calculate immersion totals, goals, streaks, history, and notifications;
- remember user-approved language decisions for exact videos, channels, and explicitly approved related-content groups, including which language the user chose to count a video as in Automatic mode;
- synchronize supported tracker data between the user's Chrome installations when Chrome Sync is enabled;
- synchronize the same privacy-minimal daily-totals data to the user's own account when the user chooses to create an account and turn on cloud sync (see below); and
- provide user-requested JSON and CSV backup import and export.

## Storage and sharing

Complete tracker history and settings are stored in Chrome extension storage on the user's device. Compact daily totals, remembered language decisions, goal settings, and reset markers may be stored through `chrome.storage.sync` so Chrome can synchronize them between the user's signed-in Chrome installations. Chrome Sync is operated by Google and is subject to the user's Chrome and Google account settings.

Language Immersion Tracker has no advertising SDK and no payment integration. It does not sell, rent, or share tracker data with third parties. The dashboard and popup read the same data directly from extension storage. The extension's optional account and cloud-sync feature and its optional product analytics are each described in their own sections below. Both are off unless the user turns them on, and each is controlled independently of the other.

## Optional account and cloud sync

Signing in is never required. Local tracking, goals, history, and exports work fully without an account, and continue to work exactly the same way if an account is never created, is signed out of, or its free sync trial ends.

If the user chooses to create an account, the extension uses [Supabase](https://supabase.com) - a third-party authentication and database provider - to handle sign-in. Supabase stores the account's email address and authentication credentials; the extension itself never stores or has access to the account password beyond forwarding it to Supabase's sign-in request.

Turning on cloud sync starts a one-time, three-month free trial. During that trial, the extension uploads the same privacy-minimal daily totals described in "Data control and retention" - date, language, general source category, active seconds, passive seconds, and session count - tagged with a random per-device identifier (not a hardware identifier) so totals from multiple devices can be combined. As with local storage, **no video or channel titles, URLs, search terms, subtitle or page text, or manual-entry descriptions are ever uploaded.** The device's local copy of this data remains the primary copy at all times; cloud sync only mirrors it. If the trial ends or sync is turned off, local tracking is unaffected and continues permanently - only the cloud copy stops receiving updates.

Cloud data is protected by Supabase Row Level Security so that an account can only ever read or write its own rows; the extension never embeds a Supabase service-role key, which would bypass that protection. You can permanently delete your account and everything stored in cloud sync yourself at any time from the full dashboard's Account, Plan & Data section - this calls a database function that only ever deletes your own account (never anyone else's) and immediately removes your profile, devices, and cloud-stored daily totals along with it. Deleting your account never affects your local tracking history on the device you delete it from.

## Optional product analytics

The extension includes optional, consent-based product analytics to help improve the extension. **It is off by default and stays off until turned on in Tracker Settings**, entirely independently of cloud sync - turning one on has no effect on the other. If turned on, each anonymous event contains only: target language, platform (e.g., YouTube or Netflix), active/passive duration, broad content type, date, and extension version. It never includes titles, URLs, searches, subtitles, page text, or manual-entry descriptions, and it never includes an account id, a device id, or any other identifier - an analytics event cannot be linked to a person, a device, or to other events from the same install.

If turned on, events are sent to a dedicated table in the same Supabase project used for cloud sync, using only the public anon key. That table accepts inserts only - it grants no read, update, or delete access to anyone, including a signed-in user's own client, so the extension itself has no way to read analytics data back.

## Data control and retention

Daily active/passive totals, their dates, and source breakdowns remain on the device until the user edits them, uses **Reset all data**, or removes the extension. These daily records contain only date, language, general source, active time, passive time, and session count—not titles or URLs. Readable video, channel, and manual-action titles are limited to the latest ten History entries, regardless of their age; older readable sessions are removed. Remembered exact-video, channel, and related-content language choices use opaque hashed identifiers rather than readable titles, including the answers given to Automatic mode's language question, which store only the hashed identifier and the chosen language. Unconfirmed playback time exists only in memory while a language question is awaiting an answer and is discarded if the user rejects it or leaves the video. Cumulative source totals contain only general sources such as YouTube, Netflix, reading, or listening. Users can export their data as JSON or CSV. To ensure synchronized copies (Chrome Sync and, if used, cloud sync) are cleared, users should use **Reset all data** before uninstalling the extension.

The extension's popup and dashboard include an optional "Donate" link to the developer's PayPal.me page. Following it opens PayPal in a new tab; the extension does not send any tracker data to PayPal, and use of that site is subject to PayPal's own privacy policy.

## Security

The extension uses Chrome's Manifest V3 security model, executes only code packaged with the extension, restricts its website access to declared supported video services, and does not send tracker data to developer-controlled servers other than the user's own account on the optional cloud-sync provider described above.

## Limited Use disclosure

Language Immersion Tracker's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Such information is used only to provide or improve the extension's user-facing immersion-tracking features. It is not used for advertising, creditworthiness, lending, or sale to third parties, and is not made available for humans to read except when the user explicitly supplies specific information for support or when required by law or security needs.

## Changes and contact

Material changes to this policy will be published with an updated effective date. Questions can be submitted through the support channel on the extension's Chrome Web Store listing.
