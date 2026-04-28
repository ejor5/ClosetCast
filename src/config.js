const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config.example.json");

function loadConfig() {
  const explicitPath = process.env.CLOSETCAST_CONFIG;
  const workingConfigPath = path.resolve(process.cwd(), "config.json");
  const localConfigPath = path.join(PROJECT_ROOT, "config.json");
  const configPath = explicitPath ||
    (fs.existsSync(workingConfigPath) ? workingConfigPath : null) ||
    (fs.existsSync(localConfigPath) ? localConfigPath : DEFAULT_CONFIG_PATH);
  const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(raw);

  config.__configPath = configPath;
  config.__projectRoot = configPath === DEFAULT_CONFIG_PATH ? process.cwd() : path.dirname(configPath);
  config.media = config.media || {};
  config.yankees = config.yankees || {};
  config.calendar = config.calendar || {};
  config.morningBriefing = config.morningBriefing || {};
  config.dayCycle = config.dayCycle || {};
  config.layout = config.layout || {};
  config.ambientYouTube = config.ambientYouTube || {};
  config.streamServer = config.streamServer || {};
  config.cameras = Array.isArray(config.cameras) ? config.cameras : [];

  if (!config.streamServer.host) config.streamServer.host = "127.0.0.1";
  if (!config.streamServer.port) config.streamServer.port = 4557;
  if (!config.cameraLayout) config.cameraLayout = "five";
  if (!config.ffmpegPath) config.ffmpegPath = "ffmpeg";

  return config;
}

function resolveProjectPath(root, maybeRelative) {
  if (!maybeRelative) return root;
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.join(root, maybeRelative);
}

function getPublicConfig(config, streamBaseUrl, mediaFiles, logFile) {
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
      rotationSeconds: Number(config.media.rotationSeconds || 90),
      showDuringCameraMode: config.media.showDuringCameraMode !== false,
      files: mediaFiles
    },
    yankees: {
      enabled: Boolean(config.yankees.enabled),
      streameastUrl: config.yankees.streameastUrl,
      streamSearchText: config.yankees.streamSearchText || "Yankees",
      resolveStreamLink: config.yankees.resolveStreamLink !== false,
      prepareBeforeGameMinutes: Number(config.yankees.prepareBeforeGameMinutes || 10)
    },
    dayCycle: {
      enabled: config.dayCycle.enabled !== false,
      windDownReminderTime: config.dayCycle.windDownReminderTime || "22:00",
      sleepTime: config.dayCycle.sleepTime || "22:30",
      wakeTime: config.dayCycle.wakeTime || "09:00"
    },
    ambientYouTube: {
      enabled: Boolean(config.ambientYouTube.enabled),
      startTime: config.ambientYouTube.startTime || "12:00",
      endTime: config.ambientYouTube.endTime || "22:00",
      rotationMinutes: Number(config.ambientYouTube.rotationMinutes || 45)
    }
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  PROJECT_ROOT,
  getPublicConfig,
  loadConfig,
  resolveProjectPath
};
