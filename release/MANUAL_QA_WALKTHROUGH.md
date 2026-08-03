# Manual QA walkthrough — v1.9.4

What `npm test` cannot check. The Playwright suites load the dashboard and popup
as plain web pages against fixtures: no real extension, no `chrome.*` APIs, no
Supabase, no video playing. Everything below exists because automation can't
reach it.

Budget about 60–75 minutes. Work top to bottom — later sections assume earlier
ones passed, and the destructive tests are deliberately last.

**Before you start:** have a throwaway email you can receive mail at. Section 7
creates a real account and section 8 permanently deletes it.

---

## 0. Setup

- [ ] `chrome://extensions` → enable **Developer mode**
- [ ] Create a clean Chrome profile (avoids old tracker data confusing results)
- [ ] **Load unpacked** → select the repo folder
- [ ] Note the extension ID; confirm no errors appear under the card
- [ ] Click **Errors** if shown — the manifest should load with no warnings

> Load the *folder*, not the zip. If you want to test the actual package, unzip
> `release/Language-Immersion-Tracker-1.9.4.zip` to a temp folder and load that.
> Worth doing once at the end, since the zip is what Google receives.

---

## 1. Onboarding — first run

Onboarding is six steps (0–5). Fresh install should open it automatically.

- [ ] **Step 0** Welcome — "Set up your immersion tracker"
- [ ] **Step 1** Target language — pick a language; try **custom language** too (name + code)
- [ ] **Step 2** Goals — set a daily and weekly goal
- [ ] **Step 3** Free & Pro — confirm the table shows Pro as included during beta, and that **nothing is locked or asks for payment**
- [ ] **Step 4** How tracking works — explains subtitles never prove spoken language
- [ ] **Step 5** Optional analytics — **"Share anonymous usage analytics"**

**Critical on step 5:**

- [ ] The checkbox is **unticked by default**
- [ ] You can finish onboarding without touching it
- [ ] **Back** works from step 5 without losing earlier answers

Then re-test the other path:

- [ ] Reinstall (remove + load unpacked again), and this time use **Set up later**
- [ ] Confirm the extension still tracks afterwards with no language chosen, or prompts you to choose one

---

## 2. Core tracking — the actual product

This is the part with no automated coverage at all.

- [ ] Open a YouTube video in your target language, press play
- [ ] Open the popup → **Tracker** tab → time is accumulating
- [ ] If asked, press **Count as [language]** (or **Show status** → confirm)
- [ ] **Active:** keep the window focused → active seconds climb
- [ ] **Passive:** switch to another window, leave audio playing → passive seconds climb, active does not
- [ ] **Muted:** mute the tab → tracking stops
- [ ] **Paused:** pause the video → tracking stops
- [ ] **Idle:** leave the machine untouched past the idle threshold → tracking stops
- [ ] Press **Not target** on a video → that time is discarded, not recorded
- [ ] Reopen the same video → the remembered decision applies without asking again

Then one non-YouTube service (Netflix, Crunchyroll — whatever you subscribe to):

- [ ] Playback is detected and time accrues
- [ ] If the language can't be identified, it asks rather than guessing

**Across midnight** (or set your clock forward):

- [ ] Time recorded either side of midnight lands on the correct days

---

## 3. Manual timer

- [ ] **Manual** tab → **Start timer** → counts up
- [ ] **Pause timer** → stops
- [ ] Close the popup while running, reopen → still running with correct elapsed time
- [ ] Complete an entry with a category → appears in History
- [ ] Hotkey `Alt+Shift+M` starts/pauses the timer

Other hotkeys: `Alt+Shift+P` (pause video tracking), `Alt+Shift+O` (status
overlay), `Alt+Shift+H` (shortcut guide).

---

## 4. Layout — verify this release's three fixes

These were fixed this cycle and are only assertion-verified, never eyeballed.
Use **Settings → Add random immersion (test data)** to populate the calendar
quickly.

- [ ] **Dashboard → Settings**, window at 1280×800 → the view **does not scroll vertically**, and the Account card's Delete account button is fully visible
- [ ] **Dashboard → Overview** → the Consistency calendar's legend sits **inside** the card, not clipped at the bottom edge
- [ ] Seed enough data to complete a weekly goal, then compare the **popup** calendar and the **dashboard** calendar:
  - [ ] A weekly-goal week shows a **soft amber glow**, not an underline, in **both**
  - [ ] The legend swatch for **Weekly goal met** matches the day cells in both
  - [ ] Recorded-intensity shades and the daily-goal colour match across the two
  - [ ] Check in **both dark and light mode**

