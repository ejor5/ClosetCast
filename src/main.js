const path = require("path");
const { app, BrowserWindow, ipcMain, powerMonitor, shell } = require("electron");
const { loadConfig, getPublicConfig } = require("./config");
const { createLogger } = require("./logger");
const { listMediaFiles } = require("./mediaLibrary");
const { createStreamServer } = require("./streamServer");
const { YankeesScheduler } = require("./yankeesScheduler");
const { WeatherService } = require("./weatherService");
const { CalendarService } = require("./calendarService");
const { DayCycleService } = require("./dayCycleService");
const { AmbientYouTubeService } = require("./ambientYouTubeService");

let mainWindow;
let config;
let logger;
let streamServer;
let scheduler;
let weatherService;
let calendarService;
let dayCycleService;
let ambientYouTubeService;
let mediaFiles = [];
let latestYankeesState = null;
let latestWeatherState = null;
let latestCalendarState = null;
let latestDayCycleState = null;
let latestAmbientState = null;
let latestAppModeState = null;
let lastLoggedAppMode = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

async function createWindow() {
  config = loadConfig();
  logger = createLogger({
    level: config.logLevel,
    logDir: path.join(config.__projectRoot, "logs")
  });
  logger.info("ClosetCast starting", { configPath: config.__configPath });

  mediaFiles = listMediaFiles(config, logger);
  streamServer = createStreamServer(config, logger);
  await streamServer.start();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#160f0b",
    fullscreen: Boolean(config.fullscreenOnLaunch),
    kiosk: Boolean(config.fullscreenOnLaunch),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  scheduler = new YankeesScheduler(config, logger, (state) => {
    latestYankeesState = state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("closetcast:yankees-state", state);
    }
    publishAppMode();
  });
  scheduler.start();

  weatherService = new WeatherService(config, logger, (state) => {
    latestWeatherState = state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("closetcast:weather-state", state);
    }
  });
  weatherService.start();

  calendarService = new CalendarService(config, logger, (state) => {
    latestCalendarState = state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("closetcast:calendar-state", state);
    }
  });
  calendarService.start();

  dayCycleService = new DayCycleService(config, logger, (state) => {
    latestDayCycleState = state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("closetcast:day-cycle-state", state);
    }
    publishAppMode();
  });
  dayCycleService.start();

  ambientYouTubeService = new AmbientYouTubeService(config, logger, (state) => {
    latestAmbientState = state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("closetcast:ambient-state", state);
    }
  });
  ambientYouTubeService.start();

  powerMonitor.on("resume", () => {
    logger.info("Wake/resume detected");
    publishAppMode();
  });
  powerMonitor.on("suspend", () => {
    logger.info("System suspend detected");
  });

  setInterval(() => {
    mediaFiles = listMediaFiles(config, logger);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("closetcast:media-updated", mediaFiles);
    }
  }, 5 * 60_000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.info("Blocked popup from embedded page", { url });
    return { action: "deny" };
  });
}

if (gotLock) {
  app.whenReady().then(createWindow).catch((error) => {
    const fallbackLogger = logger || createLogger({ logDir: path.join(process.cwd(), "logs") });
    fallbackLogger.error("ClosetCast failed to start", { error: error.stack || error.message });
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (streamServer) streamServer.stop();
  if (scheduler) scheduler.stop();
  if (weatherService) weatherService.stop();
  if (calendarService) calendarService.stop();
  if (dayCycleService) dayCycleService.stop();
  if (ambientYouTubeService) ambientYouTubeService.stop();
  if (process.platform !== "darwin") app.quit();
});

function publishAppMode() {
  const mode = computeAppMode();
  latestAppModeState = mode;
  if (lastLoggedAppMode !== mode.mode) {
    logger.info("App mode changed", { mode: mode.mode, reason: mode.reason });
    lastLoggedAppMode = mode.mode;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("closetcast:app-mode-state", mode);
  }
}

function computeAppMode() {
  if (latestDayCycleState?.mode === "winddown") {
    return {
      mode: "winddown",
      reason: "sleep wind-down window",
      message: latestDayCycleState.message
    };
  }

  if (latestYankeesState?.mode === "yankees") {
    return {
      mode: "yankees",
      reason: "Yankees game window",
      message: latestYankeesState.message
    };
  }

  return {
    mode: "normal",
    reason: "default dashboard",
    message: latestDayCycleState?.message || latestYankeesState?.message || "Dashboard"
  };
}

ipcMain.handle("closetcast:get-bootstrap", () => {
  return {
    config: getPublicConfig(config, streamServer.baseUrl, mediaFiles, logger.file),
    yankeesState: latestYankeesState,
    weatherState: latestWeatherState,
    calendarState: latestCalendarState,
    dayCycleState: latestDayCycleState,
    ambientState: latestAmbientState,
    appModeState: latestAppModeState
  };
});

ipcMain.handle("closetcast:refresh-schedule", async () => {
  if (scheduler) await scheduler.refreshNow();
  return latestYankeesState;
});

ipcMain.handle("closetcast:set-fullscreen", (_event, enabled) => {
  if (!mainWindow) return false;
  mainWindow.setKiosk(Boolean(enabled));
  mainWindow.setFullScreen(Boolean(enabled));
  return mainWindow.isFullScreen();
});

ipcMain.handle("closetcast:open-config-folder", async () => {
  await shell.openPath(path.dirname(config.__configPath));
  return true;
});

ipcMain.handle("closetcast:open-logs-folder", async () => {
  await shell.openPath(path.dirname(logger.file));
  return true;
});
