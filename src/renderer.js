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
  previousLayout: null,
  focusedCameraId: null,
  streamLoaded: false,
  loadedStreamUrls: {},
  loadedAmbientUrl: "",
  streamAutomationToken: 0,
  streamFullscreenClicked: {},
  yankeesResolveInFlight: false,
  ambientLoadToken: 0,
  ambientUnavailableUrl: "",
  ambientUnavailableSkips: 0,
  lastLayoutKey: "",
  cameraRenderToken: 0,
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
  streamViews: document.querySelector("#streamViews"),
  ambientTitle: document.querySelector("#ambientTitle"),
  ambientStatus: document.querySelector("#ambientStatus"),
  ambientView: document.querySelector("#ambientView"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsClose: document.querySelector("#settingsClose"),
  settingsPanel: document.querySelector("#settingsPanel"),
  fullscreenToggle: document.querySelector("#fullscreenToggle"),
  testStreamFullscreen: document.querySelector("#testStreamFullscreen"),
  refreshAmbient: document.querySelector("#refreshAmbient"),
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
  setInterval(advanceMedia, getMediaRotationMs());
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
    ambient: state.ambient,
    mediaActive: isMediaActive(effectiveAppMode)
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
  elements.cameraWall.querySelectorAll("img").forEach((image) => {
    image.removeAttribute("src");
  });
  elements.cameraWall.innerHTML = "";
  state.cameraRenderToken += 1;
  const renderToken = state.cameraRenderToken;

  layout.cameras.forEach((camera, index) => {
    const tile = document.createElement("article");
    tile.className = `camera-tile ${index === 0 ? "primary" : ""}`;
    tile.dataset.cameraId = camera.id;

    const image = document.createElement("img");
    image.alt = `${camera.name} camera feed`;
    const label = document.createElement("div");
    label.className = "camera-label";
    label.innerHTML = `<span>${escapeHtml(camera.name)}</span><small>Connecting</small>`;
    const labelStatus = label.querySelector("small");
    let loadWatchdog = null;

    const markCamera = (status) => {
      state.cameraHealth[camera.id] = status;
      tile.classList.toggle("offline", status !== "online");
      tile.dataset.status = status === "no signal" ? "No signal" : "Reconnecting";
      labelStatus.textContent = status === "online" ? "Live" : status === "no signal" ? "No signal" : "Retrying";
      updateCameraHealth();
    };

    const startLoadWatchdog = () => {
      clearTimeout(loadWatchdog);
      const timeoutSeconds = Number(state.config.streamServer?.firstFrameTimeoutSeconds || 15) + 3;
      loadWatchdog = setTimeout(() => {
        if (!tile.isConnected || (image.complete && image.naturalWidth > 0)) return;
        markCamera("no signal");
      }, Math.max(8000, timeoutSeconds * 1000));
    };

    const reloadImage = (reason) => {
      markCamera(reason);
      startLoadWatchdog();
      const param = reason === "no signal" ? "timeout" : "retry";
      image.src = withCameraParams(camera.streamUrl, {
        slot: index,
        view: renderToken,
        [param]: Date.now()
      });
    };

    image.addEventListener("error", () => {
      markCamera("reconnecting");
      setTimeout(() => {
        if (tile.isConnected) reloadImage("reconnecting");
      }, 7000);
    });
    image.addEventListener("load", () => {
      clearTimeout(loadWatchdog);
      markCamera("online");
    });
    reloadImage("reconnecting");

    tile.append(image, label);
    tile.addEventListener("click", () => toggleCameraFocus(camera.id));
    elements.cameraWall.append(tile);
  });

  updateCameraHealth();
  syncLayoutButtons();
}

function toggleCameraFocus(cameraId) {
  if (state.layout === "focus" && state.focusedCameraId === cameraId) {
    state.layout = state.previousLayout || state.config.cameraLayout || "five";
    state.previousLayout = null;
    state.focusedCameraId = null;
  } else {
    if (state.layout !== "focus") {
      state.previousLayout = state.layout;
    }
    state.focusedCameraId = cameraId;
    state.layout = "focus";
  }
  renderAll(true);
  syncLayoutButtons();
}

