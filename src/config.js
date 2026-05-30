const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config.example.json");
const DEFAULT_PRIVATE_CONFIG_PATH = path.join(PROJECT_ROOT, "config.private.json");
const LEGACY_STREAM_SITE_KEY = "stream" + "eastUrl";

function loadConfig() {
  const explicitPath = process.env.CLOSETCAST_CONFIG;
  const workingConfigPath = path.resolve(process.cwd(), "config.json");
  const localConfigPath = path.join(PROJECT_ROOT, "config.json");
  const configPath = explicitPath ||
    (fs.existsSync(workingConfigPath) ? workingConfigPath : null) ||
    (fs.existsSync(localConfigPath) ? localConfigPath : DEFAULT_CONFIG_PATH);
  const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  const baseConfig = JSON.parse(raw);
  const privateConfigPath = resolvePrivateConfigPath(configPath);
  const privateConfig = privateConfigPath ? JSON.parse(fs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, "")) : {};
  const config = mergeConfig(baseConfig, privateConfig);
  applyPrivateLinks(config);

  config.__configPath = configPath;
  config.__privateConfigPath = privateConfigPath || "";
  config.__projectRoot = configPath === DEFAULT_CONFIG_PATH ? process.cwd() : path.dirname(configPath);
  config.media = config.media || {};
  config.yankees = config.yankees || {};
  config.calendar = config.calendar || {};
  config.morningBriefing = config.morningBriefing || {};
  config.dayCycle = config.dayCycle || {};
  config.layout = config.layout || {};
  config.ambientYouTube = config.ambientYouTube || {};
  config.debug = config.debug || {};
  config.streamServer = config.streamServer || {};
  config.cameras = Array.isArray(config.cameras) ? config.cameras : [];

  if (!config.streamServer.host) config.streamServer.host = "127.0.0.1";
  if (!config.streamServer.port) config.streamServer.port = 4557;
  if (!config.cameraLayout) config.cameraLayout = "five";
  if (!config.ffmpegPath) config.ffmpegPath = "ffmpeg";

  return config;
}

