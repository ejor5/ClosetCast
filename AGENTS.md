# ClosetCast Agent Notes

## Project Shape

ClosetCast is a lightweight Windows kiosk app for an old laptop. Keep the stack simple and practical: Electron, plain HTML/CSS/JS, a JSON config file, and small Node modules. Avoid adding frameworks unless there is a clear payoff.

## Product Requirements

- Start fullscreen/kiosk when configured.
- Default to a clean camera wall for five RTSP cameras.
- Treat Ring RTSP cameras the same as Lorex RTSP cameras.
- Support layouts: focus, split, grid4, and five-camera primary-plus-secondary mode.
- Rotate local files from `media/` when configured.
- Show a morning briefing with local weather and optional Apple Calendar events.
- Run as an all-day dashboard with normal, Yankees, and wind-down modes.
- Rotate after-noon YouTube ambiance from direct links and configured search topics.
- Use Windows Task Scheduler for 9 AM wake and optional backup sleep behavior.
- Fetch Yankees schedule daily, switch to the configured stream page during the game window, then return to the dashboard.
- During Yankees prepare/live windows, resolve the current Yankees page from the configured stream site by scraping links for Yankees text/slugs.
- Use the configured Yankees stream URL exactly as provided by the user.
- If schedule fetching, stream loading, RTSP, or media playback fails, log the issue and keep the dashboard usable.

## Engineering Rules

- Do not hardcode private RTSP credentials or secrets.
- Keep `config.json` out of git; update `config.example.json` when config shape changes.
- Do not store Apple ID passwords. Calendar ingestion should use user-provided `.ics` feed URLs.
- Prefer resilient fallbacks over complex abstractions.
- Use concise comments only where the flow is not obvious.
- Keep logs readable in `logs/closetcast.log`.
- Prefer `npm.cmd` on Windows PowerShell when running npm commands.
- Keep `Setup-ClosetCast.cmd` as the easiest user entry point. If setup requirements change, update the wizard and README together.
- Keep `Install-ClosetCast.ps1` working as the one-command old-PC bootstrap from GitHub raw content.
- Layout code should stay in `src/layoutEngine.js` and mode/power decisions should stay in main-process services.
- Ambient YouTube should stream in a webview only. Do not download video content.

## Validation

Run the available checks before handing off:

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run validate:config
```

If dependencies cannot be installed because network access is unavailable, document that clearly in the final summary.
