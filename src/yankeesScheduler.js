class YankeesScheduler {
  constructor(config, logger, onUpdate) {
    this.config = config.yankees || {};
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.lastFetchAt = 0;
    this.state = {
      enabled: Boolean(this.config.enabled),
      mode: "dashboard",
      message: "Yankees mode idle",
      game: null,
      scheduleError: null,
      streamUrl: this.config.streameastUrl || "",
      streamResolvedAt: null,
      streamError: null
    };
  }

  start() {
    if (!this.config.enabled) {
      this.publish({ message: "Yankees mode disabled" });
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

    if (!this.state.game || Date.now() - this.lastFetchAt > refreshMs || !isSameLocalDate(now, new Date(this.lastFetchAt))) {
      await this.fetchTodaySchedule(now);
    }

    await this.evaluate(now);
  }

  async fetchTodaySchedule(date) {
    this.lastFetchAt = Date.now();
    const dateText = formatLocalDate(date);
    const url = (this.config.scheduleUrl || "").replace("{date}", dateText);

    if (!url) {
      this.publish({ game: null, scheduleError: "No schedule URL configured" });
      return;
    }

    try {
      this.logger.info("Fetching Yankees schedule", { date: dateText });
      const response = await fetch(url, { headers: { "Accept": "application/json,text/html;q=0.9,*/*;q=0.8" } });
      if (!response.ok) throw new Error(`Schedule source returned ${response.status}`);
      const body = await response.text();
      const game = parseSchedule(body, dateText);
      this.publish({
        game,
        scheduleError: null,
        message: game ? "Yankees game found" : "No Yankees game today"
      });
    } catch (error) {
      this.logger.warn("Yankees schedule fetch failed", { error: error.message });
      this.publish({
        game: null,
        scheduleError: error.message,
        mode: "dashboard",
        message: "Schedule unavailable; staying on dashboard"
      });
    }
  }

  async evaluate(now) {
    const game = this.state.game;

    if (!game) {
      this.publish({ mode: "dashboard", message: this.state.scheduleError ? "Schedule unavailable; staying on dashboard" : "No Yankees game today" });
      return;
    }

    const startBufferMs = Number(this.config.gameStartBufferMinutes || 0) * 60_000;
    const endBufferMs = Number(this.config.gameEndBufferMinutes || 45) * 60_000;
    const prepareMs = Number(this.config.prepareBeforeGameMinutes || 10) * 60_000;
    const assumedDurationMs = Number(this.config.assumedGameDurationMinutes || 210) * 60_000;
    const gameStart = new Date(game.startTime);
    const windowStart = new Date(gameStart.getTime() - startBufferMs);
    const prepareStart = new Date(gameStart.getTime() - prepareMs);
    const windowEnd = new Date(gameStart.getTime() + assumedDurationMs + endBufferMs);

    let mode = "dashboard";
    let message = `Next Yankees game: ${formatTime(gameStart)}`;

    if (now >= windowStart && now <= windowEnd && !isFinalStatus(game.status)) {
      mode = "yankees";
      message = "Yankees mode live";
    } else if (now >= prepareStart && now < windowStart) {
      mode = "preparing";
      message = "Preparing Yankees stream page";
    } else if (now > windowEnd || isFinalStatus(game.status)) {
      mode = "dashboard";
      message = "Yankees game window ended";
    }

    const patch = {
      mode,
      message,
      game: {
        ...game,
        localStartTimeLabel: formatTime(gameStart),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString()
      }
    };

    this.publish(patch);

    if (mode === "preparing" || mode === "yankees") {
      await this.resolveStreamLinkIfNeeded();
    }
  }

  async resolveStreamLinkIfNeeded() {
    if (this.config.resolveStreamLink === false) return;
    const refreshMs = Number(this.config.streamLinkRefreshMinutes || 20) * 60_000;
    const resolvedAt = this.state.streamResolvedAt ? new Date(this.state.streamResolvedAt).getTime() : 0;
    const currentUrl = this.state.streamUrl || "";
    const baseUrl = this.config.streameastUrl || "";

    if (currentUrl && currentUrl !== baseUrl && Date.now() - resolvedAt < refreshMs) {
      return;
    }

    try {
      this.logger.info("Resolving Yankees stream link", { source: baseUrl });
      const streamUrl = await resolveYankeesStreamLink({
        baseUrl,
        searchText: this.config.streamSearchText || "Yankees",
        patterns: this.config.streamLinkPatterns || ["yankees", "new-york-yankees"]
      });
      this.publish({
        streamUrl,
        streamResolvedAt: new Date().toISOString(),
        streamError: null,
        message: this.state.mode === "yankees" ? "Yankees stream resolved" : this.state.message
      });
      this.logger.info("Yankees stream link resolved", { streamUrl });
    } catch (error) {
      this.logger.warn("Yankees stream link resolution failed", { error: error.message });
      this.publish({
        streamUrl: baseUrl,
        streamResolvedAt: null,
        streamError: error.message,
        message: this.state.mode === "yankees" ? "Yankees stream link unavailable; showing base page" : this.state.message
      });
    }
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, enabled: Boolean(this.config.enabled) };
    this.onUpdate(this.state);
  }
}