> The popup's day cells are 38px with 4px gaps. If the glow bleeds between
> adjacent days and looks muddy, say so — the underline can be restored on both
> surfaces instead.

Also:

- [ ] History shows five entries normally, and ten scroll without resizing any card
- [ ] Dashboard at a narrow window width still works

---

## 5. Settings

- [ ] **Fully manual counting** — every eligible video counts as your language
- [ ] **Goal contribution** — all immersion vs active only, both behave correctly
- [ ] **Light and Dark** modes across popup and dashboard
- [ ] **Notifications** — goal completion and weekly review fire when enabled
- [ ] **Replay quick tutorial** works
- [ ] **Chrome Sync** — toggle on, **Sync now**, confirm no errors

**Analytics toggle — the independence check:**

- [ ] Settings shows **Share anonymous usage analytics** as **off** (matching what you left it at in onboarding)
- [ ] Turn analytics **on** → confirm cloud sync state is **unchanged**
- [ ] Turn cloud sync **on** → confirm analytics state is **unchanged**
- [ ] Turn analytics back **off**

---

## 6. Backup and restore

- [ ] **Export JSON** → file downloads
- [ ] **Export CSV** → file downloads, opens cleanly in a spreadsheet
- [ ] **Import** the JSON back → confirm prompt appears → totals are **unchanged**
- [ ] Spot-check that no video titles or URLs appear anywhere you wouldn't expect

---

## 7. Account and cloud sync

Use the throwaway email.

- [ ] Popup → **Account & Plan** → sign-in and cloud sync are clearly labelled **optional**
- [ ] **Sign up** → account created, confirmation mail arrives if required
- [ ] Turn on cloud sync → the **three-month free trial** starts and the remaining time is stated
- [ ] Record some immersion → confirm it uploads without error
- [ ] **Sign out** → local tracking continues completely unaffected
- [ ] **Sign back in** → data still present
- [ ] **Forgot password** → reset mail arrives, new password works
- [ ] Confirm the **Donate** button opens PayPal in a new tab and nothing else

---

## 8. Delete account — destructive, do this last

The riskiest untested path: it's irreversible, it's the newest feature, and so
far it has only been verified against the database directly, never through the
button.

- [ ] Dashboard → **Account, Plan & Data** → **Delete account** is visible while signed in
- [ ] Confirm it is **not** in the popup's Account & Plan dialog (deliberate)
- [ ] Click it → the confirmation reads *"Permanently delete your account and everything stored in cloud sync? Your local tracking history on this device is not affected, but the account itself cannot be recovered."*
- [ ] **Cancel** → nothing happens, still signed in
- [ ] Click again → **OK** → deletion succeeds with a clear message
- [ ] You are signed out
- [ ] **Local tracking history on this device is still intact** — this is the important one
- [ ] Try signing in with the deleted credentials → correctly rejected
- [ ] Local tracking still records new time normally afterwards

---

## 9. Reset all data

- [ ] Popup → **Reset all tracking data** → confirm prompt appears
- [ ] Cancel → nothing lost
- [ ] Confirm → local data cleared **and** Chrome Sync snapshot cleared
- [ ] Sign in on a second Chrome profile with sync on → confirm the reset propagated and old data does not return

---

## 10. Final pass on the real package

- [ ] Unzip `release/Language-Immersion-Tracker-1.9.4.zip` into a temp folder
- [ ] Load that unpacked in a clean profile
- [ ] Repeat §1 onboarding and §2 basic tracking only
- [ ] Confirm sign-in works — proves `config/cloud-config.json` made it into the package

---

## Cleanup before submitting

- [ ] Delete any throwaway accounts still in Supabase (§8 should have removed the one you made)
- [ ] Clear test data from your own install, or reinstall clean
- [ ] Check `analytics_events` in Supabase — rows from your own testing are verification artifacts, not real usage

---

## If something fails

Note which step, what you expected, and what happened. Layout and CSS issues
are quick to fix. Anything in §2 (tracking), §7 (account), or §8 (deletion) is a
blocker — don't submit around it.
