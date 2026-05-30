const { getYankeesStreamSiteUrl } = require("./config");
const { redactUrl } = require("./logger");

const DEFAULT_FAVORITE_TEAMS = [
  {
    id: "yankees",
    label: "Yankees",
    teamId: 147,
    streamSearchText: "Yankees",
    streamLinkPatterns: ["yankees", "new-york-yankees"]
  },
  {
    id: "angels",
    label: "Angels",
    teamId: 108,
    streamSearchText: "Angels",
    streamLinkPatterns: ["angels", "los-angeles-angels", "la-angels"]
  },
  {
    id: "giants",
    label: "Giants",
    teamId: 137,
    streamSearchText: "Giants",
    streamLinkPatterns: ["giants", "san-francisco-giants", "sf-giants"]
  }
];

class YankeesScheduler {
  constructor(config, logger, onUpdate) {
    this.config = config.yankees || {};
    this.teams = normalizeFavoriteTeams(this.config);
    this.streamSiteUrl = getYankeesStreamSiteUrl(this.config);
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.lastFetchAt = 0;
    this.streamResolveInFlight = new Set();
    this.lastStreamResolveAttemptAt = new Map();
    this.state = {
      enabled: Boolean(this.config.enabled),
      mode: "dashboard",
      message: "Favorite teams idle",
      game: null,
      games: [],
      activeGames: [],
      streams: [],
      scheduleError: null,
      streamUrl: this.streamSiteUrl,
      streamResolvedAt: null,
      streamError: null
    };
  }

