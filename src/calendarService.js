const fs = require("fs");
const path = require("path");
const { addDays, startOfLocalDay } = require("./timeUtils");

class CalendarService {
  constructor(config, logger, onUpdate) {
    this.config = config.calendar || {};
    this.projectRoot = config.__projectRoot;
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.cachePath = getCachePath(this.projectRoot, this.config);
    this.state = {
      enabled: Boolean(this.config.enabled),
      connected: false,
      events: [],
      tomorrowEvents: [],
      message: "Calendar not connected",
      error: null,
      fromCache: false,
      lastUpdated: null
    };
  }

  start() {
    if (!this.config.enabled) {
      this.publish({ message: "Calendar disabled" });
      return;
    }

    const cached = this.readCache();
    if (cached) {
      this.publish({
        ...cached,
        connected: true,
        fromCache: true,
        message: cached.events?.length ? "Calendar cache loaded" : "Calendar cache loaded; no upcoming items"
      });
    }

    this.refresh();
    const minutes = Number(this.config.refreshMinutes || 15);
    this.timer = setInterval(() => this.refresh(), Math.max(5, minutes) * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    const feeds = (this.config.icsUrls || []).filter((feed) => feed.url);
    if (!feeds.length) {
      this.publish({ connected: false, events: [], message: "Calendar not connected", error: null });
      return;
    }

    const windows = getCalendarWindows(new Date(), this.config);
    const allParsedEvents = [];
    const errors = [];
    let successfulFeeds = 0;

    await Promise.all(feeds.map(async (feed) => {
      try {
        const response = await fetch(feed.url);
        if (!response.ok) throw new Error(`${feed.name || "Calendar"} returned ${response.status}`);
        const text = await response.text();
        allParsedEvents.push(...parseIcs(text, feed.name || "Calendar"));
        successfulFeeds += 1;
      } catch (error) {
        this.logger.warn("Calendar fetch failed", { feed: feed.name, error: error.message });
        errors.push(error.message);
      }
    }));

    if (!successfulFeeds) {
      const cached = this.readCache();
      if (cached) {
        this.publish({
          ...cached,
          connected: true,
          error: errors[0] || "Calendar unavailable",
          fromCache: true,
          message: "Calendar unavailable; using cached events"
        });
        return;
      }
    }

    const maxEvents = Number(this.config.maxEvents || 5);
    const maxTomorrowEvents = Number(this.config.maxTomorrowEvents || 8);
    const events = eventsForWindow(allParsedEvents, windows.upcomingStart, windows.upcomingEnd)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .slice(0, maxEvents);
    const tomorrowEvents = eventsForWindow(allParsedEvents, windows.tomorrowStart, windows.tomorrowEnd)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .slice(0, maxTomorrowEvents);

    const nextState = {
      connected: true,
      events,
      tomorrowEvents,
      error: errors[0] || null,
      fromCache: false,
      lastUpdated: new Date().toISOString(),
      message: events.length ? `${events.length} calendar item${events.length === 1 ? "" : "s"} coming up` : "No calendar items coming up"
    };

    this.writeCache(nextState);
    this.publish(nextState);
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, enabled: Boolean(this.config.enabled) };
    this.onUpdate(this.state);
  }

  readCache() {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      return JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
    } catch (error) {
      this.logger.warn("Calendar cache read failed", { error: error.message });
      return null;
    }
  }

  writeCache(state) {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify({
        events: state.events,
        tomorrowEvents: state.tomorrowEvents,
        lastUpdated: state.lastUpdated,
        message: state.message,
        error: state.error
      }, null, 2));
    } catch (error) {
      this.logger.warn("Calendar cache write failed", { error: error.message });
    }
  }
}

function getCalendarWindows(now, config) {
  const upcomingEnd = new Date(now);
  upcomingEnd.setDate(upcomingEnd.getDate() + Number(config.lookAheadDays || 1));
  const tomorrowStart = startOfLocalDay(addDays(now, 1));
  const tomorrowEnd = startOfLocalDay(addDays(now, 2));
  return {
    upcomingStart: now,
    upcomingEnd,
    tomorrowStart,
    tomorrowEnd
  };
}

function getCachePath(projectRoot, config) {
  const cachePath = config.cachePath || "cache/calendar-cache.json";
  return path.isAbsolute(cachePath) ? cachePath : path.join(projectRoot, cachePath);
}

