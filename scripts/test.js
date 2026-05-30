const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { CalendarService, eventsForWindow, normalizeCalendarUrl, parseIcs } = require("../src/calendarService");
const { applyPrivateLinks, mergeConfig } = require("../src/config");
const { DayCycleService } = require("../src/dayCycleService");
const { buildClothingAdvice, buildTrafficRouteSummaries, detectTrafficDirection, findTrafficMentions, selectLocation } = require("../src/weatherService");
const { findYankeesStreamLink, normalizeFavoriteTeams, YankeesScheduler } = require("../src/yankeesScheduler");
const { FFMPEG_RTSP_TRANSPORT_WARNING, buildYouTubePlayerConfig, isUnsupportedRtspTransport, normalizeYouTubeEmbedUrl } = require("../src/streamServer");
const { AmbientYouTubeService, chooseAmbientItem, findFirstYouTubeVideoId, isWithinAmbientWindow, toYouTubeEmbedUrl, youtubeSearchUrl } = require("../src/ambientYouTubeService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testCalendarTomorrow() {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:School",
    "DTSTART:20260429T160000Z",
    "DTEND:20260429T170000Z",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\n");
  const events = eventsForWindow(parseIcs(ics, "Test"), new Date("2026-04-29T00:00:00Z"), new Date("2026-04-30T00:00:00Z"));
  assert(events.length === 1, "calendar should return tomorrow event");
  assert(events[0].title === "School", "calendar event title should survive parsing");
  assert(normalizeCalendarUrl("webcal://example.com/calendar.ics") === "https://example.com/calendar.ics", "webcal should normalize to https");
}

function testDayCycle() {
  const service = new DayCycleService({
    __projectRoot: path.resolve(__dirname, ".."),
    dayCycle: {
      enabled: true,
      windDownReminderTime: "22:00",
      sleepTime: "22:30",
      wakeTime: "09:00",
      triggerSleepFromApp: false,
      extraSleepWindows: [
        {
          id: "weekday-work",
          label: "Work shift",
          days: ["tuesday", "thursday", "friday"],
          startTime: "16:00",
          endTime: "20:00"
        },
        {
          id: "saturday-work",
          label: "Saturday work",
          days: ["saturday"],
          startTime: "09:30",
          endTime: "12:30"
        }
      ]
    }
  }, fakeLogger(), () => {});

  assert(service.buildState(new Date(2026, 3, 28, 21, 59)).mode === "normal", "before wind-down should be normal");
  assert(service.buildState(new Date(2026, 3, 28, 22, 10)).mode === "winddown", "10:10 PM should be wind-down");
  assert(service.buildState(new Date(2026, 3, 28, 22, 31)).sleepDue, "10:31 PM should be sleep due");
  assert(service.buildState(new Date(2026, 3, 28, 15, 59)).mode === "normal", "before Tuesday work sleep window should be normal");
  const tuesdayWork = service.buildState(new Date(2026, 3, 28, 16, 1));
  assert(tuesdayWork.mode === "overnight" && tuesdayWork.sleepDue, "Tuesday 4 PM work window should trigger sleep");
  assert(tuesdayWork.minutesUntilSleep === 0, "active work sleep window should show sleep due now");
  assert(tuesdayWork.nextWakeLabel, "work window should expose a wake label");
  assert(service.buildState(new Date(2026, 4, 2, 9, 31)).sleepDue, "Saturday 9:30 AM work window should trigger sleep");
}

