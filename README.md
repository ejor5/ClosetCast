# ClosetCast

ClosetCast is a lightweight Windows kiosk app for an old laptop in a closet: ambient Disney/YouTube mode by default, five RTSP cameras, weather, Apple Calendar, wind-down mode, and Windows wake/sleep automation.

The Yankees stream site URL is private/local config. Put your preferred site URL in `config.json`; the public repo keeps that value blank.
For stable private links you do not want mixed into the full config, use a local `config.private.json` overlay. It is ignored by git.

## What It Does

- Starts fullscreen/kiosk when `fullscreenOnLaunch` is enabled.
- Shows five RTSP cameras: Garage, Front Yard, Back Yard, Side Yard, and Ring Doorbell.
- Supports `focus`, `split`, `grid4`, and custom five-camera layouts.
- Treats Ring like any other RTSP camera.
- Rotates local images/videos from `media/`.
- Shows weather for Almaden/Cambrian Park by default, and Los Altos on Monday/Wednesday school days.
- Shows a compact San Jose traffic summary for Hwy 85, Hwy 17, I-280, and Hwy 87 in the weather card, with a configurable live map link.
- Reads up to three Apple Calendar public `.ics` feed URLs.
- Caches calendar data so temporary network failures do not blank the dashboard.
- Rotates YouTube ambiance all day by default using direct videos and first-result topic searches, weighted toward Disney World live streams and resort TV.
- Favorite-team game mode is still available as an opt-in config path, but it is disabled by default. It checks Yankees, Angels, then Giants by default.
- Shows a 10:00 PM wind-down reminder, tomorrow's calendar events until 10:30 PM, then puts the laptop to sleep.
- Supports extra away/work sleep windows, with defaults for Tuesday/Thursday/Friday 4:00-8:00 PM and Saturday 9:30 AM-12:30 PM.
- Uses Windows Task Scheduler to wake at 9:00 AM and relaunch/focus ClosetCast, plus wake after configured away windows.
- Bridges RTSP to MJPEG with `ffmpeg` so Electron can display the camera feeds.
- Logs to `logs/closetcast.log`.

## Requirements

- Windows 10/11.
- Node.js 20 or newer.
- `ffmpeg` available on PATH, or set `ffmpegPath` in `config.json`.
- RTSP URLs for all cameras.

## Quick Setup On Another Laptop

Fastest path from a fresh Windows laptop:

1. Open PowerShell.
2. Paste this command:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ejor5/ClosetCast/main/Install-ClosetCast.ps1 | iex"
   ```

3. Let the installer check Node.js and FFmpeg, install dependencies, and open the setup wizard.
4. Paste the camera, calendar, Yankees, and power-schedule choices when prompted.
5. Start later from the Desktop shortcut or `C:\Users\<you>\ClosetCast\Start-ClosetCast.cmd`.

If you already copied or downloaded this repo on that laptop, double-click `Install-ClosetCast.cmd` to run the same installer, or double-click `Setup-ClosetCast.cmd` if dependencies are already installed and you only need to update local config.

## Setup

Fast path:

On the old Windows laptop, open PowerShell and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ejor5/ClosetCast/main/Install-ClosetCast.ps1 | iex"
```

That command downloads ClosetCast into `C:\Users\<you>\ClosetCast`, checks Node.js and FFmpeg, installs app dependencies, then opens the paste-your-links setup wizard.

Local fast path after the repo is already downloaded:

1. Double-click `Setup-ClosetCast.cmd`.
2. Paste the five RTSP camera URLs.
3. Paste up to three Apple Calendar `.ics` URLs if you want calendar events.
4. Choose whether to enable fullscreen, Yankees mode, wind-down sleep, autostart, and the 9 AM wake task.
5. Launch with `Start-ClosetCast.cmd`.

Manual path:

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create your private config:

   ```powershell
   Copy-Item config.example.json config.json
   ```

3. Edit `config.json` and replace the example RTSP URLs with your real camera URLs. Do not commit this file.

   For a smaller private links file, copy the private template instead:

   ```powershell
   Copy-Item config.private.example.json config.private.json
   ```

   Then put your RTSP URLs, Apple Calendar feeds, Yankees stream site URL, favorite Disney World live streams, resort TV links, or private media folder into `config.private.json`. ClosetCast merges it over the normal config at launch, and `config.private.json` is ignored by git.