function renderChrome() {
  const appMode = getEffectiveAppMode();
  const modeLabel = appMode.mode === "yankees"
    ? "Favorites live"
    : appMode.mode === "winddown"
      ? "Wind-down"
      : "Dashboard";
  elements.modeStatus.textContent = `${modeLabel} - ${appMode.message || ""}`.trim();

  if (state.dayCycle) {
    elements.powerStatus.textContent = appMode.mode === "winddown"
      ? `Sleep in ${state.dayCycle.minutesUntilSleep} min`
      : `Next sleep ${state.dayCycle.nextSleepLabel} / wake ${state.dayCycle.nextWakeLabel}`;
  }
  syncModeButtons();
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
    elements.weatherDetails.innerHTML = [
      `<p class="weather-error">${escapeHtml(weatherState.error || "Waiting for weather")}</p>`,
      renderTraffic(weatherState.traffic)
    ].join("");
    return;
  }

  elements.weatherBadge.textContent = `Rain ${formatPercent(weather.rainChance)}`;
  elements.weatherHeadline.textContent = formatDegrees(weather.currentTemp);
  elements.weatherDetails.innerHTML = renderWeatherDetails(weather, weatherState.traffic);
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

  const streams = getFavoriteStreams(yankees);
  const game = streams[0]?.game || yankees.game;
  if (streams.length > 1) {
    elements.gameTitle.textContent = streams.map((stream) => stream.teamLabel).join(" / ");
    elements.gameStatus.textContent = `${streams.length} live`;
    elements.gameTime.textContent = streams.map((stream) => stream.localStartTimeLabel || "").filter(Boolean).join(" | ");
  } else if (game) {
    elements.gameTitle.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
    elements.gameStatus.textContent = game.status || yankees.mode;
    elements.gameTime.textContent = game.localStartTimeLabel || "";
  } else {
    elements.gameTitle.textContent = "Favorite teams";
    elements.gameStatus.textContent = yankees.scheduleError ? "Unavailable" : yankees.message;
    elements.gameTime.textContent = "";
  }

  const shouldPrepare = yankees.mode === "preparing" || yankees.mode === "yankees" || getEffectiveAppMode().mode === "yankees";
  if (!shouldPrepare) return;

  if (!streams.length) {
    const fallbackUrl = yankees.streamUrl || state.config.debug.yankeesUrl || state.config.yankees.streamSiteUrl;
    const fallbackStream = {
      teamKey: "favorite-test",
      teamLabel: "Favorite Team",
      title: game ? `${game.awayTeam} @ ${game.homeTeam}` : "Stream test",
      status: yankees.streamError || yankees.message || "Loading",
      localStartTimeLabel: game?.localStartTimeLabel || "Now",
      streamUrl: fallbackUrl,
      streamError: yankees.streamError,
      game
    };
    renderStreamViews(fallbackUrl ? [fallbackStream] : []);
  } else {
    renderStreamViews(streams);
  }
}

function getFavoriteStreams(yankees) {
  return Array.isArray(yankees.streams)
    ? yankees.streams.filter((stream) => stream && stream.streamUrl)
    : [];
}