function parseIcs(text, calendarName) {
  const lines = unfoldLines(text);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { calendarName };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.summary && current.dtstart) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const rawKey = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const [key, ...paramParts] = rawKey.split(";");
    const params = Object.fromEntries(paramParts.map((part) => {
      const [paramKey, paramValue = ""] = part.split("=");
      return [paramKey.toUpperCase(), paramValue];
    }));

    if (key === "SUMMARY") current.summary = cleanIcsText(value);
    if (key === "LOCATION") current.location = cleanIcsText(value);
    if (key === "DTSTART") current.dtstart = parseIcsDate(value, params);
    if (key === "DTEND") current.dtend = parseIcsDate(value, params);
    if (key === "RRULE") current.rrule = parseRrule(value);
    if (key === "EXDATE") {
      current.exdates = current.exdates || [];
      current.exdates.push(...value.split(",").map((dateText) => parseIcsDate(dateText, params)).filter(Boolean));
    }
  }

  return events;
}

function eventsForWindow(events, start, end) {
  return events.flatMap((event) => expandEvent(event, start, end)).filter((event) => {
    const eventStart = new Date(event.startTime);
    const eventEnd = new Date(event.endTime || event.startTime);
    return eventEnd >= start && eventStart <= end;
  });
}

function expandEvent(event, windowStart, windowEnd) {
  if (!event.rrule) return [formatEvent(event, event.dtstart, event.dtend)];

  const results = [];
  const durationMs = event.dtend ? event.dtend.date.getTime() - event.dtstart.date.getTime() : 60 * 60_000;
  const frequency = event.rrule.FREQ;
  const until = event.rrule.UNTIL ? parseIcsDate(event.rrule.UNTIL, {})?.date : null;
  const byDays = event.rrule.BYDAY ? event.rrule.BYDAY.split(",") : [];
  const weeklyDays = frequency === "WEEKLY" && !byDays.length ? [dayCode(event.dtstart.date)] : byDays;
  const exdates = new Set((event.exdates || []).map((entry) => localDateKey(entry.date)));
  let cursor = new Date(event.dtstart.date);
  let count = 0;
  const maxCount = Number(event.rrule.COUNT || 5000);

  if (frequency === "DAILY" && cursor < windowStart) {
    const interval = Number(event.rrule.INTERVAL || 1);
    const daysBehind = Math.max(0, Math.floor((windowStart - cursor) / 86_400_000) - interval);
    cursor.setDate(cursor.getDate() + daysBehind - (daysBehind % interval));
  }

  if (frequency === "WEEKLY" && cursor < windowStart) {
    cursor = new Date(windowStart);
    cursor.setDate(cursor.getDate() - 7);
    cursor.setHours(event.dtstart.date.getHours(), event.dtstart.date.getMinutes(), event.dtstart.date.getSeconds(), 0);
  }

  while (cursor <= windowEnd && count < maxCount) {
    const candidate = new Date(cursor);
    const weekOffset = Math.floor((startOfDay(candidate) - startOfDay(event.dtstart.date)) / (7 * 86_400_000));
    const matchesInterval = frequency !== "WEEKLY" || weekOffset % Number(event.rrule.INTERVAL || 1) === 0;
    const matchesDay = frequency === "WEEKLY" ? weeklyDays.includes(dayCode(candidate)) : !byDays.length || byDays.includes(dayCode(candidate));
    const inRange = candidate >= windowStart && (!until || candidate <= until);

    if (matchesDay && matchesInterval && inRange && !exdates.has(localDateKey(candidate))) {
      results.push(formatEvent(event, { ...event.dtstart, date: candidate }, { ...event.dtend, date: new Date(candidate.getTime() + durationMs) }));
    }

    if (frequency === "DAILY") cursor.setDate(cursor.getDate() + Number(event.rrule.INTERVAL || 1));
    else if (frequency === "WEEKLY") cursor.setDate(cursor.getDate() + 1);
    else break;
    count += 1;
  }

  return results;
}

function formatEvent(event, start, end) {
  return {
    title: event.summary,
    location: event.location || "",
    calendarName: event.calendarName,
    allDay: Boolean(start.allDay),
    startTime: start.date.toISOString(),
    endTime: end?.date?.toISOString() || start.date.toISOString()
  };
}

function unfoldLines(text) {
  return text.replace(/\r\n/g, "\n").split("\n").reduce((lines, line) => {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line.trimEnd());
    return lines;
  }, []);
}

function parseIcsDate(value, params) {
  if (!value) return null;
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return { date: new Date(year, month, day), allDay: true };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  const args = [Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)];
  const date = zulu ? new Date(Date.UTC(...args)) : new Date(...args);
  return { date, allDay: false };
}

function parseRrule(value) {
  return Object.fromEntries(value.split(";").map((part) => {
    const [key, ruleValue = ""] = part.split("=");
    return [key.toUpperCase(), ruleValue.toUpperCase()];
  }));
}

function cleanIcsText(value) {
  return value.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

function dayCode(date) {
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()];
}

function localDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

module.exports = {
  CalendarService,
  eventsForWindow,
  getCalendarWindows,
  parseIcs
};
