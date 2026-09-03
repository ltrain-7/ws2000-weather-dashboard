(function exposeInsights(global) {
  "use strict";

  function render(options, formatters) {
    const analytics = options.analytics;
    if (!analytics?.current) {
      const empty = `<p class="muted">No stored insights are available for this period.</p>`;
      return { summaryHtml: empty, comparisonHtml: empty, rainfallHtml: empty, comparisonTitle: "Current period" };
    }

    const current = options.historyDate
      ? summarizeHistory(options.history, options.normalizeHistory)
      : analytics.current;
    const previous = options.historyDate
      ? summarizeHistory(options.comparisonHistory, options.normalizeHistory)
      : analytics.previous;
    const comparisonTitle = options.historyDate
      ? `${formatters.formatSelectedDate(options.historyDate)} vs previous day`
      : options.historyRangeDays
        ? `${formatters.rangeLabel(options.historyRangeDays)} vs previous`
        : "Last 24 hours vs previous";
    const comparisons = [
      ["Average temp", current.averageTempf, previous?.averageTempf, "°F", null],
      ["High temp", current.maximumTempf, previous?.maximumTempf, "°F", current.maximumTempAt],
      ["Low temp", current.minimumTempf, previous?.minimumTempf, "°F", current.minimumTempAt],
      ["Average humidity", current.averageHumidity, previous?.averageHumidity, "%", null],
      ["Peak gust", current.maximumGustMph, previous?.maximumGustMph, "mph", null],
      ["Rainfall", current.rainfallTotalIn, previous?.rainfallTotalIn, "in", null]
    ];
    const summaryHtml = comparisons
      .map(([label, value, , unit, occurredAt]) => statCard(label, value, null, unit, occurredAt, formatters))
      .join("");
    const comparisonHtml = comparisons
      .map(([label, value, prior, unit, occurredAt]) => statCard(label, value, prior, unit, occurredAt, formatters))
      .join("");
    const rain = analytics.rainfall || {};
    const wettest = current.wettestDay;
    const rainfallHtml = [
      ["Today", rain.day?.rainfallTotalIn, null, "in"],
      ["Last 7 days", rain.week?.rainfallTotalIn, null, "in"],
      ["This month", rain.month?.rainfallTotalIn, null, "in"],
      ["This year", rain.year?.rainfallTotalIn, null, "in"]
    ].map(([label, value, prior, unit]) => statCard(label, value, prior, unit, null, formatters)).join("")
      + `<div class="stat-card"><span>Wettest day</span><strong>${wettest ? `${formatters.formatDateOnly(wettest.day)} · ${Number(wettest.rainIn).toFixed(2)} in` : "--"}</strong></div>`;

    return { comparisonHtml, comparisonTitle, rainfallHtml, summaryHtml };
  }

  function summarizeHistory(history, normalizeHistory) {
    const rows = normalizeHistory(history);
    const values = (key) => rows
      .filter((row) => present(row[key]))
      .map((row) => Number(row[key]))
      .filter(Number.isFinite);
    const average = (items) => items.length
      ? items.reduce((sum, value) => sum + value, 0) / items.length
      : null;
    const maximum = (items) => items.length ? Math.max(...items) : null;
    const rain = values("dailyrainin");
    const temperatures = values("tempf");
    const temperatureRows = rows.filter((row) => present(row.tempf) && Number.isFinite(Number(row.tempf)));
    const minimumTemperature = temperatureRows.reduce(
      (best, row) => (!best || Number(row.tempf) < Number(best.tempf) ? row : best),
      null
    );
    const maximumTemperature = temperatureRows.reduce(
      (best, row) => (!best || Number(row.tempf) > Number(best.tempf) ? row : best),
      null
    );
    return {
      averageTempf: average(temperatures),
      minimumTempf: temperatures.length ? Math.min(...temperatures) : null,
      maximumTempf: maximum(temperatures),
      minimumTempAt: minimumTemperature?.dateutc || minimumTemperature?.date || null,
      maximumTempAt: maximumTemperature?.dateutc || maximumTemperature?.date || null,
      averageHumidity: average(values("humidity")),
      maximumGustMph: maximum(values("windgustmph")),
      rainfallTotalIn: maximum(rain)
    };
  }

  function statCard(label, value, previous, unit, occurredAt, formatters) {
    const numeric = Number(value);
    const previousNumber = Number(previous);
    const hasPrevious = previous !== null
      && previous !== undefined
      && previous !== ""
      && Number.isFinite(previousNumber);
    const rendered = present(value) && Number.isFinite(numeric)
      ? formatters.formatUnitValue(numeric, unit, unit === "in" ? 2 : 1)
      : "--";
    const details = [];
    if (occurredAt) details.push(`Observed ${formatters.formatTime(occurredAt)}`);
    if (present(value) && Number.isFinite(numeric) && hasPrevious) {
      const difference = numeric - previousNumber;
      details.push(`${difference >= 0 ? "+" : ""}${formatters.formatUnitValue(difference, unit, unit === "in" ? 2 : 1)} vs previous`);
    }
    return `<div class="stat-card"><span>${label}</span><strong>${rendered}</strong>${details.map((detail) => `<small>${detail}</small>`).join("")}</div>`;
  }

  function present(value) {
    return value !== null && value !== undefined && value !== "";
  }

  global.WeatherInsights = Object.freeze({ render, summarizeHistory });
})(window);
