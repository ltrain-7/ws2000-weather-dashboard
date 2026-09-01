(function exposeHistoryTime(global) {
  "use strict";

  function historyDateRange(value, timezone) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    const start = zonedTimeToUtc(year, month, day, timezone);
    const following = new Date(Date.UTC(year, month - 1, day + 1));
    const end = zonedTimeToUtc(
      following.getUTCFullYear(),
      following.getUTCMonth() + 1,
      following.getUTCDate(),
      timezone
    ) - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  }

  function zonedTimeToUtc(year, month, day, timezone) {
    const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
    let candidate = desired;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(candidate));
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const represented = Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second)
      );
      candidate += desired - represented;
    }
    return candidate;
  }

  function rollingDateRange(days) {
    if (!days) return null;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function previousDateRange(range) {
    const start = Date.parse(range.start);
    const end = Date.parse(range.end);
    const duration = end - start;
    return {
      start: new Date(start - duration).toISOString(),
      end: new Date(start - 1).toISOString()
    };
  }

  function rangeLabel(days) {
    return Number(days) === 1 ? "Last 1 day" : `Last ${days} days`;
  }

  function toDateInputValue(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatTimestamp(value, timezone) {
    const numeric = Number(value);
    const date = new Date(Number.isFinite(numeric) ? numeric : value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat([], {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function formatTimestampDate(value, timezone) {
    return new Intl.DateTimeFormat([], {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date(Number(value)));
  }

  function formatSelectedDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat([], {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function formatDateOnly(value) {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(date);
  }

  global.WeatherHistoryTime = Object.freeze({
    formatDateOnly,
    formatSelectedDate,
    formatTimestamp,
    formatTimestampDate,
    historyDateRange,
    previousDateRange,
    rangeLabel,
    rollingDateRange,
    toDateInputValue,
    zonedTimeToUtc
  });
})(window);
