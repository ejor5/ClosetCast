const state = {
  config: null,
  yankees: null,
  weather: null,
  calendar: null,
  dayCycle: null,
  ambient: null,
  appMode: { mode: "normal", message: "Dashboard" },
  localModeOverride: null,
  mediaFiles: [],
  mediaIndex: 0,
  layout: "five",
  focusedCameraId: null,
  streamLoaded: false,
  loadedStreamUrl: "",
  loadedAmbientUrl: "",
  lastLayoutKey: "",
  cameraHealth: {}
};

const elements = {
  dashboard: document.querySelector("#dashboard"),
  stage: document.querySelector("#stage"),
  cameraWall: document.querySelector("#cameraWall"),
  infoRail: document.querySelector("#infoRail"),
  streamPanel: document.querySelector("#streamPanel"),
  ambientPanel: document.querySelector("#ambientPanel"),
  winddownPanel: document.querySelector("#winddownPanel"),
  mediaPanel: document.querySelector("#mediaPanel"),
  mediaImage: document.querySelector("#mediaImage"),
  mediaVideo: document.querySelector("#mediaVideo"),
  mediaCaption: document.querySelector("#mediaCaption"),
  clock: document.querySelector("#clock"),
  dateLabel: document.querySelector("#dateLabel"),
  modeStatus: document.querySelector("#modeStatus"),
  powerStatus: document.querySelector("#powerStatus"),
  cameraHealth: document.querySelector("#cameraHealth"),
  weatherBadge: document.querySelector("#weatherBadge"),
  weatherHeadline: document.querySelector("#weatherHeadline"),
  weatherDetails: document.querySelector("#weatherDetails"),
  calendarStatus: document.querySelector("#calendarStatus"),
  calendarEvents: document.querySelector("#calendarEvents"),
  tomorrowStatus: document.querySelector("#tomorrowStatus"),
  tomorrowEvents: document.querySelector("#tomorrowEvents"),
  winddownMessage: document.querySelector("#winddownMessage"),
  gameTitle: document.querySelector("#gameTitle"),
  gameStatus: document.querySelector("#gameStatus"),
  gameTime: document.querySelector("#gameTime"),
  streamView: document.querySelector("#streamView"),
  ambientTitle: document.querySelector("#ambientTitle"),
  ambientStatus: document.querySelector("#ambientStatus"),
  ambientView: document.querySelector("#ambientView"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsClose: document.querySelector("#settingsClose"),
  settingsPanel: document.querySelector("#settingsPanel"),
  fullscreenToggle: document.querySelector("#fullscreenToggle"),
  refreshSchedule: document.querySelector("#refreshSchedule"),
  openConfig: document.querySelector("#openConfig"),
  openLogs: document.querySelector("#openLogs"),
  configPath: document.querySelector("#configPath")
};

async function init() {
  const bootstrap = await window.closetCast.getBootstrap();
  state.config = bootstrap.config;
  state.yankees = bootstrap.yankeesState;
  state.weather = bootstrap.weatherState;
  state.calendar = bootstrap.calendarState;
  state.dayCycle = bootstrap.dayCycleState;
  state.ambient = bootstrap.ambientState;
  state.appMode = bootstrap.appModeState || state.appMode;
  state.mediaFiles = bootstrap.config.media.files;
  state.layout = bootstrap.config.cameraLayout || "five";
  state.focusedCameraId = bootstrap.config.primaryCameraId || bootstrap.config.focusedCameraId;

  document.documentElement.style.setProperty("--camera-aspect", bootstrap.config.layout.cameraAspectRatio);
  elements.configPath.textContent = bootstrap.config.configPath;
  renderAll(true);
  renderMedia();
  bindEvents();
  tickClock();

  setInterval(tickClock, 1000);
  setInterval(advanceMedia, Math.max(15, Number(state.config.media.rotationSeconds || 90)) * 1000);
  applyInitialDebugMode();
}

function renderAll(forceCameras = false) {
  const effectiveAppMode = getEffectiveAppMode();
  const layout = window.closetCastLayout.buildLayout({
    appMode: effectiveAppMode,
    cameraLayout: state.layout,
    cameras: state.config.cameras,
    focusedCameraId: state.focusedCameraId,
    primaryCameraId: state.config.primaryCameraId,
    ambient: state.ambient
  });

  elements.stage.className = layout.stageClass;
  elements.cameraWall.className = layout.cameraClass;
  elements.streamPanel.classList.toggle("hidden", !layout.showStream);
  elements.ambientPanel.classList.toggle("hidden", !layout.showAmbient);
  elements.winddownPanel.classList.toggle("hidden", !layout.showWinddown);
  elements.infoRail.classList.toggle("hidden", !layout.showInfoRail);

  const layoutKey = `${layout.mode}:${layout.cameraClass}:${layout.cameras.map((camera) => camera.id).join(",")}`;
  if (forceCameras || layoutKey !== state.lastLayoutKey) {
    state.lastLayoutKey = layoutKey;
    renderCameras(layout);
  }

  renderChrome();
  renderWeather();
  renderCalendar();
  renderWinddown();
  renderYankees();
  renderAmbient();
}

function renderCameras(layout) {
  elements.cameraWall.innerHTML = "";

  layout.cameras.forEach((camera, index) => {
    const tile = document.createElement("article");
    tile.className = `camera-tile ${index === 0 ? "primary" : ""}`;
    tile.dataset.cameraId = camera.id;

    const image = document.createElement("img");
    image.src = `${camera.streamUrl}?slot=${index}&t=${Date.now()}`;
    image.alt = `${camera.name} camera feed`;
    image.addEventListener("error", () => {
      state.cameraHealth[camera.id] = "reconnecting";
      tile.classList.add("offline");
      updateCameraHealth();
      setTimeout(() => {
        image.src = `${camera.streamUrl}?slot=${index}&retry=${Date.now()}`;
      }, 7000);
    });
    image.addEventListener("load", () => {
      state.cameraHealth[camera.id] = "online";
      tile.classList.remove("offline");
      updateCameraHealth();
    });

    const label = document.createElement("div");
    label.className = "camera-label";
    label.innerHTML = `<span>${escapeHtml(camera.name)}</span><small>${escapeHtml(state.cameraHealth[camera.id] || "RTSP")}</small>`;

    tile.append(image, label);
    tile.addEventListener("click", () => {
      state.focusedCameraId = camera.id;
      state.layout = "focus";
      renderAll(true);
      syncLayoutButtons();
    });
    elements.cameraWall.append(tile);
  });

  updateCameraHealth();
  syncLayoutButtons();
}

function renderChrome() {
  const appMode = getEffectiveAppMode();
  const modeLabel = appMode.mode === "yankees"
    ? "Yankees live"
    : appMode.mode === "winddown"
      ? "Wind-down"
      : "Dashboard";
  elements.modeStatus.textContent = `${modeLabel} - ${appMode.message || ""}`.trim();

  if (state.dayCycle) {
    elements.powerStatus.textContent = appMode.mode === "winddown"
      ? `Sleep in ${state.dayCycle.minutesUntilSleep} min`
      : `Next sleep ${state.dayCycle.nextSleepLabel} / wake ${state.dayCycle.nextWakeLabel}`;
  }
}

function renderWeather() {
  const weatherState = state.weather;
  const weather = weatherState?.weather;

  if (!weatherState?.enabled) {
    elements.weatherBadge.textContent = "Disabled";
    elements.weatherHeadline.textContent = "Weather disabled";
    elements.weatherDetails.innerHTML = "";
    return;
  }

  if (!weather) {
    elements.weatherBadge.textContent = "Offline";
    elements.weatherHeadline.textContent = weatherState.message || "Weather unavailable";
    elements.weatherDetails.innerHTML = weatherState.error ? `<span>${escapeHtml(weatherState.error)}</span>` : "<span>Waiting for weather</span>";
    return;
  }

  elements.weatherBadge.textContent = weather.label || "Today";
  elements.weatherHeadline.textContent = weather.locationName;
  elements.weatherDetails.innerHTML = [
    `<span>${escapeHtml(weather.condition)}</span>`,
    `<span>${weather.currentTemp ?? "--"}F now</span>`,
    `<span>High ${formatMaybe(weather.high)} / Low ${formatMaybe(weather.low)}</span>`,
    `<span>${weather.rainChance}% rain</span>`,
    `<span>${weather.wind} mph wind</span>`
  ].join("");
}

function renderCalendar() {
  const calendarState = state.calendar;
  if (!calendarState?.enabled) {
    elements.calendarStatus.textContent = "Disabled";
    elements.calendarEvents.innerHTML = `<p class="empty-events">Calendar not connected</p>`;
    return;
  }

  const cacheText = calendarState.fromCache ? "cached" : "live";
  elements.calendarStatus.textContent = calendarState.error ? `Using ${cacheText}` : calendarState.message || "Calendar";
  const events = calendarState.events || [];
  elements.calendarEvents.innerHTML = events.length
    ? events.map(renderCalendarEvent).join("")
    : `<p class="empty-events">${escapeHtml(calendarState.message || "No events")}</p>`;
}

function renderWinddown() {
  if (state.dayCycle) {
    elements.winddownMessage.textContent = `ClosetCast will put this laptop to sleep at ${state.dayCycle.sleepTime}. Wake is scheduled for ${state.dayCycle.wakeTime}.`;
  }

  const events = state.calendar?.tomorrowEvents || [];
  elements.tomorrowStatus.textContent = events.length ? `${events.length} item${events.length === 1 ? "" : "s"}` : "No events";
  elements.tomorrowEvents.innerHTML = events.length
    ? events.map(renderTomorrowEvent).join("")
    : `<p class="empty-events">No calendar events found for tomorrow.</p>`;
}

function renderYankees() {
  const yankees = state.yankees;
  if (!yankees) return;

  const game = yankees.game;
  if (game) {
    elements.gameTitle.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
    elements.gameStatus.textContent = game.status || yankees.mode;
    elements.gameTime.textContent = game.localStartTimeLabel || "";
  } else {
    elements.gameTitle.textContent = "Yankees schedule";
    elements.gameStatus.textContent = yankees.scheduleError ? "Unavailable" : yankees.message;
    elements.gameTime.textContent = "";
  }

  const shouldPrepare = yankees.mode === "preparing" || yankees.mode === "yankees" || getEffectiveAppMode().mode === "yankees";
  const targetStreamUrl = yankees.streamUrl || state.config.debug.yankeesUrl || state.config.yankees.streameastUrl;
  if (shouldPrepare && targetStreamUrl && state.loadedStreamUrl !== targetStreamUrl) {
    elements.streamView.src = targetStreamUrl;
    state.streamLoaded = true;
    state.loadedStreamUrl = targetStreamUrl;
  }
}

function renderMedia() {
  const mediaEnabled = state.config.media.enabled && state.config.media.showDuringCameraMode && state.mediaFiles.length > 0 && getEffectiveAppMode().mode === "normal" && !state.ambient?.visible;
  elements.mediaPanel.classList.toggle("hidden", !mediaEnabled);
  if (!mediaEnabled) return;

  const item = state.mediaFiles[state.mediaIndex % state.mediaFiles.length];
  elements.mediaCaption.textContent = item.name;
  elements.mediaImage.classList.toggle("hidden", item.type !== "image");
  elements.mediaVideo.classList.toggle("hidden", item.type !== "video");

  if (item.type === "image") {
    elements.mediaImage.src = item.url;
    elements.mediaVideo.removeAttribute("src");
  } else {
    elements.mediaVideo.src = item.url;
    elements.mediaVideo.play().catch(() => {});
    elements.mediaImage.removeAttribute("src");
  }
}

function renderAmbient() {
  const ambient = state.ambient;
  const visible = Boolean(ambient?.visible && getEffectiveAppMode().mode === "normal");
  elements.ambientPanel.classList.toggle("hidden", !visible);
  if (!ambient) return;

  elements.ambientTitle.textContent = ambient.title || "Ambient YouTube";
  elements.ambientStatus.textContent = ambient.error ? "Fallback" : ambient.source || ambient.message || "Rotating";
  if (visible && ambient.url && state.loadedAmbientUrl !== ambient.url) {
    elements.ambientView.src = ambient.url;
    state.loadedAmbientUrl = ambient.url;
  }
}

function advanceMedia() {
  if (!state.mediaFiles.length) return;
  state.mediaIndex = (state.mediaIndex + 1) % state.mediaFiles.length;
  renderMedia();
}

function applyYankeesState(nextState) {
  state.yankees = nextState;
  renderYankees();
}

function applyWeatherState(nextState) {
  state.weather = nextState;
  renderWeather();
}

function applyCalendarState(nextState) {
  state.calendar = nextState;
  renderCalendar();
  renderWinddown();
}

function applyDayCycleState(nextState) {
  state.dayCycle = nextState;
  renderChrome();
  renderWinddown();
}

function applyAppModeState(nextState) {
  state.appMode = nextState || { mode: "normal", message: "Dashboard" };
  renderAll();
  renderMedia();
}

function applyInitialDebugMode() {
  if (!state.config.debug.enabled) return;
  setDebugMode(state.config.debug.forceMode || "normal");
}

function cycleDebugMode() {
  const modes = ["normal", "ambient", "yankees", "winddown"];
  const currentMode = state.localModeOverride?.debugName || "normal";
  const nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
  setDebugMode(nextMode);
}

function setDebugMode(mode) {
  if (!state.config.debug.enabled) return;
  const normalized = mode === "ambient" ? "ambient" : mode === "yankees" ? "yankees" : mode === "winddown" ? "winddown" : "normal";
  state.localModeOverride = {
    mode: normalized === "ambient" ? "normal" : normalized,
    debugName: normalized,
    reason: "UI test override",
    message: `UI test: ${normalized}`
  };

  if (normalized === "ambient") {
    state.ambient = {
      enabled: true,
      visible: true,
      title: "UI test ambiance",
      url: state.config.debug.ambientUrl || "https://www.youtube.com/watch?v=9E-l9qYiqxQ&t=2725s&autoplay=1&mute=1",
      source: "debug",
      message: "UI test ambiance"
    };
  } else if (state.ambient?.source === "debug") {
    state.ambient = { ...state.ambient, visible: false };
  }

  renderAll();
  renderMedia();
}

function getEffectiveAppMode() {
  return state.localModeOverride || state.appMode;
}

function applyAmbientState(nextState) {
  state.ambient = nextState;
  renderAll();
  renderMedia();
}

function bindEvents() {
  elements.settingsToggle.addEventListener("click", () => elements.settingsPanel.classList.toggle("hidden"));
  elements.settingsClose.addEventListener("click", () => elements.settingsPanel.classList.add("hidden"));
  elements.fullscreenToggle.addEventListener("click", () => window.closetCast.setFullscreen(true));
  elements.refreshSchedule.addEventListener("click", () => window.closetCast.refreshSchedule());
  elements.openConfig.addEventListener("click", () => window.closetCast.openConfigFolder());
  elements.openLogs.addEventListener("click", () => window.closetCast.openLogsFolder());

  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      state.layout = button.dataset.layout;
      renderAll(true);
    });
  });

  elements.streamView.addEventListener("did-fail-load", () => {
    elements.streamPanel.classList.add("stream-unavailable");
  });
  elements.streamView.addEventListener("did-finish-load", () => {
    elements.streamPanel.classList.remove("stream-unavailable");
  });
  elements.ambientView.addEventListener("did-fail-load", () => {
    elements.ambientPanel.classList.add("stream-unavailable");
  });
  elements.ambientView.addEventListener("did-finish-load", () => {
    elements.ambientPanel.classList.remove("stream-unavailable");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "F1" || event.key === "Escape") {
      elements.settingsPanel.classList.toggle("hidden");
    }
    if (event.key >= "1" && event.key <= "5") {
      const layouts = ["focus", "split", "grid4", "five", "five"];
      state.layout = layouts[Number(event.key) - 1];
      renderAll(true);
    }
    if (event.key === "F6") {
      cycleDebugMode();
    }
  });

  window.closetCast.onYankeesState(applyYankeesState);
  window.closetCast.onWeatherState(applyWeatherState);
  window.closetCast.onCalendarState(applyCalendarState);
  window.closetCast.onDayCycleState(applyDayCycleState);
  window.closetCast.onAppModeState(applyAppModeState);
  window.closetCast.onAmbientState(applyAmbientState);
  window.closetCast.onMediaUpdated((files) => {
    state.mediaFiles = files;
    state.mediaIndex = 0;
    renderMedia();
  });
}