function renderStreamViews(streams) {
  if (!streams.length) {
    elements.streamPanel.dataset.status = state.yankees?.streamError || "Add stream site URL in config";
    elements.streamPanel.classList.add("stream-unavailable");
    elements.streamViews.innerHTML = "";
    state.loadedStreamUrls = {};
    return;
  }

  elements.streamPanel.dataset.status = streams.length > 1 ? "Loading favorite team streams" : `Loading ${streams[0].teamLabel || "favorite"} stream`;
  elements.streamPanel.classList.remove("stream-unavailable");
  elements.streamPanel.classList.toggle("has-multiple-streams", streams.length > 1);
  elements.streamViews.className = `stream-views stream-count-${Math.min(streams.length, 4)}`;

  const nextKeys = new Set(streams.map((stream, index) => stream.teamKey || `stream-${index}`));
  for (const key of Object.keys(state.loadedStreamUrls)) {
    if (!nextKeys.has(key)) delete state.loadedStreamUrls[key];
  }
  elements.streamViews.querySelectorAll(".stream-tile").forEach((tile) => {
    if (!nextKeys.has(tile.dataset.team)) tile.remove();
  });

  streams.forEach((stream, index) => {
    const key = stream.teamKey || `stream-${index}`;
    let tile = elements.streamViews.querySelector(`.stream-tile[data-team="${cssEscape(key)}"]`);
    let view = tile?.querySelector("webview");
    if (!tile) {
      tile = document.createElement("article");
      tile.className = "stream-tile";
      tile.dataset.team = key;
      const label = document.createElement("div");
      label.className = "stream-tile-label";
      view = document.createElement("webview");
      view.setAttribute("partition", `persist:closetcast-stream-${key}`);
      view.setAttribute("allowpopups", "false");
      view.dataset.streamKey = key;
      view.addEventListener("did-fail-load", () => {
        tile.dataset.status = `${stream.teamLabel || "Favorite"} stream failed to load`;
        tile.classList.add("stream-unavailable");
      });
      view.addEventListener("did-finish-load", () => {
        tile.classList.remove("stream-unavailable");
        [0, 1000, 3000, 8000, 14000].forEach((delay) => scheduleYankeesFullscreenClick(key, view, delay));
      });
      tile.append(label, view);
    }

    tile.dataset.status = stream.streamError || "Stream page unavailable";
    if (stream.streamError) tile.classList.add("stream-unavailable");
    else tile.classList.remove("stream-unavailable");

    const label = tile.querySelector(".stream-tile-label");
    label.innerHTML = `
      <span>${escapeHtml(stream.teamLabel || "Favorite")}</span>
      <strong>${escapeHtml(stream.title || "Game stream")}</strong>
    `;
    elements.streamViews.append(tile);
    if (state.loadedStreamUrls[key] !== stream.streamUrl) {
      view.src = stream.streamUrl;
      state.loadedStreamUrls[key] = stream.streamUrl;
      state.streamFullscreenClicked[key] = false;
      state.streamAutomationToken += 1;
    }
  });
  state.streamLoaded = true;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function scheduleYankeesFullscreenClick(key, view, delayMs = 0) {
  const token = state.streamAutomationToken;
  setTimeout(() => {
    if (token !== state.streamAutomationToken) return;
    clickYankeesFullscreenIfVisible(key, view).catch(() => {});
  }, delayMs);
}

async function clickYankeesFullscreenIfVisible(key, view) {
  if (!view?.src || elements.streamPanel.classList.contains("hidden") || state.streamFullscreenClicked[key]) return null;
  const result = await view.executeJavaScript(`(${clickFullscreenInPage.toString()})()`, true);
  if (result?.clickedFullscreen || result?.alreadyFullscreen) {
    state.streamFullscreenClicked[key] = true;
  }
  return result;
}

function clickFullscreenInPage() {
  const positiveWords = /\b(fullscreen|full screen|full-screen|enter fullscreen|enter full screen|maximize|expand|theater|cinema|vjs fullscreen control|jw icon fullscreen|ytp fullscreen button|pip-fullscreen)\b/;
  const negativeWords = /\b(exit|restore|windowed|close|collapse|minimize|normal screen)\b/;

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return rect.width > 0
      && rect.height > 0
      && centerX >= 0
      && centerY >= 0
      && centerX <= window.innerWidth
      && centerY <= window.innerHeight
      && style.visibility !== "hidden"
      && style.display !== "none"
      && Number(style.opacity || 1) > 0;
  };

  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, " ").trim();
  const describe = (element) => normalize([
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("class"),
    element.getAttribute("id"),
    element.getAttribute("name"),
    element.getAttribute("alt"),
    element.getAttribute("data-title"),
    element.getAttribute("data-tooltip"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("data-qa"),
    element.getAttribute("data-control"),
    element.getAttribute("data-button"),
    element.getAttribute("aria-describedby"),
    element.querySelector?.("svg title")?.textContent,
    element.querySelector?.("use")?.getAttribute("href"),
    element.querySelector?.("use")?.getAttribute("xlink:href")
  ].filter(Boolean).join(" "));
  const isFullscreenButton = (element) => {
    const label = describe(element);
    if (!label || negativeWords.test(label)) return false;
    return positiveWords.test(label);
  };
  const collectCandidates = (root, depth = 0) => {
    if (!root || depth > 3) return [];
    const selectors = [
      "button",
      "[role='button']",
      "[aria-label]",
      "[title]",
      "[class*='fullscreen' i]",
      "[id*='fullscreen' i]",
      "[class*='full-screen' i]",
      "[id*='full-screen' i]",
      "[class*='maximize' i]",
      "[id*='maximize' i]",
      ".vjs-fullscreen-control",
      ".jw-icon-fullscreen",
      ".ytp-fullscreen-button"
    ].join(", ");
    const nodes = [];
    try {
      nodes.push(...root.querySelectorAll(selectors));
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) nodes.push(...collectCandidates(element.shadowRoot, depth + 1));
      });
      root.querySelectorAll("iframe").forEach((frame) => {
        try {
          const documentRoot = frame.contentDocument || frame.contentWindow?.document;
          if (documentRoot) nodes.push(...collectCandidates(documentRoot, depth + 1));
        } catch (_) {
          // Cross-origin player frames cannot be inspected from the host page.
        }
      });
    } catch (_) {
      return nodes;
    }
    return nodes.filter((element, index, list) => list.indexOf(element) === index);
  };

  if (document.fullscreenElement) {
    return { clickedFullscreen: false, alreadyFullscreen: true };
  }

  const candidates = collectCandidates(document);

  for (const element of candidates) {
    const button = element.closest("button, [role='button']") || element;
    if (isVisible(button) && isFullscreenButton(button)) {
      button.scrollIntoView?.({ block: "center", inline: "center" });
      button.click();
      return { clickedFullscreen: true, label: describe(button) };
    }
  }

  const target = document.querySelector("video, iframe, .video-js, .jwplayer, [class*='player' i], [id*='player' i]") || document.documentElement;
  if (target?.requestFullscreen) {
    return target.requestFullscreen()
      .then(() => ({ clickedFullscreen: false, requestedFullscreen: true, target: target.tagName || "element" }))
      .catch((error) => ({ clickedFullscreen: false, requestedFullscreen: false, error: error.message || String(error) }));
  }

  return { clickedFullscreen: false, requestedFullscreen: false, error: "No fullscreen control or requestFullscreen target found" };
}

