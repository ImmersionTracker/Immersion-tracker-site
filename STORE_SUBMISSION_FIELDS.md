# Chrome Web Store — paste-ready dashboard fields (v1.9.4)

Every block below is final text for one field in the Developer Dashboard.
Copy the text between the rules; don't paste the headings.

Field structure verified against the current Chrome for Developers docs for the
Store listing, Privacy practices, Distribution, and Test instructions tabs.

Anything marked **DECIDE** needs your input and is not something I can fill in.

---

## Tab 1 — Store listing

### Item name (26 / 75 characters)

```
Language Immersion Tracker
```

### Short description (106 / 132 characters)

```
Track active and passive language immersion, goals, streaks, manual entries, and supported video sessions.
```

### Detailed description

```
Language Immersion Tracker helps you build a consistent language-learning habit by tracking the time you spend immersed in your target language.

It can automatically track supported videos and streaming sessions when it recognizes that the spoken language matches your choice. If it cannot tell, it asks you to confirm and remembers the choice to reduce repeated questions. An optional fully manual mode can count every eligible video on supported playback pages as your selected language.

See active and passive immersion separately, choose whether goals use all immersion or active time only, maintain streaks, add missed time manually, and review your progress on a full-page dashboard with a calendar, weekly immersion view, and scrollable history. Each target language keeps its own progress. Pro Analytics — deeper trend, streak, and source breakdowns — is unlocked for everyone during this beta.

The extension also includes reminders, JSON/CSV backup and import, optional Chrome Sync, and Light and Dark modes. It's completely free, with no ads and nothing to buy.

Your tracker data stays in your browser, optional Chrome Sync, and — only if you choose to create a free account — your own cloud account, protected by row-level security so nobody else can read or write it. The extension also offers optional, consent-based product analytics: off by default, controlled separately from cloud sync in Tracker Settings, and limited to your target language, platform, active/passive duration, broad content type, date, and extension version. It never includes titles, URLs, searches, subtitles, page text, manual-entry descriptions, or any account or device identifier.

If you'd like to support development, an optional "Donate" link is available in the popup. It simply opens PayPal in a new tab and never shares your tracker data.
```

### Category

**DECIDE.** `Productivity` is the closest fit for a time-tracking habit tool.
`Education` is defensible given the language-learning purpose. Pick one — it
affects discovery, not approval.

### Language

```
English
```

### Graphic assets — files you already have

| Asset | Requirement | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon128.png` |
| Screenshots | 1280×800, 1–5 | `store-assets/output/01-…` through `05-…` (all five verified 1280×800) |
| Small promo tile | 440×280 | `promopicutres/New Project.png` (verified 440×280) |
| Marquee promo tile | 1400×560 | **Missing** — explicitly optional |
| Promo video | YouTube URL | **None** — leave blank |

The listing docs list the promo video alongside the required assets, but there's
no 1400×560 marquee in the repo either and that one is called out as optional.
If the dashboard blocks submission on a missing video, tell me and we'll deal
with it then rather than making a video pre-emptively.

### Additional URLs

- **Homepage URL** — `https://immersiontracker.github.io/Immersion-tracker-site/`
- **Support URL** — **DECIDE.** Leave blank and rely on the store's built-in Support hub, or add a contact page to the site repo. Don't point this at a repo whose URL carries your surname.
- **Official URL** — leave blank; requires Search Console domain verification.
- **Mature content** — leave unchecked.

---

## Tab 2 — Privacy practices

### Single purpose description

```
Track active and passive target-language immersion time from supported video playback and from activities the user adds manually.
```

### Permission justifications

One field per permission — six fields, matching the manifest.

`"windows"` used to be declared and is now removed: Chrome has no such
permission, `chrome.windows` is reached through `"tabs"`, and the dashboard
never asked for a justification for it.

**storage**

```
Saves the user's tracker history, target languages, goals, remembered language decisions, and preferences. Also backs the optional Chrome Sync feature so a user's own settings and compact daily totals follow their signed-in Chrome installations.
```

**unlimitedStorage**

```
Preserves long-term daily totals and per-source breakdowns beyond Chrome's default local quota, so a user tracking daily for years does not silently lose history. Storage stays compact because readable titles are capped at the ten most recent History entries; older entries keep only counts and durations.
```

**tabs**

```
Reads the active tab's URL, active state, and muted state on the supported video services declared in the manifest, so playback can be classified as active or passive immersion. Also used to message the content script on those pages and to open the extension's own dashboard and shortcut pages when the user requests them.
```

**alarms**

```
Checkpoints the manual immersion timer so time is not lost if the service worker is suspended, retries Chrome Sync writes, and schedules the optional weekly review notification.
```

**idle**

```
Pauses tracking when the computer is idle or locked, so time is not credited while the user is away from the machine.
```

**notifications**

```
Shows the goal-completion and weekly-review notifications that the user has explicitly enabled in settings. No notification is shown unless the user turns it on.
```

**Host permission justification** — the dashboard provides a *single* field for
all host permissions, not one per host, and caps it at 1,000 characters. The
following covers both the streaming hosts and Supabase in 996 characters.