function resolvePrivateConfigPath(configPath) {
  if (process.env.CLOSETCAST_DISABLE_PRIVATE_CONFIG === "1") return "";
  const candidates = [];
  if (process.env.CLOSETCAST_PRIVATE_CONFIG) {
    candidates.push(path.resolve(process.env.CLOSETCAST_PRIVATE_CONFIG));
  }
  candidates.push(path.join(path.dirname(configPath), "config.private.json"));
  if (path.dirname(configPath) !== PROJECT_ROOT) candidates.push(DEFAULT_PRIVATE_CONFIG_PATH);
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function mergeConfig(base, overlay) {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay === undefined ? base : overlay;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    merged[key] = isPlainObject(value) && isPlainObject(base[key])
      ? mergeConfig(base[key], value)
      : value;
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyPrivateLinks(config) {
  const links = config.privateLinks;
  if (!isPlainObject(links)) return;

  if (isPlainObject(links.cameras)) {
    for (const camera of config.cameras || []) {
      const url = links.cameras[camera.id];
      if (typeof url === "string") {
        camera.url = url;
        camera.enabled = url.trim().length > 0;
      }
    }
  }

  if (Array.isArray(links.calendarIcsUrls)) {
    config.calendar = config.calendar || {};
    const slots = links.calendarIcsUrls.slice(0, 3).map((url, index) => ({
      name: `Apple Calendar ${index + 1}`,
      url: normalizeCalendarUrl(url)
    }));
    while (slots.length < 3) slots.push({ name: `Apple Calendar ${slots.length + 1}`, url: "" });
    config.calendar.icsUrls = slots;
    config.calendar.enabled = slots.some((slot) => slot.url);
  }

  if (typeof links.yankeesStreamSiteUrl === "string") {
    config.yankees = config.yankees || {};
    config.yankees.streamSiteUrl = links.yankeesStreamSiteUrl;
  }

  if (Array.isArray(links.ambientDirectVideos)) {
    config.ambientYouTube = config.ambientYouTube || {};
    config.ambientYouTube.directVideos = [
      ...links.ambientDirectVideos,
      ...(Array.isArray(config.ambientYouTube.directVideos) ? config.ambientYouTube.directVideos : [])
    ];
  }

  if (Array.isArray(links.ambientSearchTopics)) {
    config.ambientYouTube = config.ambientYouTube || {};
    config.ambientYouTube.searchTopics = [
      ...links.ambientSearchTopics,
      ...(Array.isArray(config.ambientYouTube.searchTopics) ? config.ambientYouTube.searchTopics : [])
    ];
  }

  if (typeof links.mediaFolderPath === "string") {
    config.media = config.media || {};
    config.media.folderPath = links.mediaFolderPath;
    config.media.enabled = links.mediaFolderPath.trim().length > 0;
  }
}

function normalizeCalendarUrl(url) {
  return String(url || "").replace(/^webcal:\/\//i, "https://");
}

function resolveProjectPath(root, maybeRelative) {
  if (!maybeRelative) return root;
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.join(root, maybeRelative);
}

function getPublicConfig(config, streamBaseUrl, mediaFiles, logFile) {
  const yankeesStreamSiteUrl = getYankeesStreamSiteUrl(config.yankees);
  return {
    fullscreenOnLaunch: Boolean(config.fullscreenOnLaunch),
    lowCpuMode: Boolean(config.lowCpuMode),
    cameraLayout: config.cameraLayout,
    focusedCameraId: config.focusedCameraId,
    primaryCameraId: config.primaryCameraId || config.focusedCameraId,
    layout: {
      cameraAspectRatio: config.layout.cameraAspectRatio || "7 / 8",
      normalPrimaryWeight: Number(config.layout.normalPrimaryWeight || 1.52),
      gameStreamScreenShare: Number(config.layout.gameStreamScreenShare || 0.75)
    },
    configPath: config.__configPath,
    logFile,
    localBaseUrl: streamBaseUrl,
    streamServer: {
      firstFrameTimeoutSeconds: Number(config.streamServer.firstFrameTimeoutSeconds || 15),
      stallTimeoutSeconds: Number(config.streamServer.stallTimeoutSeconds || 25)
    },
    cameras: config.cameras
      .filter((camera) => camera.enabled !== false)
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .map((camera) => ({
        id: camera.id,
        name: camera.name,
        priority: camera.priority,
        streamUrl: `${streamBaseUrl}/camera/${encodeURIComponent(camera.id)}.mjpeg`
      })),
    media: {
      enabled: Boolean(config.media.enabled),
      rotationSeconds: Number(config.media.rotationSeconds || 20),
      showDuringCameraMode: config.media.showDuringCameraMode !== false,
      files: mediaFiles
    },
    yankees: {
      enabled: Boolean(config.yankees.enabled),
      streamSiteUrl: yankeesStreamSiteUrl,
      streamSearchText: config.yankees.streamSearchText || "Yankees",
      streamLinkPatterns: config.yankees.streamLinkPatterns || [],
      resolveStreamLink: config.yankees.resolveStreamLink !== false,
      prepareBeforeGameMinutes: Number(config.yankees.prepareBeforeGameMinutes || 10)
    },
    dayCycle: {
      enabled: config.dayCycle.enabled !== false,
      windDownReminderTime: config.dayCycle.windDownReminderTime || "22:00",
      sleepTime: config.dayCycle.sleepTime || "22:30",
      wakeTime: config.dayCycle.wakeTime || "09:00",
      extraSleepWindows: Array.isArray(config.dayCycle.extraSleepWindows) ? config.dayCycle.extraSleepWindows : []
    },
    ambientYouTube: {
      enabled: Boolean(config.ambientYouTube.enabled),
      startTime: config.ambientYouTube.startTime || "12:00",
      endTime: config.ambientYouTube.endTime || "22:00",
      rotationMinutes: Number(config.ambientYouTube.rotationMinutes || 30)
    },
    debug: {
      enabled: Boolean(config.debug.enabled),
      forceMode: config.debug.forceMode || "",
      ambientTitle: config.debug.ambientTitle || "",
      ambientUrl: config.debug.ambientUrl || "",
      yankeesUrl: config.debug.yankeesUrl || yankeesStreamSiteUrl || "",
      resolveYankeesNow: Boolean(config.debug.resolveYankeesNow)
    }
  };
}

function getYankeesStreamSiteUrl(yankeesConfig = {}) {
  return yankeesConfig.streamSiteUrl || yankeesConfig[LEGACY_STREAM_SITE_KEY] || "";
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PRIVATE_CONFIG_PATH,
  PROJECT_ROOT,
  getPublicConfig,
  getYankeesStreamSiteUrl,
  applyPrivateLinks,
  mergeConfig,
  loadConfig,
  resolveProjectPath
};
