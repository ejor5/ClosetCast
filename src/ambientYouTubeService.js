const { dateAtTime } = require("./timeUtils");

class AmbientYouTubeService {
  constructor(config, logger, onUpdate) {
    this.config = {
      enabled: true,
      startTime: "12:00",
      endTime: "22:00",
      rotationMinutes: 45,
      resolveRefreshHours: 12,
      fallbackToSearchPage: true,
      ...config.ambientYouTube
    };
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.history = [];
    this.resolvedCache = new Map();
    this.state = {
      enabled: Boolean(this.config.enabled),
      visible: false,
      title: "Ambient YouTube",
      url: "",
      query: "",
      source: "",
      message: "Ambient YouTube idle",
      error: null,
      resolvedAt: null
    };
  }

  start() {
    if (!this.config.enabled) {
      this.publish({ message: "Ambient YouTube disabled" });
      return;
    }

    this.refresh();
    const minutes = Math.max(5, Number(this.config.rotationMinutes || 45));
    this.timer = setInterval(() => this.refresh(), minutes * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    const now = new Date();
    if (!isWithinAmbientWindow(now, this.config)) {
      this.publish({
        visible: false,
        message: "Ambient YouTube outside display hours"
      });
      return;
    }

    const item = chooseAmbientItem(this.config, this.history);
    if (!item) {
      this.publish({
        visible: false,
        message: "No ambient YouTube items configured"
      });
      return;
    }

    try {
      const resolved = await resolveAmbientItem(item, this.config, this.resolvedCache);
      remember(this.history, item.key, Number(this.config.recentHistorySize || 4));
      this.logger.info("Ambient YouTube item selected", { title: resolved.title, source: resolved.source });
      this.publish({
        enabled: true,
        visible: true,
        title: resolved.title,
        url: withAutoplay(resolved.url, this.config),
        query: resolved.query || "",
        source: resolved.source,
        message: resolved.message,
        error: null,
        resolvedAt: new Date().toISOString()
      });
    } catch (error) {
      this.logger.warn("Ambient YouTube resolution failed", { error: error.message, title: item.title });
      this.publish({
        enabled: true,
        visible: true,
        title: item.title || "Ambient YouTube",
        url: fallbackUrl(item, this.config),
        query: item.query || "",
        source: "fallback",
        message: "Using fallback YouTube page",
        error: error.message,
        resolvedAt: null
      });
    }
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, enabled: Boolean(this.config.enabled) };
    this.onUpdate(this.state);
  }
}

async function resolveAmbientItem(item, config, cache) {
  if (item.url) {
    return {
      title: item.title || "Ambient YouTube",
      url: item.url,
      source: "direct",
      query: item.query || "",
      message: "Direct YouTube pick"
    };
  }

  const query = item.query || item.title;
  if (!query) throw new Error("Ambient item missing query");

  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  const cacheMs = Number(config.resolveRefreshHours || 12) * 60 * 60_000;
  if (cached && Date.now() - cached.time < cacheMs) {
    return {
      title: item.title || query,
      url: cached.url,
      source: "youtube-search-cache",
      query,
      message: "Cached YouTube search result"
    };
  }

  const url = await resolveFirstYouTubeResult(query);
  cache.set(cacheKey, { url, time: Date.now() });
  return {
    title: item.title || query,
    url,
    source: "youtube-search",
    query,
    message: "First YouTube search result"
  };
}

async function resolveFirstYouTubeResult(query) {
  const searchUrl = youtubeSearchUrl(query);
  const response = await fetch(searchUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "ClosetCast/0.1"
    }
  });
  if (!response.ok) throw new Error(`YouTube search returned ${response.status}`);
  const html = await response.text();
  const videoId = findFirstYouTubeVideoId(html);
  if (!videoId) throw new Error("No YouTube video result found");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function findFirstYouTubeVideoId(html) {
  const seen = new Set();
  const patterns = [
    /"videoId":"([a-zA-Z0-9_-]{11})"/g,
    /\/watch\?v=([a-zA-Z0-9_-]{11})/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      if (!seen.has(match[1])) {
        return match[1];
      }
      seen.add(match[1]);
      match = pattern.exec(html);
    }
  }

  return null;
}

function chooseAmbientItem(config, history) {
  const items = [
    ...(config.directVideos || []).map((item, index) => ({ ...item, key: `direct:${index}:${item.url}` })),
    ...(config.searchTopics || []).map((item, index) => ({ ...item, key: `search:${index}:${item.query || item.title}` }))
  ].filter((item) => item.enabled !== false);

  if (!items.length) return null;
  const fresh = items.filter((item) => !history.includes(item.key));
  const pool = fresh.length ? fresh : items;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

function remember(history, key, limit) {
  history.push(key);
  while (history.length > limit) history.shift();
}

function fallbackUrl(item, config) {
  if (item.url) return withAutoplay(item.url, config);
  if (config.fallbackToSearchPage !== false && (item.query || item.title)) {
    return youtubeSearchUrl(item.query || item.title);
  }
  return "https://www.youtube.com/";
}

function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function withAutoplay(rawUrl, config) {
  try {
    const url = new URL(toYouTubeEmbedUrl(rawUrl));
    if (config.autoplay !== false) url.searchParams.set("autoplay", "1");
    if (config.mute !== false) url.searchParams.set("mute", "1");
    if (!url.searchParams.has("rel")) url.searchParams.set("rel", "0");
    if (!url.searchParams.has("playsinline")) url.searchParams.set("playsinline", "1");
    if (!url.searchParams.has("modestbranding")) url.searchParams.set("modestbranding", "1");
    return url.toString();
  } catch (_) {
    return rawUrl;
  }
}

function toYouTubeEmbedUrl(rawUrl) {
  const url = new URL(rawUrl);
  const hostname = url.hostname.replace(/^www\./, "");
  let videoId = "";

  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
    } else if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/")) {
      videoId = url.pathname.split("/").filter(Boolean)[1] || "";
    } else if (url.pathname.startsWith("/embed/")) {
      return url.toString();
    }
  }

  if (!videoId) return url.toString();

  const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
  const startSeconds = parseYouTubeStart(url.searchParams.get("t") || url.searchParams.get("start"));
  if (startSeconds) embed.searchParams.set("start", String(startSeconds));
  return embed.toString();
}

function parseYouTubeStart(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = String(value).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function isWithinAmbientWindow(date, config) {
  const start = dateAtTime(date, config.startTime, "12:00");
  const end = dateAtTime(date, config.endTime, "22:00");
  if (end > start) return date >= start && date < end;
  return date >= start || date < end;
}

module.exports = {
  AmbientYouTubeService,
  chooseAmbientItem,
  findFirstYouTubeVideoId,
  isWithinAmbientWindow,
  resolveFirstYouTubeResult,
  toYouTubeEmbedUrl,
  youtubeSearchUrl
};
