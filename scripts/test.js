const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { CalendarService, eventsForWindow, normalizeCalendarUrl, parseIcs } = require("../src/calendarService");
const { DayCycleService } = require("../src/dayCycleService");
const { findTrafficMentions, selectLocation } = require("../src/weatherService");
const { findYankeesStreamLink } = require("../src/yankeesScheduler");
const { normalizeYouTubeEmbedUrl } = require("../src/streamServer");
const { chooseAmbientItem, findFirstYouTubeVideoId, isWithinAmbientWindow, toYouTubeEmbedUrl, youtubeSearchUrl } = require("../src/ambientYouTubeService");

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
      triggerSleepFromApp: false
    }
  }, fakeLogger(), () => {});

  assert(service.buildState(new Date(2026, 3, 28, 21, 59)).mode === "normal", "before wind-down should be normal");
  assert(service.buildState(new Date(2026, 3, 28, 22, 10)).mode === "winddown", "10:10 PM should be wind-down");
  assert(service.buildState(new Date(2026, 3, 28, 22, 31)).sleepDue, "10:31 PM should be sleep due");
}

function testWeatherLocation() {
  const config = require("../config.example.json").morningBriefing;
  assert(selectLocation(config, new Date(2026, 3, 27, 8)).id === "los-altos", "Monday should use Los Altos");
  assert(selectLocation(config, new Date(2026, 3, 28, 8)).id === "almaden-cambrian", "Tuesday should use Almaden/Cambrian");
  const traffic = findTrafficMentions("<table><tr><td>SR-85 northbound near Saratoga has a disabled vehicle</td></tr></table>", ["SR-85", "Saratoga"], 2);
  assert(traffic.length === 1 && traffic[0].text.includes("SR-85"), "traffic parser should find route snippets");
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
  assert(yankees.showStream && yankees.cameraClass.includes("camera-stack"), "Yankees layout should show stream and stack cameras");
  assert(winddown.showWinddown && !winddown.showStream, "Wind-down layout should show wind-down panel");
  assert(media.stageClass.includes("has-media"), "Normal layout should emphasize media when active");
}

function testYankeesStreamResolver() {
  const html = [
    "<html><body>",
    "<a href=\"/mlb/boston-red-sox-vs-tampa-bay-rays-1/\">Red Sox vs Rays</a>",
    "<a href=\"/mlb/new-york-yankees-vs-texas-rangers-1/\"><span>New York Yankees vs Texas Rangers</span></a>",
    "</body></html>"
  ].join("");
  const match = findYankeesStreamLink(html, "https://stream-site.example/", "Yankees", ["new-york-yankees"]);
  assert(match.href === "https://stream-site.example/mlb/new-york-yankees-vs-texas-rangers-1/", "Yankees resolver should return current game link");
}

function testAmbientYouTube() {
  const html = "{\"videoId\":\"abcdefghijk\"}<a href=\"/watch?v=zzzzzzzzzzz\">Later</a>";
  assert(findFirstYouTubeVideoId(html) === "abcdefghijk", "ambient YouTube should parse first video id");
  assert(youtubeSearchUrl("Mattercam live").includes("Mattercam%20live"), "ambient YouTube should build search URL");
  assert(toYouTubeEmbedUrl("https://www.youtube.com/watch?v=9E-l9qYiqxQ&t=2725s") === "https://www.youtube.com/embed/9E-l9qYiqxQ?start=2725", "ambient YouTube should use clean embed links");
  const wrapped = normalizeYouTubeEmbedUrl("https://www.youtube.com/embed/9E-l9qYiqxQ?autoplay=1", "http://127.0.0.1:4557");
  assert(wrapped.includes("origin=http%3A%2F%2F127.0.0.1%3A4557"), "YouTube wrapper should include player origin");
  assert(isWithinAmbientWindow(new Date(2026, 3, 28, 13, 0), { startTime: "12:00", endTime: "22:00" }), "1 PM should be ambient time");
  assert(!isWithinAmbientWindow(new Date(2026, 3, 28, 10, 0), { startTime: "12:00", endTime: "22:00" }), "10 AM should not be ambient time");
  const item = chooseAmbientItem({
    directVideos: [{ title: "Direct", url: "https://www.youtube.com/watch?v=9E-l9qYiqxQ" }],
    searchTopics: [{ title: "Mattercam", query: "Mattercam live" }]
  }, []);
  assert(Boolean(item), "ambient YouTube should choose a configured item");
}

function fakeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}

testCalendarTomorrow();
testDayCycle();
testWeatherLocation();
testLayoutEngine();
testYankeesStreamResolver();
testAmbientYouTube();
console.log("Tests passed.");