4. Validate the config:

   ```powershell
   npm.cmd run validate:config
   ```

5. Start ClosetCast:

   ```powershell
   npm.cmd start
   ```

## Local UI Test Mode

To test the dashboard without fullscreen, autostart, wake tasks, or sleep commands:

```powershell
.\Test-ClosetCast.cmd
```

That is the easiest local test path. It asks for five RTSP links, up to three Apple Calendar links, and then writes them only to `.closetcast-test\config.test.json`. It does not edit your real `config.json`, does not reuse the production Electron profile, and `.closetcast-test\` is ignored by git.

You can also launch the test script directly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ui-test.ps1
```

That generates `.closetcast-test\config.test.json` from the example config and launches ClosetCast in a normal window. Press `F6` inside the app to cycle through:

- normal dashboard
- ambient YouTube
- favorite-team mode with an immediate configured-site Yankees-link resolver test
- wind-down mode

To start directly in one mode:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ui-test.ps1 -Mode yankees
```

Add `-UseExistingConfig` if you want the test run to use your real camera/calendar URLs while still disabling sleep/autostart behavior.

If `config.private.json` exists, UI test mode applies that private overlay first, then still disables fullscreen, autostart, wake tasks, and sleep commands for safety.

Add `-PromptForLinks` if you want the PowerShell test script to ask for RTSP and calendar links:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ui-test.ps1 -PromptForLinks -Mode yankees
```

## Camera Config

Each camera needs an `id`, `name`, `url`, `enabled`, and `priority`. The default priority is:

1. Garage
2. Front Yard
3. Back Yard
4. Side Yard
5. Ring Doorbell

The RTSP bridge starts when the dashboard asks for each camera feed. If a stream exits, the app waits briefly and reconnects while keeping the tile visible.

To test camera links without launching the full dashboard:

```powershell
npm.cmd run diagnose:rtsp
```

If you are using the safe UI test config, pass that file directly:

```powershell
npm.cmd run diagnose:rtsp -- .\.closetcast-test\config.test.json
```

## Layouts

Use the settings button, `F1`, or number keys:

- `1`: focus mode
- `2`: split mode
- `3`: four-camera grid
- `4` or `5`: five-camera mode with one large primary feed

Click any camera tile to focus it.
Click that focused camera again to return to the previous layout.

The default normal layout is not a plain grid. With local media available, ClosetCast gives media the large center stage and compresses cameras into a left-side monitor strip. Without media, it uses one large primary 7:8-ish camera tile, four smaller camera tiles around it, and a slim weather/calendar rail. Favorite-team streams stay inside the normal ambient media square, replacing YouTube ambiance while a game is live or preparing; if more than one favorite game is live, that square splits across those games. Wind-down mode promotes tomorrow's calendar events and keeps cameras visible in a compact strip.

## Local Media

Place images or videos in `media/`. Supported defaults are:

```text
.jpg, .jpeg, .png, .gif, .webp, .mp4, .webm, .mov
```

The folder is rescanned every five minutes while the app runs. Media rotates quickly by default, and the dashboard caps the display time so the wall keeps changing.

When local media is available in normal dashboard mode, ClosetCast prioritizes it visually over the cameras. Ambient YouTube is the default all-day presentation, while wind-down still takes over near sleep time.

## Weather

`morningBriefing` controls the weather card. By default `showAllDay` is enabled, so the weather card stays available all day.
Monday and Wednesday use the Los Altos weather location for school days. The weather card includes high/low, rain, wind, traffic, and a quick clothing nudge such as `Dress cool` when the day may run warm.

- Normal days use `Almaden / Cambrian Park`.
- Monday and Wednesday use `Los Altos` and show the `School day` label.
- The weather card stays compact and shows only the current temperature and rain chance.

Weather is fetched from Open-Meteo with latitude/longitude from `config.json`. If the weather request fails, ClosetCast logs it and shows a clear unavailable state while the rest of the dashboard keeps running.