async function resolveYankeesStreamLink({ baseUrl, searchText, patterns }) {
  if (!baseUrl) throw new Error("No Streameast URL configured");
  const response = await fetch(baseUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "ClosetCast/0.1"
    }
  });
  if (!response.ok) throw new Error(`Stream page returned ${response.status}`);
  const html = await response.text();
  const match = findYankeesStreamLink(html, baseUrl, searchText, patterns);
  if (!match) throw new Error("No Yankees link found on stream page");
  return match.href;
}

function findYankeesStreamLink(html, baseUrl, searchText = "Yankees", patterns = []) {
  const normalizedPatterns = [searchText, ...patterns]
    .filter(Boolean)
    .map((value) => normalizeText(value));
  const candidates = [];
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorPattern.exec(html);

  while (match) {
    const rawHref = decodeHtml(match[2]);
    const text = normalizeText(stripTags(decodeHtml(match[3])));
    const hrefText = normalizeText(rawHref);
    const score = scoreStreamCandidate(text, hrefText, normalizedPatterns);
    if (score > 0) {
      try {
        candidates.push({
          href: new URL(rawHref, baseUrl).toString(),
          score
        });
      } catch (_) {
        // Ignore malformed links from the scraped page.
      }
    }
    match = anchorPattern.exec(html);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function scoreStreamCandidate(text, hrefText, patterns) {
  let score = 0;
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (text.includes(pattern)) score += 5;
    if (hrefText.includes(pattern)) score += 4;
  }
  if (hrefText.includes("/mlb/")) score += 2;
  if (hrefText.includes("vs")) score += 1;
  return score;
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

function parseSchedule(body, dateText) {
  try {
    const json = JSON.parse(body);
    const games = (json.dates || []).flatMap((day) => day.games || []);
    const game = games[0];
    if (!game) return null;
    return {
      source: "schedule-json",
      date: dateText,
      gamePk: game.gamePk,
      startTime: game.gameDate,
      status: game.status?.detailedState || game.status?.abstractGameState || "Scheduled",
      awayTeam: game.teams?.away?.team?.name || "Away",
      homeTeam: game.teams?.home?.team?.name || "Home"
    };
  } catch (_) {
    return parseHtmlSchedule(body, dateText);
  }
}

function parseHtmlSchedule(body, dateText) {
  const yankeesNearTime = body.match(/Yankees[\s\S]{0,500}?(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!yankeesNearTime) return null;
  const startTime = new Date(`${dateText} ${yankeesNearTime[1]}`);
  if (Number.isNaN(startTime.getTime())) return null;
  return {
    source: "schedule-html",
    date: dateText,
    startTime: startTime.toISOString(),
    status: "Scheduled",
    awayTeam: "Yankees",
    homeTeam: "Opponent"
  };
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

module.exports = {
  YankeesScheduler,
  findYankeesStreamLink,
  parseSchedule,
  resolveYankeesStreamLink
};