  start() {
    if (!this.config.enabled) {
      this.publish({ message: "Favorite teams disabled" });
      return;
    }

    this.tick();
    this.timer = setInterval(() => this.tick(), 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refreshNow() {
    this.lastFetchAt = 0;
    await this.tick();
  }

  async tick() {
    if (!this.config.enabled) return;
    const now = new Date();
    const refreshMs = Number(this.config.refreshScheduleMinutes || 360) * 60_000;

    if (!this.state.games?.length || Date.now() - this.lastFetchAt > refreshMs || !isSameLocalDate(now, new Date(this.lastFetchAt))) {
      await this.fetchTodaySchedule(now);
    }

    await this.evaluate(now);
  }

  async fetchTodaySchedule(date) {
    this.lastFetchAt = Date.now();
    const dateText = formatLocalDate(date);
    const games = [];
    const errors = [];

    for (const team of this.teams) {
      const url = buildScheduleUrl(this.config, team, dateText);
      if (!url) {
        errors.push(`${team.label}: no schedule URL configured`);
        continue;
      }

      try {
        this.logger.info("Fetching favorite team schedule", { team: team.label, date: dateText });
        const response = await fetch(url, { headers: { "Accept": "application/json,text/html;q=0.9,*/*;q=0.8" } });
        if (!response.ok) throw new Error(`Schedule source returned ${response.status}`);
        const body = await response.text();
        const game = parseSchedule(body, dateText, team);
        if (game) games.push(game);
      } catch (error) {
        errors.push(`${team.label}: ${error.message}`);
        this.logger.warn("Favorite team schedule fetch failed", { team: team.label, error: error.message });
      }
    }

    games.sort((a, b) => a.priority - b.priority || new Date(a.startTime) - new Date(b.startTime));
    this.publish({
      game: games[0] || null,
      games,
      scheduleError: errors.length ? errors.join("; ") : null,
      mode: games.length ? this.state.mode : "dashboard",
      message: games.length ? `${games.length} favorite game${games.length === 1 ? "" : "s"} found` : "No favorite games today"
    });
  }

  async evaluate(now) {
    const games = Array.isArray(this.state.games) ? this.state.games : [];

    if (!games.length) {
      this.publish({
        mode: "dashboard",
        activeGames: [],
        streams: [],
        message: this.state.scheduleError ? "Schedule unavailable; staying on dashboard" : "No favorite games today"
      });
      return;
    }

    const evaluatedGames = games.map((game) => withGameWindow(game, this.config, now));
    const activeGames = evaluatedGames.filter((game) => game.playState === "live");
    const preparingGames = evaluatedGames.filter((game) => game.playState === "preparing");
    const nextGame = evaluatedGames.find((game) => game.playState === "upcoming") || evaluatedGames[0];

    let mode = "dashboard";
    let message = nextGame ? `Next ${nextGame.teamLabel} game: ${nextGame.localStartTimeLabel}` : "No favorite games today";

    if (activeGames.length) {
      mode = "yankees";
      message = activeGames.length === 1
        ? `${activeGames[0].teamLabel} mode live`
        : `${activeGames.length} favorite games live`;
    } else if (preparingGames.length) {
      mode = "preparing";
      message = preparingGames.length === 1
        ? `Preparing ${preparingGames[0].teamLabel} stream page`
        : `Preparing ${preparingGames.length} stream pages`;
    } else if (evaluatedGames.every((game) => game.playState === "ended")) {
      mode = "dashboard";
      message = "Favorite game windows ended";
    }

    const visibleGames = [...activeGames, ...preparingGames];
    const streams = this.buildStreams(visibleGames);
    const primaryStream = streams[0] || null;
    const primaryGame = activeGames[0] || preparingGames[0] || nextGame || null;

    this.publish({
      mode,
      message,
      game: primaryGame,
      games: evaluatedGames,
      activeGames,
      streams,
      streamUrl: primaryStream?.streamUrl || this.streamSiteUrl,
      streamResolvedAt: primaryStream?.streamResolvedAt || null,
      streamError: primaryStream?.streamError || null
    });

    if (visibleGames.length) {
      await this.resolveStreamLinksIfNeeded(visibleGames);
    }
  }

  buildStreams(games) {
    return games.map((game) => {
      const existing = (this.state.streams || []).find((stream) => stream.teamId === game.teamId);
      return {
        teamId: game.teamId,
        teamKey: game.teamKey,
        teamLabel: game.teamLabel,
        title: `${game.awayTeam} @ ${game.homeTeam}`,
        status: game.status || game.playState,
        localStartTimeLabel: game.localStartTimeLabel,
        streamUrl: existing?.streamUrl || this.streamSiteUrl,
        streamResolvedAt: existing?.streamResolvedAt || null,
        streamError: existing?.streamError || null,
        streamSearchText: game.streamSearchText || game.teamLabel,
        streamLinkPatterns: game.streamLinkPatterns || [],
        game
      };
    });
  }

  async resolveStreamLinksIfNeeded(games) {
    if (this.config.resolveStreamLink === false) return;
    await Promise.all(games.map((game) => this.resolveTeamStreamLinkIfNeeded(game)));
  }

  async resolveTeamStreamLinkIfNeeded(game) {
    const refreshMs = Number(this.config.streamLinkRefreshMinutes || 20) * 60_000;
    const baseUrl = this.streamSiteUrl;
    const teamKey = game.teamKey;
    const existing = (this.state.streams || []).find((stream) => stream.teamId === game.teamId);
    const resolvedAt = existing?.streamResolvedAt ? new Date(existing.streamResolvedAt).getTime() : 0;
    const currentUrl = existing?.streamUrl || "";

    if (!baseUrl) {
      this.patchStream(game, {
        streamUrl: "",
        streamResolvedAt: null,
        streamError: "No stream site URL configured"
      });
      return;
    }

    if (this.streamResolveInFlight.has(teamKey) || Date.now() - Number(this.lastStreamResolveAttemptAt.get(teamKey) || 0) < refreshMs) {
      return;
    }

    if (currentUrl && currentUrl !== baseUrl && Date.now() - resolvedAt < refreshMs) {
      return;
    }

    try {
      this.streamResolveInFlight.add(teamKey);
      this.lastStreamResolveAttemptAt.set(teamKey, Date.now());
      this.logger.info("Resolving favorite team stream link", { team: game.teamLabel, source: redactUrl(baseUrl) });
      const streamUrl = await resolveYankeesStreamLink({
        baseUrl,
        searchText: game.streamSearchText || game.teamLabel,
        patterns: game.streamLinkPatterns || []
      });
      this.patchStream(game, {
        streamUrl,
        streamResolvedAt: new Date().toISOString(),
        streamError: null
      });
      this.logger.info("Favorite team stream link resolved", { team: game.teamLabel, streamUrl: redactUrl(streamUrl) });
    } catch (error) {
      this.logger.warn("Favorite team stream link resolution failed", { team: game.teamLabel, error: error.message });
      this.patchStream(game, {
        streamUrl: baseUrl,
        streamResolvedAt: null,
        streamError: error.message
      });
    } finally {
      this.streamResolveInFlight.delete(teamKey);
    }
  }

  patchStream(game, patch) {
    const streams = this.buildStreams([...this.state.activeGames, ...(this.state.mode === "preparing" ? this.state.games.filter((item) => item.playState === "preparing") : [])]);
    const nextStreams = streams.map((stream) => stream.teamId === game.teamId ? { ...stream, ...patch } : stream);
    const primary = nextStreams[0] || null;
    this.publish({
      streams: nextStreams,
      streamUrl: primary?.streamUrl || "",
      streamResolvedAt: primary?.streamResolvedAt || null,
      streamError: primary?.streamError || null,
      message: this.state.mode === "yankees" && patch.streamError
        ? `${game.teamLabel} stream link unavailable; showing base page`
        : this.state.message
    });
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, enabled: Boolean(this.config.enabled) };
    this.onUpdate(this.state);
  }
}

async function resolveYankeesStreamLink({ baseUrl, searchText, patterns }) {
  if (!baseUrl) throw new Error("No stream site URL configured");
  const urls = uniqueUrls([baseUrl]);
  let lastError = "";

  for (const url of urls) {
    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "ClosetCast/0.1"
        }
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Stream page returned ${response.status}`);
      const html = await response.text();
      const match = findYankeesStreamLink(html, url, searchText, patterns);
      if (match) return match.href;
      lastError = `No ${searchText || "team"} link found on ${url}`;
    } catch (error) {
      if (error.name === "AbortError") {
        lastError = "Stream page request timed out";
        continue;
      }
      lastError = error.message;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error(lastError || "No team link found on stream page");
}

function findYankeesStreamLink(html, baseUrl, searchText = "Yankees", patterns = []) {
  const configuredPatterns = Array.isArray(patterns) ? patterns : [];
  const normalizedPatterns = buildStreamPatterns(searchText, configuredPatterns);
  const rawCandidates = extractStreamCandidates(html);
  const scoredCandidates = [];

  for (const candidate of rawCandidates) {
    const rawHref = decodeHtml(candidate.href);
    const text = normalizeText(decodeHtml(candidate.text || ""));
    const hrefText = normalizeText(rawHref);
    const score = scoreStreamCandidate(text, hrefText, normalizedPatterns);
    if (score > 0) {
      try {
        const href = new URL(rawHref, baseUrl);
        if (!["http:", "https:"].includes(href.protocol)) continue;
        scoredCandidates.push({
          href: new URL(rawHref, baseUrl).toString(),
          score,
          source: candidate.source
        });
      } catch (_) {
        // Ignore malformed links from the scraped page.
      }
    }
  }

  scoredCandidates.sort((a, b) => b.score - a.score);
  return scoredCandidates[0] || null;
}

function scoreStreamCandidate(text, hrefText, patterns) {
  let score = 0;
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (text.includes(pattern)) score += 5;
    if (hrefText.includes(pattern)) score += 4;
  }
  if (score <= 0) return 0;
  if (hrefText.includes("/mlb/")) score += 2;
  if (hrefText.includes("-vs-") || text.includes("-vs-")) score += 3;
  if (hrefText.includes("live") || text.includes("live")) score += 1;
  if (/\b(highlights?|recap|preview|odds|tickets?|schedule|standings|news|stats)\b/.test(`${text} ${hrefText}`)) score -= 5;
  if (score <= 0) return 0;
  return score;
}

function buildStreamPatterns(searchText, patterns = []) {
  const values = [searchText, ...patterns].filter(Boolean);
  const expanded = values.flatMap((value) => {
    const normalized = normalizeText(value);
    return [
      normalized,
      normalized.replace(/-/g, ""),
      normalized.replace(/^new-york-/, "ny-"),
      normalized.replace(/^los-angeles-/, "la-"),
      normalized.replace(/^san-francisco-/, "sf-")
    ];
  });
  return [...new Set(expanded.filter(Boolean))];
}

function extractStreamCandidates(html) {
  const source = normalizeScrapeSource(html);
  const candidates = [];
  const seen = new Set();
  const addCandidate = (href, text, candidateSource) => {
    const cleanedHref = String(href || "").trim();
    if (!cleanedHref || cleanedHref.startsWith("#") || /^(javascript|mailto|tel):/i.test(cleanedHref)) return;
    const key = `${cleanedHref}|${text || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ href: cleanedHref, text: text || cleanedHref, source: candidateSource });
  };

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchorMatch = anchorPattern.exec(source);
  while (anchorMatch) {
    const attrs = parseHtmlAttributes(anchorMatch[1]);
    const text = [
      stripTags(anchorMatch[2]),
      attrs.title,
      attrs["aria-label"],
      attrs["data-title"],
      attrs["data-tooltip"]
    ].filter(Boolean).join(" ");
    for (const key of ["href", "data-href", "data-url", "data-link", "data-target", "data-src"]) {
      if (attrs[key]) addCandidate(attrs[key], text, `anchor:${key}`);
    }
    if (attrs.onclick) {
      for (const href of extractUrlsFromText(attrs.onclick)) addCandidate(href, text, "anchor:onclick");
    }
    anchorMatch = anchorPattern.exec(source);
  }

  const attrPattern = /\b(?:href|data-href|data-url|data-link|data-target|data-src)\s*=\s*(["'])(.*?)\1/gi;
  let attrMatch = attrPattern.exec(source);
  while (attrMatch) {
    addCandidate(attrMatch[2], "", "attribute");
    attrMatch = attrPattern.exec(source);
  }

  for (const href of extractUrlsFromText(source)) {
    addCandidate(href, "", "body-url");
  }

  return candidates;
}

function parseHtmlAttributes(rawAttrs) {
  const attrs = {};
  const attrPattern = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = attrPattern.exec(rawAttrs || "");
  while (match) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || "");
    match = attrPattern.exec(rawAttrs || "");
  }
  return attrs;
}