```
The streaming-service hosts are read only for playback state, content identity, and the audio/caption language metadata the player exposes, in order to decide whether playback counts as target-language immersion and to remember a user-approved language decision for that video or channel. No page content is read on any other site.

https://*.supabase.co/* is contacted only if the user opts in, in one of two independent ways. If the user creates a free account and turns on cloud sync, it receives that user's own daily totals: date, target language, general source, active seconds, passive seconds, and session count, protected by row-level security, with no service-role key embedded. Separately, a setting that is off by default sends anonymous analytics events carrying seven fields and no account, device, or session identifier. Neither path ever sends titles, URLs, searches, subtitles, page text, or manual-entry descriptions. If the user opts into neither, this host is never contacted.
```

### Remote code

Select **"No, I am not using remote code."**

Justification, if a field is offered:

```
All executable code ships inside the extension package. The content security policy is restricted to script-src 'self', no script tag loads a remote URL, and the extension does not call eval. This is enforced by an automated release check.
```

### Data usage — disclosure checkboxes

Tick these four:

- **Personally identifiable information** — only if the user creates an optional account, in which case Supabase holds their email address.
- **User activity** — observes playback, focus, mute, and idle state to classify time.
- **Website content** — reads video titles and player language metadata on supported services.
- **Web history** — the History feature stores readable video and channel titles with the times they were watched, and the extension reads supported video URLs. The checkbox reads "page title and time of visit", which is literally what a History entry is.

Leave unticked: health information, financial and payment information, authentication information, personal communications, location.

> Two judgement calls, both resolved toward disclosing.
>
> **PII:** the extension itself never stores an email — it forwards sign-in to Supabase. But an optional account means an email exists in a system you control.
>
> **Web history:** easy to talk yourself out of, since nothing leaves the device and the cloud/analytics payloads carry no titles or URLs. But the disclosure covers what the extension *collects*, not only what it uploads, and `"tabs"` alone makes Chrome warn users "Read your browsing history." Ticking it costs nothing; a reviewer noticing an undisclosed History list of watched titles and times costs a rejection.

### Data usage — certification checkboxes

Tick all three:

- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```
https://immersiontracker.github.io/Immersion-tracker-site/privacy
```

Served from the separate `Immersion-tracker-site` repo, so no personal name
appears in the URL and this extension repo does not need to be public.

**The hosted copy must match `PRIVACY.md` in this repo.** As of the last check
the live page was still the July 17 version, which stated the extension had "no
developer-operated backend, analytics service, advertising SDK, or database" —
untrue since v1.9.2. Re-read the live URL and confirm it carries the current
effective date and the cloud-sync, analytics, and account-deletion sections
before submitting. Nothing automated can catch this drift: the release checks
only see the local file.

---

## Tab 3 — Distribution

- **Visibility** — start with **Unlisted** (or Private with a tester list). Go Public only after real-service testing.
- **Payments** — free, no in-app purchases. The PayPal link is a donation, not a purchase.
- **Regions** — all regions, unless you want otherwise.
- **Trader status** — **DECIDE.** Declaring Trader publicly displays your name, address, email, and phone in the EU. Non-Trader is normally correct for an unpaid personal project that sells nothing; donations are typically not by themselves trading. This has legal consequences, so verify it against Google's own trader guidance rather than taking my word for it — I'm not a lawyer.

---

## Tab 4 — Test instructions

```
Local tracking works immediately with no account. Sign-in, cloud sync, and analytics are all optional and independent of each other.

1. Install and complete first-run setup, choosing a target language.
2. Open a YouTube video and start playback.
3. If automatic language metadata is unavailable, press "Count as [language]", or open "Show status" and confirm there.
4. Confirm foreground playback records active time and background audible playback records passive time.
5. Optionally open another supported streaming service. Note that logged-in subscription content may be required, and that the extension asks for confirmation when it cannot identify the spoken language.
6. Open the popup's Manual tab to test the persistent timer and a completed manual entry.
7. In Tracker Settings, test Fully manual counting, the goal contribution options, Light and Dark modes, notifications, JSON/CSV backup and import, Chrome Sync, and the tutorial. Confirm the analytics consent toggle is off by default and that turning it on or off has no effect on cloud sync.
8. Open Account & Plan and optionally create a free account, to confirm sign-in and cloud sync are optional, clearly labelled, and never required for local tracking.
9. While signed in, open the full dashboard's "Account, Plan & Data" section and confirm a "Delete account" control is present and requires confirmation. Exercising it removes the cloud account and its synced data without affecting local tracking history on the device.

No test credentials are needed. Any email address can create a free account in step 8.
```

---

## AI disclosure

The extension calls no AI service and sends no user data to a model; its language
checks are local deterministic metadata and text heuristics. If asked about
AI-powered product functionality, answer based on shipped behaviour: this release
contains no AI-powered feature.

---

## Before you hit submit

- [ ] `npm test` passes on your machine, including the two Playwright UI suites
- [ ] Manual QA walked, including one real account deletion end to end
- [ ] Privacy URL loads in a private window **and** its text matches this repo's current `PRIVACY.md`
- [ ] `release/Language-Immersion-Tracker-1.9.4.zip` uploaded — the refreshed one, whose bundled PRIVACY.md matches the hosted policy
- [ ] Visibility set to Unlisted or Private, not Public