## Traffic

The `traffic` section adds a lightweight San Jose route check to the weather card. By default it watches Hwy 85, Hwy 17, I-280, and Hwy 87 keywords and links to a Caltrans QuickMap view centered around the West Valley/San Jose area. If the incident feed text includes directions such as northbound or southbound, ClosetCast labels matching items as NB or SB.

Relevant config:

```json
"traffic": {
  "enabled": true,
  "routeLabel": "South Bay routes",
  "incidentUrl": "https://cad.chp.ca.gov/Traffic.aspx",
  "quickMapUrl": "https://quickmap.dot.ca.gov/?ll=37.25,-121.95&z=11",
  "keywords": ["SR-85", "CA-85", "Highway 85", "West Valley", "West Valley Fwy"],
  "routes": [
    { "label": "Hwy 85", "keywords": ["SR-85", "CA-85", "Highway 85", "West Valley"] },
    { "label": "Hwy 17", "keywords": ["SR-17", "CA-17", "Highway 17", "Santa Cruz Hwy"] },
    { "label": "I-280", "keywords": ["I-280", "Interstate 280", "Highway 280"] },
    { "label": "Hwy 87", "keywords": ["SR-87", "CA-87", "Highway 87", "Guadalupe Pkwy"] }
  ],
  "maxItemsPerRoute": 1
}
```

If the incident page is unreachable or changes shape, ClosetCast keeps the dashboard alive and shows the QuickMap fallback link.

## Apple Calendar

ClosetCast can read Apple Calendar through up to three `.ics` feed URLs. This avoids storing your Apple ID password on the laptop.

To connect it:

1. Publish or share the Apple Calendar you want available as an `.ics` calendar feed.
2. Paste the feed URLs into `calendar.icsUrls` in `config.json`.
3. Set `calendar.enabled` to `true`.

Apple often gives links that start with `webcal://`; ClosetCast accepts those and normalizes them to `https://` internally. If no URL is configured, the app simply says calendar is not connected. Basic one-off events and common daily/weekly recurring events are supported. Calendar results are cached at `cache/calendar-cache.json`, so a temporary network failure falls back to the last good data.

From 10:00 PM to 10:30 PM, ClosetCast switches to wind-down mode and shows tomorrow's events from all three calendars.

## Afternoon YouTube Ambiance

After noon, while the app is in normal dashboard mode, ClosetCast can show a rotating YouTube ambiance panel. It does not download videos. It either loads a direct YouTube link or searches YouTube for a configured topic and uses the first video result it can parse.

YouTube watch links are converted to clean embedded player links before loading in the app. That keeps Mattercam and the other ambiance picks filling the video area without the normal YouTube page, comments, or live chat taking over the panel.

Default topics include:

- Mattercam live
- Disneyland B-roll and park ambience
- 2010s Disney Channel and Disney XD commercials
- Halloween and Christmas Disney Channel commercials
- Frutiger Aero ambience and buildings
- Low-poly night scenes

The provided Disneyland B-roll video is included as a direct link:

```text
https://www.youtube.com/watch?v=9E-l9qYiqxQ&t=2725s
```

Relevant config:

```json
"ambientYouTube": {
  "enabled": true,
  "startTime": "12:00",
  "endTime": "22:00",
  "rotationMinutes": 45,
  "directVideos": [],
  "searchTopics": []
}
```

If YouTube search parsing fails, ClosetCast falls back to the YouTube search page for that topic and keeps the rest of the dashboard running.

## Favorite-Team Auto Mode

The app fetches the configured schedule source for today's favorite games. The default priority is Yankees, Angels, then Giants. If one or more games exist, it computes:

- prepare time: `prepareBeforeGameMinutes` before game time
- live window start: `gameStartBufferMinutes` before game time
- live window end: `assumedGameDurationMinutes + gameEndBufferMinutes` after game time

Before and during the live window, ClosetCast fetches the configured stream site base page and looks for the matching team link. The per-game link can change each day, so ClosetCast resolves it at runtime from your configured site.

