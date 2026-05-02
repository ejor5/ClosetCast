const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DEFAULT_TRAFFIC_CONFIG = {
  enabled: true,
  label: "San Jose traffic",
  routeLabel: "Hwy 85 / West Valley Fwy",
  incidentUrl: "https://cad.chp.ca.gov/Traffic.aspx",
  quickMapUrl: "https://quickmap.dot.ca.gov/?ll=37.25,-121.95&z=11",
  keywords: ["SR-85", "CA-85", "Highway 85", "West Valley", "West Valley Fwy", "West Valley Freeway"],
  maxItems: 3
};

class WeatherService {
  constructor(config, logger, onUpdate) {
    this.config = config.morningBriefing || {};
    this.trafficConfig = { ...DEFAULT_TRAFFIC_CONFIG, ...(config.traffic || {}) };
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.state = {
      enabled: Boolean(this.config.enabled),
      visible: false,
      message: "Morning briefing idle",
      weather: null,
      traffic: null,
      error: null
    };
  }

  start() {
    if (!this.config.enabled) {
      this.publish({ message: "Morning briefing disabled" });
      return;
    }

    this.refresh();
    const minutes = Number(this.config.refreshMinutes || 30);
    this.timer = setInterval(() => this.refresh(), Math.max(5, minutes) * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    const now = new Date();
    const visible = isWithinMorningWindow(now, this.config);
    if (!visible) {
      this.publish({ visible: false, message: "Morning briefing outside display hours" });
      return;
    }

    const location = selectLocation(this.config, now);
    if (!location) {
      this.publish({ visible: true, weather: null, error: "No weather location configured", message: "Weather location missing" });
      return;
    }

    const weatherRequest = fetchWeather(location, this.config);
    const trafficRequest = fetchTraffic(this.trafficConfig, this.logger);
    const [weatherResult, trafficResult] = await Promise.allSettled([weatherRequest, trafficRequest]);

    const traffic = trafficResult.status === "fulfilled" ? trafficResult.value : buildTrafficUnavailable(this.trafficConfig, trafficResult.reason);
    if (trafficResult.status === "rejected") {
      this.logger.warn("Traffic fetch failed", { error: trafficResult.reason.message });
    }

    if (weatherResult.status === "fulfilled") {
      const weather = weatherResult.value;
      this.publish({
        visible: true,
        weather,
        traffic,
        error: null,
        message: `${weather.locationName}: ${weather.summary}`
      });
    } else {
      const error = weatherResult.reason;
      this.logger.warn("Weather fetch failed", { error: error.message, location: location.name });
      this.publish({
        visible: true,
        weather: null,
        traffic,
        error: error.message,
        message: "Weather unavailable"
      });
    }
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, enabled: Boolean(this.config.enabled) };
    this.onUpdate(this.state);
  }
}

async function fetchWeather(location, config) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset",
    current: "temperature_2m,apparent_temperature,weather_code",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    forecast_days: "1"
  });
  const endpoint = config.endpoint || "https://api.open-meteo.com/v1/forecast";
  const response = await fetch(`${endpoint}?${params}`);
  if (!response.ok) throw new Error(`Weather source returned ${response.status}`);
  const data = await response.json();

  const daily = data.daily || {};
  const current = data.current || {};
  const code = Number(daily.weather_code?.[0] ?? current.weather_code);
  const condition = weatherCodeToText(code);
  const high = Math.round(Number(daily.temperature_2m_max?.[0]));
  const low = Math.round(Number(daily.temperature_2m_min?.[0]));
  const currentTemp = Math.round(Number(current.temperature_2m));
  const feelsLike = Math.round(Number(current.apparent_temperature));
  const rainChance = Math.round(Number(daily.precipitation_probability_max?.[0] || 0));
  const wind = Math.round(Number(daily.wind_speed_10m_max?.[0] || 0));

  return {
    locationId: location.id,
    locationName: location.name,
    label: location.label || "",
    condition,
    weatherCode: code,
    currentTemp: Number.isFinite(currentTemp) ? currentTemp : null,
    feelsLike: Number.isFinite(feelsLike) ? feelsLike : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    rainChance,
    wind,
    sunrise: daily.sunrise?.[0] || "",
    sunset: daily.sunset?.[0] || "",
    summary: buildSummary(condition, high, low, rainChance)
  };
}