function extractUrlsFromText(value) {
  const text = String(value || "");
  const urls = [];
  const urlPattern = /https?:\/\/[^\s"'<>\\]+|\/mlb\/[a-z0-9][a-z0-9/_-]*/gi;
  let match = urlPattern.exec(text);
  while (match) {
    urls.push(match[0].replace(/[),.;]+$/g, ""));
    match = urlPattern.exec(text);
  }
  return urls;
}

function normalizeScrapeSource(html) {
  return decodeHtml(String(html || ""))
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&sol;/gi, "/");
}

function normalizeFavoriteTeams(config = {}) {
  const configuredTeams = Array.isArray(config.teams) && config.teams.length
    ? config.teams
    : [{
      id: "yankees",
      label: "Yankees",
      teamId: config.teamId || 147,
      scheduleUrl: config.scheduleUrl,
      streamSearchText: config.streamSearchText || "Yankees",
      streamLinkPatterns: config.streamLinkPatterns || DEFAULT_FAVORITE_TEAMS[0].streamLinkPatterns
    }];

  return configuredTeams.map((team, index) => {
    const defaults = DEFAULT_FAVORITE_TEAMS.find((item) => String(item.id) === String(team.id)) || {};
    return {
      ...defaults,
      ...team,
      id: String(team.id || defaults.id || `team-${index + 1}`),
      label: String(team.label || defaults.label || team.name || `Team ${index + 1}`),
      teamId: Number(team.teamId || defaults.teamId || config.teamId || 147),
      priority: Number(team.priority || index + 1),
      scheduleUrl: team.scheduleUrl || defaults.scheduleUrl || config.scheduleUrl || "",
      streamSearchText: team.streamSearchText || defaults.streamSearchText || team.label || defaults.label || "Team",
      streamLinkPatterns: Array.isArray(team.streamLinkPatterns)
        ? team.streamLinkPatterns
        : Array.isArray(defaults.streamLinkPatterns)
          ? defaults.streamLinkPatterns
          : []
    };
  }).sort((a, b) => a.priority - b.priority);
}