It matches anchor text and URLs using each team's `streamSearchText` plus `streamLinkPatterns`, then loads the resolved per-game URL into the normal ambient media square. If multiple favorite games are live or preparing at once, ClosetCast splits that square into multiple webviews ordered by priority. After each page loads, the app blocks popups, clicks a matching game link if it landed on the site's home page, presses a visible play/watch control when present, and only clicks a visible player fullscreen control. It does not fullscreen the whole website when no player control is found. The five cameras, weather, calendar, clock, power schedule, and camera health stay visible around it.

Relevant config:

```json
"yankees": {
  "streamSiteUrl": "https://your-stream-site.example/",
  "streamSearchText": "Yankees",
  "resolveStreamLink": true,
  "streamLinkRefreshMinutes": 20,
  "streamLinkPatterns": ["yankees", "new-york-yankees"],
  "teams": [
    { "id": "yankees", "label": "Yankees", "teamId": 147, "priority": 1, "streamSearchText": "Yankees", "streamLinkPatterns": ["yankees", "new-york-yankees"] },
    { "id": "angels", "label": "Angels", "teamId": 108, "priority": 2, "streamSearchText": "Angels", "streamLinkPatterns": ["angels", "los-angeles-angels", "la-angels"] },
    { "id": "giants", "label": "Giants", "teamId": 137, "priority": 3, "streamSearchText": "Giants", "streamLinkPatterns": ["giants", "san-francisco-giants", "sf-giants"] }
  ]
}
```

If schedule fetching, stream-link scraping, parsing, or stream page loading fails, ClosetCast logs the issue and falls back to the base page or normal dashboard instead of crashing.

## Day Cycle

The default schedule is:

- `09:00`: Windows Task Scheduler wake task starts or focuses ClosetCast.
- `22:00`: wind-down reminder appears.
- `22:00-22:30`: wind-down mode shows tomorrow's calendar events.
- `22:30`: ClosetCast sends a Windows sleep command.
- Next day `09:00`: the wake task resumes the cycle.

The example config also sleeps during common work windows:

- Tuesday, Thursday, and Friday: `16:00-20:00`.
- Saturday: `09:30-12:30`.

Config keys:

```json
"dayCycle": {
  "enabled": true,
  "wakeTime": "09:00",
  "windDownReminderTime": "22:00",
  "sleepTime": "22:30",
  "triggerSleepFromApp": true,
  "installWakeTask": true,
  "installBackupSleepTask": false,
  "extraSleepWindows": [
    {
      "id": "weekday-work",
      "label": "Work shift",
      "days": ["tuesday", "thursday", "friday"],
      "startTime": "16:00",
      "endTime": "20:00"
    },
    {
      "id": "saturday-work",
      "label": "Saturday work",
      "days": ["saturday"],
      "startTime": "09:30",
      "endTime": "12:30"
    }
  ]
}
```

ClosetCast logs mode changes for normal dashboard, Yankees mode, wind-down mode, extra sleep windows, sleep triggered, suspend, and wake/resume detected.

## Windows Autostart

The included setup script creates per-user Task Scheduler entries. They do not require admin rights in the normal case.

For development/npm startup:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-day-cycle-tasks.ps1 -WakeTime 09:00 -SleepTime 22:30
```

To remove it:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\uninstall-autostart.ps1
powershell.exe -ExecutionPolicy Bypass -File .\scripts\uninstall-day-cycle-tasks.ps1
```

For a packaged app, build first:

```powershell
npm.cmd run build
```

Put your `config.json` next to the portable `.exe`, or set the `CLOSETCAST_CONFIG` environment variable to an absolute config path.