function testWeatherLocation() {
  const config = require("../config.example.json").morningBriefing;
  const mondayLocation = selectLocation(config, new Date(2026, 3, 27, 8));
  const wednesdayLocation = selectLocation(config, new Date(2026, 3, 29, 8));
  assert(mondayLocation.id === "los-altos" && mondayLocation.label === "School day", "Monday should use Los Altos for school");
  assert(wednesdayLocation.id === "los-altos" && wednesdayLocation.label === "School day", "Wednesday should use Los Altos for school");
  assert(selectLocation(config, new Date(2026, 3, 28, 8)).id === "almaden-cambrian", "Tuesday should use Almaden/Cambrian");
  assert(buildClothingAdvice({ high: 83, currentTemp: 72, feelsLike: 78, rainChance: 0, wind: 5 }).includes("Dress cool"), "hot days should recommend dressing cool");
  assert(buildClothingAdvice({ high: 74, currentTemp: 68, feelsLike: 72, rainChance: 0, wind: 5, label: "School day" }).startsWith("School day"), "school-day clothing advice should keep the location context");
  const traffic = findTrafficMentions("<table><tr><td>SR-85 northbound near Saratoga has a disabled vehicle</td></tr></table>", ["SR-85", "Saratoga"], 2);
  assert(traffic.length === 1 && traffic[0].text.includes("SR-85"), "traffic parser should find route snippets");
  assert(detectTrafficDirection(traffic[0].text) === "NB", "traffic parser should detect northbound snippets");
  const routeTraffic = buildTrafficRouteSummaries(
    "<table><tr><td>SR-17 southbound near Los Gatos crash</td></tr><tr><td>I-280 northbound clear near Foothill</td></tr></table>",
    require("../config.example.json").traffic
  );
  assert(routeTraffic.some((route) => route.label === "Hwy 17" && route.items[0]?.direction === "SB"), "traffic routes should include Hwy 17 southbound incidents");
  assert(routeTraffic.some((route) => route.label === "I-280" && route.items[0]?.direction === "NB"), "traffic routes should include I-280 northbound incidents");
}

function testPrivateConfigOverlay() {
  const config = mergeConfig({
    cameras: [
      { id: "garage", url: "", enabled: false },
      { id: "front-yard", url: "", enabled: false }
    ],
    calendar: { enabled: false, icsUrls: [] },
    yankees: { streamSiteUrl: "" },
    ambientYouTube: {
      directVideos: [{ title: "Default", url: "https://www.youtube.com/watch?v=11111111111" }],
      searchTopics: []
    },
    media: { enabled: false, folderPath: "media" }
  }, {
    privateLinks: {
      cameras: { garage: "rtsp://user:pass@example/garage" },
      calendarIcsUrls: ["webcal://example.com/one.ics"],
      yankeesStreamSiteUrl: "https://private.example/yankees",
      ambientDirectVideos: [{ title: "Private WDW", url: "https://www.youtube.com/watch?v=22222222222", weight: 8 }],
      mediaFolderPath: "D:/ClosetCastMedia"
    }
  });

  applyPrivateLinks(config);
  assert(config.cameras[0].url.includes("garage"), "private config should patch camera URLs by id");
  assert(config.cameras[0].enabled, "private camera URLs should enable that camera");
  assert(config.calendar.enabled && config.calendar.icsUrls[0].url.startsWith("https://"), "private calendar webcal URLs should normalize");
  assert(config.yankees.streamSiteUrl.includes("private.example"), "private config should set Yankees stream URL");
  assert(config.ambientYouTube.directVideos[0].title === "Private WDW", "private ambient videos should be prioritized");
  assert(config.media.enabled && config.media.folderPath === "D:/ClosetCastMedia", "private config should set media folder");
}

function testLayoutEngine() {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "layoutEngine.js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const cameras = [1, 2, 3, 4, 5].map((number) => ({ id: `cam-${number}`, priority: number }));
  const yankees = sandbox.window.closetCastLayout.buildLayout({ appMode: { mode: "yankees" }, cameras });
  const winddown = sandbox.window.closetCastLayout.buildLayout({ appMode: { mode: "winddown" }, cameras });
  const media = sandbox.window.closetCastLayout.buildLayout({ appMode: { mode: "normal" }, cameras, mediaActive: true });
  const focused = sandbox.window.closetCastLayout.buildLayout({ appMode: { mode: "normal" }, cameras, cameraLayout: "focus", primaryCameraId: "cam-1", focusedCameraId: "cam-4" });
  assert(yankees.showStream && yankees.cameraClass.includes("camera-stack"), "Yankees layout should show stream and stack cameras");
  assert(winddown.showWinddown && !winddown.showStream, "Wind-down layout should show wind-down panel");
  assert(media.stageClass.includes("has-media"), "Normal layout should emphasize media when active");
  assert(focused.cameras[0].id === "cam-4", "Focus layout should prioritize the clicked camera");
}

