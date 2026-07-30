(function () {
  const listeners = {
    yankees: [],
    weather: [],
    calendar: [],
    dayCycle: [],
    appMode: [],
    ambient: [],
    media: []
  };

  const cameras = [
    { id: "garage", name: "Garage", streamUrl: "./placeholders/garage.svg", enabled: true, priority: 1 },
    { id: "front-yard", name: "Front Yard", streamUrl: "./placeholders/front-yard.svg", enabled: true, priority: 2 },
    { id: "back-yard", name: "Back Yard", streamUrl: "./placeholders/back-yard.svg", enabled: true, priority: 3 },
    { id: "side-yard", name: "Side Yard", streamUrl: "./placeholders/side-yard.svg", enabled: true, priority: 4 },
    { id: "ring", name: "Ring Doorbell", streamUrl: "./placeholders/ring.svg", enabled: true, priority: 5 }
  ];

  const now = new Date();
  const later = new Date(now.getTime() + 90 * 60 * 1000);
  const tomorrowMorning = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrowMorning.setHours(9, 0, 0, 0);
  const tomorrowAfternoon = new Date(tomorrowMorning.getTime() + 5 * 60 * 60 * 1000);

  const ambientEmbed = "https://www.youtube-nocookie.com/embed/9E-l9qYiqxQ?start=2725&autoplay=1&mute=1&controls=0&rel=0";
  const yankeesPlaceholder = "./yankees-placeholder.html";

  const bootstrap = {
    config: {
      configPath: "docs/demo (static mock)",
      cameraLayout: "five",
      focusedCameraId: "garage",
      primaryCameraId: "garage",
      layout: { cameraAspectRatio: "7 / 8" },
      cameras,
      media: {
        enabled: false,
        showDuringCameraMode: true,
        rotationSeconds: 90,
        files: []
      },
      yankees: {
        enabled: true,
        streamSiteUrl: yankeesPlaceholder
      },
      debug: {
        enabled: true,
        forceMode: "",
        ambientTitle: "Disneyland park B-roll",
        ambientUrl: ambientEmbed,
        yankeesUrl: yankeesPlaceholder,
        resolveYankeesNow: false
      },
      localBaseUrl: ""
    },
    yankeesState: {
      enabled: true,
      mode: "idle",
      message: "No game window right now",
      streamUrl: yankeesPlaceholder,
      streamError: null,
      game: null
    },
    weatherState: {
      enabled: true,
      message: "Mock briefing",
      weather: {
        locationName: "Almaden / Cambrian Park",
        label: "Today",
        condition: "Partly cloudy",
        high: 78,
        low: 56,
        currentTemp: 71,
        feelsLike: 70,
        rainChance: 10,
        wind: 8
      },
      traffic: {
        enabled: true,
        routeLabel: "Hwy 85 / West Valley Fwy",
        headline: "Clear",
        detail: "No matching incidents found",
        items: [],
        label: "QuickMap",
        quickMapUrl: "https://quickmap.dot.ca.gov/?ll=37.25,-121.95&z=11",
        updatedAt: now.toISOString()
      }
    },
    calendarState: {
      enabled: true,
      message: "Demo calendar",
      fromCache: false,
      error: null,
      events: [
        {
          title: "School pickup",
          location: "Los Altos",
          allDay: false,
          startTime: later.toISOString()
        },
        {
          title: "Trash night",
          location: "",
          allDay: true,
          startTime: now.toISOString()
        }
      ],
      tomorrowEvents: [
        {
          title: "Morning briefing",
          calendarName: "Family",
          allDay: false,
          startTime: tomorrowMorning.toISOString()
        },
        {
          title: "Practice",
          calendarName: "Kids",
          allDay: false,
          startTime: tomorrowAfternoon.toISOString()
        }
      ]
    },
    dayCycleState: {
      enabled: true,
      wakeTime: "09:00",
      sleepTime: "22:30",
      nextSleepLabel: "10:30 PM",
      nextWakeLabel: "9:00 AM",
      minutesUntilSleep: 180
    },
    ambientState: {
      enabled: true,
      visible: false,
      title: "Disneyland park B-roll",
      url: ambientEmbed,
      source: "demo",
      message: "Ready"
    },
    appModeState: {
      mode: "normal",
      message: "Dashboard"
    }
  };

  function notify(list, payload) {
    listeners[list].forEach((callback) => callback(payload));
  }

  window.closetCast = {
    getBootstrap: async () => structuredClone(bootstrap),
    refreshSchedule: async () => {
      bootstrap.yankeesState = {
        ...bootstrap.yankeesState,
        message: "Schedule refreshed (demo)"
      };
      notify("yankees", bootstrap.yankeesState);
      return bootstrap.yankeesState;
    },
    resolveYankeesStream: async () => {
      bootstrap.yankeesState = {
        enabled: true,
        mode: "yankees",
        message: "Demo Yankees stream",
        streamUrl: yankeesPlaceholder,
        streamError: null,
        game: {
          awayTeam: "New York Yankees",
          homeTeam: "Boston Red Sox",
          status: "Demo live",
          localStartTimeLabel: "Now"
        }
      };
      notify("yankees", bootstrap.yankeesState);
      return bootstrap.yankeesState;
    },
    refreshAmbient: async () => {
      bootstrap.ambientState = {
        enabled: true,
        visible: true,
        title: "Disneyland park B-roll",
        url: ambientEmbed,
        source: "demo",
        message: "Demo ambiance"
      };
      notify("ambient", bootstrap.ambientState);
      return bootstrap.ambientState;
    },
    setFullscreen: async () => {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    },
    openConfigFolder: async () => {},
    openLogsFolder: async () => {},
    openExternalUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onYankeesState: (callback) => listeners.yankees.push(callback),
    onWeatherState: (callback) => listeners.weather.push(callback),
    onCalendarState: (callback) => listeners.calendar.push(callback),
    onDayCycleState: (callback) => listeners.dayCycle.push(callback),
    onAppModeState: (callback) => listeners.appMode.push(callback),
    onAmbientState: (callback) => listeners.ambient.push(callback),
    onMediaUpdated: (callback) => listeners.media.push(callback)
  };
})();