async function testStreamFullscreenNow() {
  const originalLabel = elements.testStreamFullscreen.textContent;
  const views = [...elements.streamViews.querySelectorAll("webview")].filter((view) => view.src);
  elements.testStreamFullscreen.disabled = true;
  elements.testStreamFullscreen.textContent = "Testing...";
  try {
    if (!views.length) {
      elements.testStreamFullscreen.textContent = "No stream";
      return;
    }
    const results = [];
    for (const view of views) {
      const key = view.dataset.streamKey || "stream";
      state.streamFullscreenClicked[key] = false;
      const result = await clickYankeesFullscreenIfVisible(key, view);
      results.push(result);
    }
    const successes = results.filter((result) => result?.clickedFullscreen || result?.alreadyFullscreen || result?.requestedFullscreen).length;
    elements.testStreamFullscreen.textContent = successes ? `OK ${successes}/${views.length}` : "No button";
  } catch (_) {
    elements.testStreamFullscreen.textContent = "Failed";
  } finally {
    setTimeout(() => {
      elements.testStreamFullscreen.disabled = false;
      elements.testStreamFullscreen.textContent = originalLabel;
    }, 1800);
  }
}

function renderMedia() {
  const mediaEnabled = isMediaActive(getEffectiveAppMode());
  elements.dashboard.classList.toggle("has-media", mediaEnabled);
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

function isMediaActive(appMode) {
  return Boolean(
    state.config?.media?.enabled &&
    state.config.media.showDuringCameraMode &&
    state.mediaFiles.length > 0 &&
    appMode.mode === "normal" &&
    !state.ambient?.visible
  );
}

function renderAmbient() {
  const ambient = state.ambient;
  const visible = Boolean(ambient?.visible && getEffectiveAppMode().mode === "normal");
  elements.ambientPanel.classList.toggle("hidden", !visible);
  if (!ambient) return;

  elements.ambientTitle.textContent = ambient.title || "Ambient YouTube";
  elements.ambientStatus.textContent = ambient.error ? "Fallback" : ambient.source || ambient.message || "Rotating";
  const targetAmbientUrl = getAmbientWebviewUrl(ambient.url);
  if (visible && targetAmbientUrl && state.loadedAmbientUrl !== targetAmbientUrl) {
    elements.ambientView.src = targetAmbientUrl;
    state.loadedAmbientUrl = targetAmbientUrl;
    state.ambientLoadToken += 1;
    state.ambientUnavailableUrl = "";
  }
}

function scheduleAmbientUnavailableCheck(delayMs, resetOnClear = false) {
  const token = state.ambientLoadToken;
  setTimeout(() => {
    if (token !== state.ambientLoadToken) return;
    checkAmbientUnavailable(resetOnClear).catch(() => {});
  }, delayMs);
}

async function checkAmbientUnavailable(resetOnClear = false) {
  if (!elements.ambientView.src || elements.ambientPanel.classList.contains("hidden")) return;
  const result = await elements.ambientView.executeJavaScript(`(${detectAmbientUnavailableInPage.toString()})()`, true);
  if (result?.unavailable) {
    refreshAmbientAfterUnavailable(result.reason || "Ambient YouTube video unavailable");
  } else if (resetOnClear) {
    state.ambientUnavailableSkips = 0;
  }
}

function detectAmbientUnavailableInPage() {
  const status = window.__closetCastYouTubeStatus;
  if (status?.unavailable) {
    return { unavailable: true, reason: status.reason || "YouTube player error" };
  }
  if (status && !status.playing && Date.now() - Number(status.startedAt || status.updatedAt || Date.now()) > 22000) {
    return { unavailable: true, reason: status.reason || "YouTube stayed black or did not start" };
  }

  const text = String(document.body?.innerText || document.documentElement?.innerText || "").toLowerCase();
  const unavailable = [
    "video unavailable",
    "this video is unavailable",
    "video unavalible",
    "watch on youtube",
    "watch this video on youtube",
    "playback error",
    "an error occurred"
  ].some((phrase) => text.includes(phrase));
  return {
    unavailable,
    reason: unavailable ? "YouTube unavailable page" : ""
  };
}

function refreshAmbientAfterUnavailable(reason) {
  const url = state.loadedAmbientUrl || elements.ambientView.src;
  if (!url || state.ambientUnavailableUrl === url) return;
  if (state.ambientUnavailableSkips >= 8) {
    elements.ambientStatus.textContent = "Video unavailable";
    return;
  }

  state.ambientUnavailableUrl = url;
  state.ambientUnavailableSkips += 1;
  elements.ambientStatus.textContent = "Picking next";
  elements.ambientPanel.dataset.status = "Picking another Disney stream";
  elements.ambientPanel.classList.add("stream-unavailable");
  if (window.closetCast.reportAmbientFailure) {
    window.closetCast.reportAmbientFailure(url, reason).catch(() => {});
  }
  window.closetCast.refreshAmbient().then((nextState) => {
    if (nextState) {
      state.ambient = nextState;
      renderAll();
    }
  }).catch((error) => {
    elements.ambientStatus.textContent = reason || error.message || "Video unavailable";
  });
}

function advanceMedia() {
  if (!state.mediaFiles.length) return;
  state.mediaIndex = (state.mediaIndex + 1) % state.mediaFiles.length;
  renderMedia();
}

function getMediaRotationMs() {
  const configuredSeconds = Number(state.config?.media?.rotationSeconds || 20);
  const seconds = Number.isFinite(configuredSeconds) ? configuredSeconds : 20;
  const clampedSeconds = Math.min(30, Math.max(8, seconds));
  return clampedSeconds * 1000;
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
  const normalized = mode === "ambient" ? "ambient" : mode === "yankees" ? "yankees" : mode === "winddown" ? "winddown" : "normal";
  state.localModeOverride = {
    mode: normalized === "ambient" ? "normal" : normalized,
    debugName: normalized,
    reason: "UI test override",
    message: `UI test: ${normalized}`
  };

  if (normalized === "ambient") {
    if (state.config.debug.ambientUrl) {
      state.ambient = {
        enabled: true,
        visible: true,
        title: state.config.debug.ambientTitle || "UI test ambiance",
        url: state.config.debug.ambientUrl,
        source: "debug",
        message: "UI test ambiance"
      };
    } else {
      state.ambient = {
        ...(state.ambient || {}),
        enabled: true,
        visible: true,
        title: state.ambient?.title || state.config.debug.ambientTitle || "Resolving Mattercam",
        source: state.ambient?.source || "debug",
        message: state.ambient?.message || "Resolving first YouTube result"
      };
      window.closetCast.refreshAmbient().then((nextState) => {
        if (state.localModeOverride?.debugName === "ambient" && nextState) {
          applyAmbientState({ ...nextState, visible: true });
        }
      }).catch((error) => {
        state.ambient = {
          ...state.ambient,
          visible: true,
          error: error.message,
          message: "Ambient refresh failed"
        };
        renderAmbient();
      });
    }
  } else if (state.ambient) {
    state.ambient = { ...state.ambient, visible: false };
  }

  if (normalized === "yankees") {
    forceResolveYankeesStream();
  }

  renderAll();
  renderMedia();
  syncModeButtons();
}

async function refreshAmbientNow() {
  const originalLabel = elements.refreshAmbient.textContent;
  elements.refreshAmbient.disabled = true;
  elements.refreshAmbient.textContent = "Picking...";
  try {
    const nextState = await window.closetCast.refreshAmbient();
    if (nextState) {
      applyAmbientState(nextState);
    }
  } catch (error) {
    state.ambient = {
      ...(state.ambient || {}),
      enabled: true,
      visible: state.localModeOverride?.debugName === "ambient",
      error: error.message,
      message: "Ambient refresh failed"
    };
    renderAmbient();
  } finally {
    elements.refreshAmbient.disabled = false;
    elements.refreshAmbient.textContent = originalLabel;
  }
}

function forceResolveYankeesStream() {
  if (state.yankeesResolveInFlight) return;
  const baseUrl = state.config.yankees.streamSiteUrl || state.config.debug.yankeesUrl;
  if (!baseUrl) {
    state.yankees = {
      ...(state.yankees || {}),
      enabled: true,
      mode: "yankees",
      message: "UI test: favorite stream URL missing",
      streamUrl: "",
      streamError: "Add yankees.streamSiteUrl in config or paste it in Test-ClosetCast.cmd",
      game: state.yankees?.game || {
        awayTeam: "New York Yankees",
        homeTeam: "Stream test",
        status: "Needs URL",
        localStartTimeLabel: "Now"
      }
    };
    renderYankees();
    return;
  }
  state.yankees = {
    ...(state.yankees || {}),
    enabled: true,
    mode: "yankees",
    message: "UI test: resolving current favorite team page",
    streamUrl: baseUrl,
    streamError: null,
    game: state.yankees?.game || {
      awayTeam: "New York Yankees",
      homeTeam: "Stream test",
      status: "Resolving",
      localStartTimeLabel: "Now"
    }
  };
  renderYankees();

  state.yankeesResolveInFlight = true;
  window.closetCast.resolveYankeesStream().then((nextState) => {
    if (state.localModeOverride?.debugName === "yankees" && nextState) {
      applyYankeesState({ ...nextState, mode: "yankees" });
      renderAll();
    }
  }).catch((error) => {
    state.yankees = {
      ...state.yankees,
      streamError: error.message,
      message: "UI test: favorite resolver failed; showing base page"
    };
    renderYankees();
  }).finally(() => {
    state.yankeesResolveInFlight = false;
  });
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
  elements.testStreamFullscreen.addEventListener("click", testStreamFullscreenNow);
  elements.refreshAmbient.addEventListener("click", refreshAmbientNow);
  elements.refreshSchedule.addEventListener("click", () => window.closetCast.refreshSchedule());
  elements.openConfig.addEventListener("click", () => window.closetCast.openConfigFolder());
  elements.openLogs.addEventListener("click", () => window.closetCast.openLogsFolder());
  elements.dashboard.addEventListener("click", (event) => {
    const externalButton = event.target.closest("[data-external-url]");
    if (externalButton) {
      window.closetCast.openExternalUrl(externalButton.dataset.externalUrl).catch(() => {});
    }
  });

  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      state.layout = button.dataset.layout;
      state.previousLayout = null;
      if (state.layout !== "focus") {
        state.focusedCameraId = null;
      } else if (!state.focusedCameraId) {
        state.focusedCameraId = state.config.primaryCameraId || state.config.focusedCameraId;
      }
      renderAll(true);
    });
  });

  document.querySelectorAll("[data-test-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setDebugMode(button.dataset.testMode);
    });
  });

  elements.ambientView.addEventListener("did-fail-load", (event) => {
    if (event.errorCode === -3) return;
    elements.ambientPanel.dataset.status = "Ambient YouTube failed to load";
    elements.ambientPanel.classList.add("stream-unavailable");
    refreshAmbientAfterUnavailable("Ambient YouTube failed to load");
  });
  elements.ambientView.addEventListener("did-finish-load", () => {
    elements.ambientPanel.classList.remove("stream-unavailable");
    scheduleAmbientUnavailableCheck(1800);
    scheduleAmbientUnavailableCheck(5000);
    scheduleAmbientUnavailableCheck(10000, true);
    scheduleAmbientUnavailableCheck(17000);
    scheduleAmbientUnavailableCheck(24000);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "F1" || event.key === "Escape") {
      elements.settingsPanel.classList.toggle("hidden");
    }
    if (event.key >= "1" && event.key <= "5") {
      const layouts = ["focus", "split", "grid4", "five", "five"];
      state.layout = layouts[Number(event.key) - 1];
      state.previousLayout = null;
      if (state.layout !== "focus") {
        state.focusedCameraId = null;
      } else if (!state.focusedCameraId) {
        state.focusedCameraId = state.config.primaryCameraId || state.config.focusedCameraId;
      }
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
    renderAll(true);
    renderMedia();
  });
}

