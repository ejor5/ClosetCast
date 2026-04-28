const fs = require("fs");
const path = require("path");

const file = process.argv[2] || "config.json";
const configPath = path.resolve(process.cwd(), file);
const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);
const errors = [];

function requireType(pathText, value, type) {
  if (typeof value !== type) errors.push(`${pathText} must be ${type}`);
}

requireType("fullscreenOnLaunch", config.fullscreenOnLaunch, "boolean");
requireType("lowCpuMode", config.lowCpuMode, "boolean");
requireType("cameraLayout", config.cameraLayout, "string");
requireType("ffmpegPath", config.ffmpegPath, "string");
if (config.primaryCameraId !== undefined) requireType("primaryCameraId", config.primaryCameraId, "string");

if (!Array.isArray(config.cameras)) {
  errors.push("cameras must be an array");
} else {
  if (config.cameras.length < 5) errors.push("cameras must include all 5 camera slots");
  for (const [index, camera] of config.cameras.entries()) {
    requireType(`cameras[${index}].id`, camera.id, "string");
    requireType(`cameras[${index}].name`, camera.name, "string");
    requireType(`cameras[${index}].url`, camera.url, "string");
    if (camera.enabled !== undefined && typeof camera.enabled !== "boolean") {
      errors.push(`cameras[${index}].enabled must be boolean when present`);
    }
  }
}

if (!config.media || typeof config.media !== "object") {
  errors.push("media must be an object");
} else {
  requireType("media.enabled", config.media.enabled, "boolean");
  requireType("media.folderPath", config.media.folderPath, "string");
  if (!Array.isArray(config.media.allowedExtensions)) errors.push("media.allowedExtensions must be an array");
}

if (!config.yankees || typeof config.yankees !== "object") {
  errors.push("yankees must be an object");
} else {
  requireType("yankees.enabled", config.yankees.enabled, "boolean");
  requireType("yankees.streameastUrl", config.yankees.streameastUrl, "string");
  requireType("yankees.scheduleUrl", config.yankees.scheduleUrl, "string");
  if (config.yankees.resolveStreamLink !== undefined) requireType("yankees.resolveStreamLink", config.yankees.resolveStreamLink, "boolean");
  if (config.yankees.streamLinkPatterns !== undefined && !Array.isArray(config.yankees.streamLinkPatterns)) errors.push("yankees.streamLinkPatterns must be an array when present");
  for (const key of ["gameStartBufferMinutes", "gameEndBufferMinutes", "assumedGameDurationMinutes"]) {
    if (!Number.isFinite(Number(config.yankees[key]))) errors.push(`yankees.${key} must be numeric`);
  }
}

if (config.morningBriefing) {
  requireType("morningBriefing.enabled", config.morningBriefing.enabled, "boolean");
  if (!Array.isArray(config.morningBriefing.locations)) errors.push("morningBriefing.locations must be an array");
  if (!Array.isArray(config.morningBriefing.weekdayLocationOverrides)) errors.push("morningBriefing.weekdayLocationOverrides must be an array");
}

if (config.calendar) {
  requireType("calendar.enabled", config.calendar.enabled, "boolean");
  if (!Array.isArray(config.calendar.icsUrls)) errors.push("calendar.icsUrls must be an array");
  if (Array.isArray(config.calendar.icsUrls) && config.calendar.icsUrls.length < 3) errors.push("calendar.icsUrls should include 3 Apple calendar slots");
}

if (config.dayCycle) {
  requireType("dayCycle.enabled", config.dayCycle.enabled, "boolean");
  for (const key of ["wakeTime", "windDownReminderTime", "sleepTime"]) {
    if (!/^\d{2}:\d{2}$/.test(config.dayCycle[key] || "")) errors.push(`dayCycle.${key} must be HH:mm`);
  }
}

if (config.layout) {
  requireType("layout.cameraAspectRatio", config.layout.cameraAspectRatio, "string");
}

if (config.ambientYouTube) {
  requireType("ambientYouTube.enabled", config.ambientYouTube.enabled, "boolean");
  for (const key of ["startTime", "endTime"]) {
    if (!/^\d{2}:\d{2}$/.test(config.ambientYouTube[key] || "")) errors.push(`ambientYouTube.${key} must be HH:mm`);
  }
  if (!Array.isArray(config.ambientYouTube.searchTopics)) errors.push("ambientYouTube.searchTopics must be an array");
  if (!Array.isArray(config.ambientYouTube.directVideos)) errors.push("ambientYouTube.directVideos must be an array");
}

if (errors.length) {
  console.error(`Config validation failed for ${configPath}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Config OK: ${configPath}`);