function testRendererCameraReconnects() {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
  const rendererSource = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
  const stylesSource = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
  const setDebugModeSource = rendererSource.slice(rendererSource.indexOf("function setDebugMode"), rendererSource.indexOf("function forceResolveYankeesStream"));
  assert(rendererSource.includes("cameraRenderToken"), "camera remounts should include a reconnect token");
  assert(rendererSource.includes("state.focusedCameraId = null"), "leaving focus should return to primary camera ordering");
  assert(rendererSource.includes("withCameraParams(camera.streamUrl"), "camera reload URLs should be rebuilt safely");
  assert(stylesSource.includes(".camera-focus .camera-tile") && stylesSource.includes("width: 100%"), "focused cameras should use the available width");
  assert(stylesSource.includes("minmax(330px, 24vw) minmax(0, 1fr)"), "ambient mode should reserve a left weather/calendar rail");
  assert(stylesSource.includes("minmax(112px, 16vh) minmax(0, 1fr)"), "ambient mode should keep cameras in a compact top strip");
  assert(stylesSource.includes("grid-template-areas:\n    \"info cameras\"\n    \"info ambient\""), "ambient mode should put info on the left and cameras above the video");
  assert(stylesSource.includes("grid-template-columns: repeat(5, minmax(0, 1fr))"), "ambient camera strip should show all cameras across the top");
  assert(stylesSource.includes("grid-template-areas:\n    \"stream cameras\"\n    \"stream info\""), "Yankees desktop layout should put the stream first and largest");
  assert(stylesSource.includes("grid-template-rows: minmax(58vh, 1fr) auto auto"), "Yankees narrow layout should keep the stream at the top");
  assert(indexSource.includes("id=\"streamViews\""), "stream panel should support multiple live game webviews");
  assert(rendererSource.includes("stream-count-${Math.min(streams.length, 4)}"), "renderer should switch the stream grid when multiple games are live");
  assert(stylesSource.includes(".stream-count-2"), "styles should split two simultaneous favorite streams");
  assert(indexSource.includes("data-test-mode=\"ambient\""), "settings should expose a test mode picker");
  assert(indexSource.includes("id=\"refreshAmbient\""), "settings should expose a manual ambient YouTube picker");
  assert(rendererSource.includes("document.querySelectorAll(\"[data-test-mode]\")"), "test mode picker should be wired in the renderer");
  assert(rendererSource.includes("function refreshAmbientNow") && rendererSource.includes("window.closetCast.refreshAmbient()"), "manual ambient picker should use the same refresh path as the timer");
  assert(rendererSource.includes("detectAmbientUnavailableInPage") && rendererSource.includes("refreshAmbientAfterUnavailable"), "ambient YouTube should skip unavailable videos");
  assert(!setDebugModeSource.includes("state.config.debug.enabled"), "settings test modes should work outside debug config");
  assert(rendererSource.includes("clickYankeesFullscreenIfVisible"), "favorite stream automation should be limited to visible fullscreen controls");
  assert(!rendererSource.includes("MouseEvent"), "Yankees page automation should not synthesize mouse movement");
  assert(!rendererSource.includes("clickGameLink"), "Yankees page automation should not click stream-site game links");
}

function testYankeesStreamResolver() {
  const schedulerSource = fs.readFileSync(path.join(__dirname, "..", "src", "yankeesScheduler.js"), "utf8");
  assert(schedulerSource.includes("streamResolveInFlight"), "Yankees resolver should prevent concurrent stream scraping");
  assert(schedulerSource.includes("lastStreamResolveAttemptAt"), "Yankees resolver should cool down after failed attempts");
  assert(!schedulerSource.includes("safeUrl(\"/mlb/\""), "Yankees resolver should not probe extra stream-site paths");
  const teams = normalizeFavoriteTeams(require("../config.example.json").yankees);
  assert(teams.map((team) => team.id).join(",") === "yankees,angels,giants", "favorite teams should default to Yankees, Angels, Giants priority order");

  const html = [
    "<html><body>",
    "<a href=\"/mlb/boston-red-sox-vs-tampa-bay-rays-1/\">Red Sox vs Rays</a>",
    "<a href=\"/mlb/new-york-yankees-vs-texas-rangers-1/\"><span>New York Yankees vs Texas Rangers</span></a>",
    "</body></html>"
  ].join("");
  const match = findYankeesStreamLink(html, "https://stream-site.example/", "Yankees", ["new-york-yankees"]);
  assert(match.href === "https://stream-site.example/mlb/new-york-yankees-vs-texas-rangers-1/", "Yankees resolver should return current game link");

  const angelsHtml = [
    "<html><body>",
    "<a href=\"/mlb/arizona-diamondbacks-vs-colorado-rockies-1/\">Diamondbacks vs Rockies</a>",
    "<a class=\"button\" href=\"/mlb/los-angeles-angels-vs-seattle-mariners-1/\">Los Angeles Angels vs Seattle Mariners</a>",
    "</body></html>"
  ].join("");
  const noGiantsFallback = findYankeesStreamLink(angelsHtml, "https://stream-site.example/", "Yankees", ["new-york-yankees"]);
  assert(noGiantsFallback === null, "Yankees resolver should not pick another favorite team's page");
  const angelsMatch = findYankeesStreamLink(angelsHtml, "https://stream-site.example/", "Angels", ["los-angeles-angels"]);
  assert(angelsMatch.href === "https://stream-site.example/mlb/los-angeles-angels-vs-seattle-mariners-1/", "Angels resolver should return current Angels link");
}