function buildScheduleUrl(config, team, dateText) {
  const template = team.scheduleUrl || config.scheduleUrl || "";
  return template
    .replace("{date}", dateText)
    .replace("{teamId}", String(team.teamId));
}

function withGameWindow(game, config, now = new Date()) {
  const startBufferMs = Number(config.gameStartBufferMinutes || 0) * 60_000;
  const endBufferMs = Number(config.gameEndBufferMinutes || 45) * 60_000;
  const prepareMs = Number(config.prepareBeforeGameMinutes || 10) * 60_000;
  const assumedDurationMs = Number(config.assumedGameDurationMinutes || 210) * 60_000;
  const gameStart = new Date(game.startTime);
  const windowStart = new Date(gameStart.getTime() - startBufferMs);
  const prepareStart = new Date(windowStart.getTime() - prepareMs);
  const windowEnd = new Date(gameStart.getTime() + assumedDurationMs + endBufferMs);
  let playState = "upcoming";
  if (now >= windowStart && now <= windowEnd && !isFinalStatus(game.status)) {
    playState = "live";
  } else if (now >= prepareStart && now < windowStart) {
    playState = "preparing";
  } else if (now > windowEnd || isFinalStatus(game.status)) {
    playState = "ended";
  }

  return {
    ...game,
    playState,
    localStartTimeLabel: formatTime(gameStart),
    prepareStart: prepareStart.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString()
  };
}