function selectLocation(config, date) {
  const locations = Array.isArray(config.locations) ? config.locations : [];
  const dayName = DAY_NAMES[date.getDay()];
  const override = (config.weekdayLocationOverrides || []).find((rule) => {
    return (rule.days || []).map((day) => String(day).toLowerCase()).includes(dayName);
  });
  const locationId = override?.locationId || config.defaultLocationId;
  const location = locations.find((candidate) => candidate.id === locationId) || locations[0];
  if (!location) return null;
  return {
    ...location,
    label: override?.label || location.label || ""
  };
}

function isWithinMorningWindow(date, config) {
  if (config.showAllDay) return true;
  const start = Number(config.showStartHour ?? 5);
  const end = Number(config.showEndHour ?? 11);
  const hour = date.getHours() + date.getMinutes() / 60;
  return hour >= start && hour < end;
}

function buildSummary(condition, high, low, rainChance) {
  const temps = Number.isFinite(high) && Number.isFinite(low) ? `${high}/${low}F` : "temps unavailable";
  return `${condition}, ${temps}, ${rainChance}% rain`;
}

function weatherCodeToText(code) {
  if (code === 0) return "Clear";
  if ([1, 2].includes(code)) return "Mostly clear";
  if (code === 3) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Storms";
  return "Mixed skies";
}

async function fetchTraffic(config = {}, logger = console) {
  const trafficConfig = {
    ...DEFAULT_TRAFFIC_CONFIG,
    ...config
  };

  if (!trafficConfig.enabled) {
    return {
      enabled: false,
      label: trafficConfig.label,
      routeLabel: trafficConfig.routeLabel,
      headline: "Traffic disabled",
      detail: "",
      items: [],
      quickMapUrl: trafficConfig.quickMapUrl,
      updatedAt: null,
      error: null
    };
  }

  if (!trafficConfig.incidentUrl) {
    return buildTrafficUnavailable(trafficConfig, new Error("No traffic incident source configured"));
  }

  const response = await fetch(trafficConfig.incidentUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "ClosetCast/0.1"
    }
  });
  if (!response.ok) throw new Error(`Traffic source returned ${response.status}`);

  const html = await response.text();
  const items = findTrafficMentions(html, trafficConfig.keywords || [], Number(trafficConfig.maxItems || 3));
  logger.info("Traffic summary refreshed", { matches: items.length, route: trafficConfig.routeLabel });
  return {
    enabled: true,
    label: trafficConfig.label,
    routeLabel: trafficConfig.routeLabel,
    headline: items.length ? `${items.length} possible issue${items.length === 1 ? "" : "s"}` : "Looks clear",
    detail: items.length ? "CHP mentions found near your route keywords" : "No matching CHP incident text found",
    items,
    quickMapUrl: trafficConfig.quickMapUrl,
    updatedAt: new Date().toISOString(),
    error: null
  };
}

function buildTrafficUnavailable(config = {}, error) {
  return {
    enabled: Boolean(config.enabled),
    label: config.label || "San Jose traffic",
    routeLabel: config.routeLabel || "Hwy 85 / West Valley Fwy",
    headline: "Traffic unavailable",
    detail: error?.message || "Traffic source unavailable",
    items: [],
    quickMapUrl: config.quickMapUrl || "https://quickmap.dot.ca.gov/?ll=37.25,-121.95&z=11",
    updatedAt: null,
    error: error?.message || "Traffic source unavailable"
  };
}

function findTrafficMentions(html, keywords, maxItems = 3) {
  const text = htmlToText(html);
  const normalizedKeywords = keywords.filter(Boolean).map((keyword) => String(keyword).toLowerCase());
  if (!text || !normalizedKeywords.length) return [];

  const lowerText = text.toLowerCase();
  const snippets = [];
  for (const keyword of normalizedKeywords) {
    let index = lowerText.indexOf(keyword);
    while (index !== -1 && snippets.length < maxItems * 2) {
      const start = Math.max(0, index - 90);
      const end = Math.min(text.length, index + keyword.length + 130);
      snippets.push(text.slice(start, end).replace(/\s+/g, " ").trim());
      index = lowerText.indexOf(keyword, index + keyword.length);
    }
  }

  return [...new Set(snippets)]
    .slice(0, maxItems)
    .map((snippet) => ({ text: snippet }));
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  WeatherService,
  buildTrafficUnavailable,
  fetchWeather,
  fetchTraffic,
  findTrafficMentions,
  isWithinMorningWindow,
  selectLocation,
  weatherCodeToText
};