async function testYankeesTimingWindows() {
  const scheduler = new YankeesScheduler({
    yankees: {
      enabled: true,
      streamSiteUrl: "",
      resolveStreamLink: false,
      gameStartBufferMinutes: 20,
      gameEndBufferMinutes: 45,
      assumedGameDurationMinutes: 210,
      prepareBeforeGameMinutes: 10
    }
  }, fakeLogger(), () => {});

  scheduler.publish({
    games: [{
      startTime: "2026-05-04T23:05:00Z",
      status: "Scheduled",
      awayTeam: "Baltimore Orioles",
      homeTeam: "New York Yankees",
      teamKey: "yankees",
      teamId: 147,
      teamLabel: "Yankees",
      priority: 1,
      streamSearchText: "Yankees",
      streamLinkPatterns: ["yankees", "new-york-yankees"]
    }]
  });

  await scheduler.evaluate(new Date("2026-05-04T22:40:00Z"));
  assert(scheduler.state.mode === "preparing", "prepare window should happen before the game switch window");
  assert(scheduler.state.game.prepareStart === "2026-05-04T22:35:00.000Z", "prepare window should start 10 minutes before the 20-minute game buffer");
  assert(scheduler.state.game.windowStart === "2026-05-04T22:45:00.000Z", "Yankees mode should start 20 minutes before first pitch");

  await scheduler.evaluate(new Date("2026-05-04T22:50:00Z"));
  assert(scheduler.state.mode === "yankees", "Yankees mode should be live during the game window");

  await scheduler.evaluate(new Date("2026-05-05T03:21:00Z"));
  assert(scheduler.state.mode === "dashboard", "Yankees mode should end after assumed duration plus buffer");
}

async function testFavoriteTeamSplitStreams() {
  const scheduler = new YankeesScheduler({
    yankees: {
      enabled: true,
      streamSiteUrl: "https://stream-site.example/",
      resolveStreamLink: false,
      gameStartBufferMinutes: 20,
      gameEndBufferMinutes: 45,
      assumedGameDurationMinutes: 210,
      prepareBeforeGameMinutes: 10,
      teams: [
        { id: "yankees", label: "Yankees", teamId: 147, priority: 1, streamLinkPatterns: ["yankees"] },
        { id: "angels", label: "Angels", teamId: 108, priority: 2, streamLinkPatterns: ["angels"] },
        { id: "giants", label: "Giants", teamId: 137, priority: 3, streamLinkPatterns: ["giants"] }
      ]
    }
  }, fakeLogger(), () => {});

  scheduler.publish({
    games: [
      {
        startTime: "2026-05-04T23:05:00Z",
        status: "Scheduled",
        awayTeam: "Baltimore Orioles",
        homeTeam: "New York Yankees",
        teamKey: "yankees",
        teamId: 147,
        teamLabel: "Yankees",
        priority: 1,
        streamSearchText: "Yankees",
        streamLinkPatterns: ["yankees"]
      },
      {
        startTime: "2026-05-04T23:07:00Z",
        status: "Scheduled",
        awayTeam: "Los Angeles Angels",
        homeTeam: "Seattle Mariners",
        teamKey: "angels",
        teamId: 108,
        teamLabel: "Angels",
        priority: 2,
        streamSearchText: "Angels",
        streamLinkPatterns: ["angels"]
      }
    ]
  });

  await scheduler.evaluate(new Date("2026-05-04T22:55:00Z"));
  assert(scheduler.state.mode === "yankees", "favorite-team mode should go live when any favorite game is live");
  assert(scheduler.state.streams.length === 2, "simultaneous favorite games should publish multiple stream slots");
  assert(scheduler.state.streams[0].teamLabel === "Yankees" && scheduler.state.streams[1].teamLabel === "Angels", "stream slots should stay in priority order");
}