function parseSchedule(body, dateText, team = DEFAULT_FAVORITE_TEAMS[0]) {
  try {
    const json = JSON.parse(body);
    const games = (json.dates || []).flatMap((day) => day.games || []);
    const game = games[0];
    if (!game) return null;
    return decorateGame({
      source: "schedule-json",
      date: dateText,
      gamePk: game.gamePk,
      startTime: game.gameDate,
      status: game.status?.detailedState || game.status?.abstractGameState || "Scheduled",
      awayTeam: game.teams?.away?.team?.name || "Away",
      homeTeam: game.teams?.home?.team?.name || "Home"
    }, team);
  } catch (_) {
    return parseHtmlSchedule(body, dateText, team);
  }
}

function parseHtmlSchedule(body, dateText, team = DEFAULT_FAVORITE_TEAMS[0]) {
  const teamNearTime = body.match(new RegExp(`${escapeRegExp(team.label)}[\\s\\S]{0,500}?(\\d{1,2}:\\d{2}\\s*[AP]M)`, "i"));
  if (!teamNearTime) return null;
  const startTime = new Date(`${dateText} ${teamNearTime[1]}`);
  if (Number.isNaN(startTime.getTime())) return null;
  return decorateGame({
    source: "schedule-html",
    date: dateText,
    startTime: startTime.toISOString(),
    status: "Scheduled",
    awayTeam: team.label,
    homeTeam: "Opponent"
  }, team);
}

function decorateGame(game, team) {
  return {
    ...game,
    teamKey: team.id,
    teamId: team.teamId,
    teamLabel: team.label,
    priority: team.priority || 99,
    streamSearchText: team.streamSearchText,
    streamLinkPatterns: team.streamLinkPatterns
  };
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, " ");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function isFinalStatus(status = "") {
  return /final|completed|game over/i.test(status);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameLocalDate(a, b) {
  return formatLocalDate(a) === formatLocalDate(b);
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  DEFAULT_FAVORITE_TEAMS,
  YankeesScheduler,
  findYankeesStreamLink,
  normalizeFavoriteTeams,
  parseSchedule,
  resolveYankeesStreamLink
};