function updateCameraHealth() {
  const total = state.config?.cameras?.length || 0;
  const statuses = Object.values(state.cameraHealth);
  const offline = statuses.filter((status) => status && status !== "online").length;
  elements.cameraHealth.textContent = offline
    ? `${offline}/${total} need attention`
    : `${total} cameras online`;

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

function renderWeatherDetails(weather, traffic) {
  return `
    <div class="weather-ambient-strip">
      <span>Hi <strong>${escapeHtml(formatDegrees(weather.high))}</strong></span>
      <span>Lo <strong>${escapeHtml(formatDegrees(weather.low))}</strong></span>
    </div>
    <section class="weather-hero">
      <div class="weather-temps">
        <div class="temp-pair high">
          <span>High</span>
          <strong>${escapeHtml(formatDegrees(weather.high))}</strong>
        </div>
        <div class="temp-pair low">
          <span>Low</span>
          <strong>${escapeHtml(formatDegrees(weather.low))}</strong>
        </div>
      </div>
      <div class="weather-now">
        <span>Now</span>
        <strong>${escapeHtml(weather.condition || "Weather")}</strong>
        <small>Feels ${escapeHtml(formatDegrees(weather.feelsLike))}</small>
      </div>
    </section>
    <section class="weather-metrics">
      <div class="metric-card rain">
        <span>Rain</span>
        <strong>${escapeHtml(formatPercent(weather.rainChance))}</strong>
      </div>
      <div class="metric-card wind">
        <span>Wind</span>
        <strong>${escapeHtml(formatSpeed(weather.wind))}</strong>
      </div>
    </section>
    <section class="clothing-card">
      <span>${escapeHtml(weather.locationName || "Weather")}</span>
      <strong>${escapeHtml(weather.clothing || "Comfort layers")}</strong>
    </section>
    ${renderTraffic(traffic)}
  `;
}

function renderTraffic(traffic) {
  if (!traffic || !traffic.enabled) return "";
  const routes = Array.isArray(traffic.routes) ? traffic.routes : [];
  const items = traffic.items || [];
  const itemMarkup = routes.length
    ? routes.map(renderTrafficRoute).join("")
    : items.length
    ? items.map(renderTrafficItem).join("")
    : `<li>${escapeHtml(traffic.detail || "No matching incidents found")}</li>`;
  const updated = traffic.updatedAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(traffic.updatedAt)) : "live view";
  const quickMap = traffic.quickMapUrl
    ? `<button class="traffic-link" data-external-url="${escapeHtml(traffic.quickMapUrl)}">${escapeHtml(traffic.label || "QuickMap")}</button>`
    : `<span>${escapeHtml(traffic.label || "Traffic")}</span>`;

  return `
    <section class="traffic-card ${traffic.error ? "traffic-unavailable" : ""}">
      <div class="traffic-route">
        <span>${escapeHtml(traffic.routeLabel || "Traffic")}</span>
        <strong>${escapeHtml(traffic.headline || "Traffic")}</strong>
      </div>
      <ul>${itemMarkup}</ul>
      <div class="traffic-source">
        ${quickMap}
        <span>${escapeHtml(updated)}</span>
      </div>
    </section>
  `;
}