function testAmbientYouTube() {
  const html = "{\"videoId\":\"abcdefghijk\"}<a href=\"/watch?v=zzzzzzzzzzz\">Later</a>";
  const exampleConfig = require("../config.example.json");
  const uiTestSource = fs.readFileSync(path.join(__dirname, "run-ui-test.ps1"), "utf8");
  assert(findFirstYouTubeVideoId(html) === "abcdefghijk", "ambient YouTube should parse first video id");
  assert(youtubeSearchUrl("Mattercam live").includes("Mattercam%20live"), "ambient YouTube should build search URL");
  assert(toYouTubeEmbedUrl("https://www.youtube.com/watch?v=9E-l9qYiqxQ&t=2725s") === "https://www.youtube.com/embed/9E-l9qYiqxQ?start=2725", "ambient YouTube should use clean embed links");
  const wrapped = normalizeYouTubeEmbedUrl("https://www.youtube.com/embed/9E-l9qYiqxQ?autoplay=1", "http://127.0.0.1:4557");
  assert(wrapped.includes("origin=http%3A%2F%2F127.0.0.1%3A4557"), "YouTube wrapper should include player origin");
  assert(wrapped.includes("enablejsapi=1"), "YouTube wrapper should enable iframe error events");
  const playerConfig = buildYouTubePlayerConfig(wrapped);
  assert(playerConfig.videoId === "9E-l9qYiqxQ", "YouTube wrapper should extract the video id for the iframe API");
  assert(playerConfig.playerVars.autoplay === "1", "YouTube wrapper should preserve autoplay player vars");
  assert(playerConfig.playerVars.vq === "hd720", "YouTube wrapper should request 720p playback");
  const streamServerSource = fs.readFileSync(path.join(__dirname, "..", "src", "streamServer.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
  assert(streamServerSource.includes("https://s.ytimg.com"), "YouTube wrapper CSP should allow the iframe API widget script");
  assert(streamServerSource.includes("<iframe"), "YouTube wrapper should load a direct embed iframe");
  assert(streamServerSource.includes("YouTube stayed black or did not start"), "YouTube wrapper should detect black/loading videos");
  assert(rendererSource.includes("reportAmbientFailure"), "renderer should report failed ambient videos before refreshing");
  assert(rendererSource.includes("watch on youtube"), "renderer should skip embeds that ask to watch on YouTube");
  assert(isWithinAmbientWindow(new Date(2026, 3, 28, 13, 0), { startTime: "12:00", endTime: "22:00" }), "1 PM should be ambient time");
  assert(!isWithinAmbientWindow(new Date(2026, 3, 28, 10, 0), { startTime: "12:00", endTime: "22:00" }), "10 AM should not be ambient time");
  const item = chooseAmbientItem({
    directVideos: [{ title: "Direct", url: "https://www.youtube.com/watch?v=9E-l9qYiqxQ" }],
    searchTopics: [{ title: "Mattercam", query: "Mattercam live" }]
  }, []);
  assert(Boolean(item), "ambient YouTube should choose a configured item");
  assert(exampleConfig.ambientYouTube.rotationMinutes === 30, "ambient YouTube should rotate every 30 minutes by default");
  assert(exampleConfig.ambientYouTube.startTime === "00:00" && exampleConfig.ambientYouTube.endTime === "23:59", "ambient YouTube should be the default all-day mode");
  assert(require("../config.example.json").yankees.enabled === false, "Yankees mode should be opt-in");
  assert(exampleConfig.ambientYouTube.recentHistorySize >= 10, "ambient YouTube should avoid repeats across the larger ambient pool");
  assert(exampleConfig.ambientYouTube.searchTopics.some((topic) => /Magical Escapes/i.test(topic.query)), "ambient YouTube should include Magical Escapes searches");
  assert(exampleConfig.ambientYouTube.searchTopics.some((topic) => /WDW Today/i.test(topic.query)), "ambient YouTube should include WDW Today resort TV searches");
  assert(exampleConfig.ambientYouTube.searchTopics.some((topic) => /Disney/i.test(topic.title) && Number(topic.weight || 1) > 1), "Disney ambient streams should be weighted above generic picks");
  assert(uiTestSource.includes("Get-TestAmbientSearchTopics"), "UI test config should include the full ambient YouTube search pool");
  assert(uiTestSource.includes("searchTopics.Count -le 1"), "UI test config should replace one-item ambient pools");
  assert(uiTestSource.includes("recentHistorySize = 10"), "UI test config should avoid rapid ambient repeats");
  assert(uiTestSource.includes("Use-DemoCamerasForPlaceholders"), "UI test mode should use demo cameras instead of placeholder RTSP URLs");

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    Math.random = () => 0.4;
    const weightedItem = chooseAmbientItem({
      directVideos: [{ title: "Plain", url: "https://www.youtube.com/watch?v=11111111111" }],
      searchTopics: [{ title: "Disney Live", query: "Disney live stream", weight: 4 }]
    }, []);
    assert(weightedItem.title === "Disney Live", "ambient YouTube should honor item weights");

    const randomItem = chooseAmbientItem({
      directVideos: [
        { title: "Direct 1", url: "https://www.youtube.com/watch?v=11111111111" },
        { title: "Direct 2", url: "https://www.youtube.com/watch?v=22222222222" }
      ],
      searchTopics: [
        { title: "Mattercam", query: "Mattercam live" }
      ]
    }, [
      "direct:0:https://www.youtube.com/watch?v=11111111111",
      "direct:1:https://www.youtube.com/watch?v=22222222222"
    ]);
    assert(randomItem.title === "Mattercam", "ambient YouTube should randomly choose from fresh items before repeating recent items");
  } finally {
    Math.random = originalRandom;
  }
}

async function testAmbientRefreshQueue() {
  const states = [];
  const service = new AmbientYouTubeService({
    ambientYouTube: {
      enabled: true,
      startTime: "00:00",
      endTime: "23:59",
      recentHistorySize: 10,
      directVideos: [
        { title: "Direct 1", url: "https://www.youtube.com/watch?v=11111111111" },
        { title: "Direct 2", url: "https://www.youtube.com/watch?v=22222222222" },
        { title: "Direct 3", url: "https://www.youtube.com/watch?v=33333333333" }
      ],
      searchTopics: []
    }
  }, fakeLogger(), (state) => states.push(state));

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    await Promise.all([
      service.refresh(),
      service.refresh(),
      service.refresh()
    ]);
  } finally {
    Math.random = originalRandom;
  }

  const titles = states.filter((state) => state.visible).map((state) => state.title);
  assert(titles.join(",") === "Direct 1,Direct 2,Direct 3", "queued ambient refreshes should reserve recent picks before resolving");
}