function updateCameraHealth() {
  const total = state.config?.cameras?.length || 0;
  const reconnecting = Object.values(state.cameraHealth).filter((status) => status === "reconnecting").length;
  elements.cameraHealth.textContent = reconnecting
    ? `${reconnecting}/${total} reconnecting`
    : `${total} cameras online`;

  document.querySelectorAll(".camera-tile").forEach((tile) => {
    const cameraId = tile.dataset.cameraId;
    const label = tile.querySelector(".camera-label small");
    if (label) label.textContent = state.cameraHealth[cameraId] || "RTSP";
  });
}

function renderCalendarEvent(event) {
  const time = formatEventTime(event);
  const location = event.location ? `<small>${escapeHtml(event.location)}</small>` : "";
  return `
    <div class="calendar-event">
      <time>${escapeHtml(time)}</time>
      <span>${escapeHtml(event.title)}</span>
      ${location}
    </div>
  `;
}

function renderTomorrowEvent(event) {
  const time = formatEventTime(event);
  const calendar = event.calendarName ? `<small>${escapeHtml(event.calendarName)}</small>` : "";
  return `
    <div class="tomorrow-event">
      <time>${escapeHtml(time)}</time>
      <div>
        <span>${escapeHtml(event.title)}</span>
        ${calendar}
      </div>
    </div>
  `;
}

function formatEventTime(event) {
  if (event.allDay) return "All day";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(event.startTime));
}

function formatMaybe(value) {
  return value === null || value === undefined ? "--" : `${value}F`;
}

function tickClock() {
  const now = new Date();
  elements.clock.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now);
  elements.dateLabel.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(now);
}

function syncLayoutButtons() {
  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.classList.toggle("active", button.dataset.layout === state.layout);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init().catch((error) => {
  document.body.innerHTML = `<pre class="fatal">ClosetCast failed to render:\n${escapeHtml(error.stack || error.message)}</pre>`;
});
