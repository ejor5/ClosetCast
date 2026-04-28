function parseTimeOfDay(value, fallback) {
  const source = typeof value === "string" ? value : fallback;
  const match = String(source || "00:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseTimeOfDay(fallback, "00:00");
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2])))
  };
}

function dateAtTime(baseDate, timeText, fallback) {
  const time = parseTimeOfDay(timeText, fallback);
  const date = new Date(baseDate);
  date.setHours(time.hour, time.minute, 0, 0);
  return date;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClockTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

module.exports = {
  addDays,
  dateAtTime,
  formatClockTime,
  formatLocalDate,
  parseTimeOfDay,
  startOfLocalDay
};