Then run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1 -UsePackagedApp -AppPath "C:\Path\To\ClosetCast.exe"
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-day-cycle-tasks.ps1 -UsePackagedApp -AppPath "C:\Path\To\ClosetCast.exe" -WakeTime 09:00 -SleepTime 22:30
```

## Windows Wake Timers

For the 9 AM wake task to work, Windows must allow wake timers:

1. Open Control Panel.
2. Go to Power Options.
3. Choose the active power plan, then `Change plan settings`.
4. Open `Change advanced power settings`.
5. Under `Sleep`, set `Allow wake timers` to `Enable` for plugged in power. Enable battery too only if you want that behavior.

Keep the laptop logged in or locked rather than fully signed out. The scheduled task is per-user and is designed for a normal logged-in kiosk session. Some laptops also have BIOS/firmware or Modern Standby limitations; if 9 AM wake does not happen, check firmware power settings and Windows Event Viewer for Task Scheduler wake events.

## Troubleshooting

**PowerShell blocks npm**

Use `npm.cmd` instead of `npm`.

**Installer says FFmpeg is missing**

Rerun the one-command installer and allow FFmpeg installation if prompted. The installer now searches common WinGet install folders and passes the discovered `ffmpeg.exe` path into setup automatically. If it still cannot find FFmpeg, paste the full path to `ffmpeg.exe` when asked.

**config.json JSON parse error**

Older setup builds wrote `config.json` with a UTF-8 BOM. Rerun the installer and answer `n` when asked whether to replace `config.json`; setup will repair the encoding in place. The app also tolerates BOMs now.

**Camera tile says reconnecting or no signal**

Check `ffmpegPath`, the RTSP URL, camera credentials, and whether the laptop can reach the camera IP. Run `npm.cmd run diagnose:rtsp` to test whether FFmpeg can receive a frame from each enabled camera. The app redacts passwords in logs.

**No Yankees switch happens**

Check `yankees.enabled`, the schedule URL, and `logs/closetcast.log`. If the schedule source changes shape or is unreachable, the app falls back to the dashboard.

**Calendar is empty**

Check `calendar.enabled` and make sure the `.ics` URLs are reachable from the laptop. `webcal://` Apple links are okay. Apple Calendar feeds can take a few minutes to update after you edit events. If the network is down, ClosetCast uses the local cache when available.

**YouTube panel shows a search page**

That means YouTube did not expose a parseable first result to the lightweight resolver. The dashboard is still working; either leave it on the search page or add direct YouTube links under `ambientYouTube.directVideos`.

**YouTube shows Error 153**

ClosetCast serves YouTube embeds through a tiny local player wrapper so YouTube receives a normal embed origin/referrer. If you still see Error 153, restart ClosetCast so the new wrapper loads, then try the local UI test mode again.

**Laptop does not wake at 9 AM**

Confirm the `ClosetCast Wake` scheduled task exists, the laptop is plugged in, and Windows wake timers are enabled for the active power plan.

**Laptop does not sleep at 10:30 PM**

Check `dayCycle.triggerSleepFromApp`, look at `logs/closetcast.log`, and run `powershell.exe -ExecutionPolicy Bypass -File .\scripts\sleep-now.ps1` manually to verify Windows allows sleep.

**The stream page opens but needs interaction**

The embedded page is loaded before game time. Some sites require a manual click or have popups; ClosetCast blocks popups to keep kiosk mode stable.

**Old laptop runs hot**

Keep `lowCpuMode` enabled. It lowers camera bridge frame rate and resolution. You can also use lower-resolution RTSP substreams in your camera URLs.

## Files

- `src/main.js`: Electron app, IPC, startup.
- `src/streamServer.js`: RTSP-to-MJPEG bridge using `ffmpeg`.
- `src/yankeesScheduler.js`: daily schedule fetch and mode switching.
- `src/weatherService.js`: morning weather fetch and location rules.
- `src/calendarService.js`: Apple Calendar `.ics` feed parsing.
- `src/dayCycleService.js`: wind-down, sleep trigger, and power schedule state.
- `src/ambientYouTubeService.js`: after-noon YouTube rotation and search-result resolving.
- `src/layoutEngine.js`: responsive normal, Yankees, and wind-down layout decisions.
- `src/renderer.js`: camera wall, media rotation, Yankees view.
- `config.example.json`: safe example config.
- `Test-ClosetCast.cmd`: safe local UI test wizard for temporary RTSP/calendar links.
- `media/`: local image/video rotation folder.
- `logs/`: runtime logs.
- `scripts/install-autostart.ps1`: Task Scheduler setup.
- `scripts/install-day-cycle-tasks.ps1`: 9 AM wake and optional backup sleep tasks.
- `scripts/sleep-now.ps1`: Windows sleep command used by the app and backup task.