function testRtspBridgeArgs() {
  const streamServerSource = fs.readFileSync(path.join(__dirname, "..", "src", "streamServer.js"), "utf8");
  assert(!streamServerSource.includes("\"-stimeout\""), "RTSP bridge should not pass FFmpeg's brittle -stimeout option");
  assert(streamServerSource.includes("firstFrameTimeoutSeconds"), "RTSP bridge should restart when no frame arrives");
  assert(isUnsupportedRtspTransport("Unrecognized option 'rtsp_transport'.\nError splitting the argument list: Option not found"), "RTSP bridge should detect unsupported transport option errors");
  assert(streamServerSource.includes("-h\", \"demuxer=rtsp"), "RTSP bridge should probe FFmpeg RTSP demuxer options");
  assert(streamServerSource.includes(FFMPEG_RTSP_TRANSPORT_WARNING), "RTSP bridge should emit a hard FFmpeg transport warning");
  assert(!streamServerSource.includes("ffmpeg-default"), "RTSP bridge should not silently downgrade transport");
  assert(streamServerSource.includes("closetcast-demo"), "UI test demo cameras should be served locally");
  assert(require("../package.json").scripts["diagnose:rtsp"], "RTSP diagnostic script should be available");
}

function fakeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}

async function main() {
  testCalendarTomorrow();
  testDayCycle();
  testWeatherLocation();
  testPrivateConfigOverlay();
  testLayoutEngine();
  testRendererCameraReconnects();
  testYankeesStreamResolver();
  await testYankeesTimingWindows();
  await testFavoriteTeamSplitStreams();
  testAmbientYouTube();
  await testAmbientRefreshQueue();
  testRtspBridgeArgs();
  console.log("Tests passed.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