function renderTrafficRoute(route) {
  const items = route.items || [];
  const incidentMarkup = items.length
    ? items.map((item) => renderTrafficItem(item, route.label)).join("")
    : `<li class="traffic-incident clear"><span>${escapeHtml(route.label)}</span>No matching incidents</li>`;
  return `
    <li class="traffic-route-item">
      <span>${escapeHtml(route.label)}</span>
      <strong>${escapeHtml(route.headline || "Traffic")}</strong>
    </li>
    ${incidentMarkup}
  `;
}

function renderTrafficItem(item, routeLabel = item.routeLabel) {
  const direction = item.direction ? ` ${item.direction}` : "";
  const label = routeLabel ? `${routeLabel}${direction}` : direction.trim();
  return `
    <li class="traffic-incident">
      ${label ? `<span>${escapeHtml(label)}</span>` : ""}
      ${escapeHtml(item.text)}
    </li>
  `;
}

function formatDegrees(value) {
  return value === null || value === undefined ? "--" : `${value}F`;
}

function formatPercent(value) {
  return value === null || value === undefined ? "--" : `${value}%`;
}

function formatSpeed(value) {
  return value === null || value === undefined ? "--" : `${value} mph`;
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

function syncModeButtons() {
  const activeMode = state.localModeOverride?.debugName || getEffectiveAppMode().mode || "normal";
  document.querySelectorAll("[data-test-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.testMode === activeMode);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withCameraParams(rawUrl, params) {
  const separator = rawUrl.includes("?") ? "&" : "?";
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${rawUrl}${separator}${query}`;
}

function getAmbientWebviewUrl(rawUrl) {
  if (!rawUrl) return "";
  if (!isYouTubeEmbedUrl(rawUrl)) return rawUrl;
  const baseUrl = state.config.localBaseUrl;
  if (!baseUrl) return rawUrl;
  const url = new URL("/youtube-player", baseUrl);
  url.searchParams.set("src", rawUrl);
  return url.toString();
}

function isYouTubeEmbedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./, "");
    return (hostname === "youtube.com" || hostname === "youtube-nocookie.com") && url.pathname.startsWith("/embed/");
  } catch (_) {
    return false;
  }
}

init().catch((error) => {
  document.body.innerHTML = `<pre class="fatal">ClosetCast failed to render:\n${escapeHtml(error.stack || error.message)}</pre>`;
});
