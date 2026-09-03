(function exposeForecast(global) {
  "use strict";

  const WEATHER_CODES = new Map([
    [0, ["Clear", "☀️"]],
    [1, ["Mainly clear", "🌤️"]],
    [2, ["Partly cloudy", "⛅"]],
    [3, ["Overcast", "☁️"]],
    [45, ["Fog", "🌫️"]], [48, ["Freezing fog", "🌫️"]],
    [51, ["Light drizzle", "🌦️"]], [53, ["Drizzle", "🌦️"]], [55, ["Heavy drizzle", "🌧️"]],
    [56, ["Freezing drizzle", "🌧️"]], [57, ["Heavy freezing drizzle", "🌧️"]],
    [61, ["Light rain", "🌦️"]], [63, ["Rain", "🌧️"]], [65, ["Heavy rain", "🌧️"]],
    [66, ["Freezing rain", "🌧️"]], [67, ["Heavy freezing rain", "🌧️"]],
    [71, ["Light snow", "🌨️"]], [73, ["Snow", "🌨️"]], [75, ["Heavy snow", "❄️"]], [77, ["Snow grains", "❄️"]],
    [80, ["Light showers", "🌦️"]], [81, ["Showers", "🌧️"]], [82, ["Heavy showers", "🌧️"]],
    [85, ["Snow showers", "🌨️"]], [86, ["Heavy snow showers", "🌨️"]],
    [95, ["Thunderstorms", "⛈️"]], [96, ["Thunderstorms with hail", "⛈️"]], [99, ["Severe thunderstorms", "⛈️"]]
  ]);

  function cardView(day, index) {
    const weather = present(day.weatherCode) ? WEATHER_CODES.get(Number(day.weatherCode)) : null;
    const [condition, icon] = weather || ["Forecast unavailable", "—"];
    const high = temperature(day.highF);
    const low = temperature(day.lowF);
    const rain = percentage(day.precipitationProbability);
    const gust = wind(day.maximumGustMph);
    const dayLabel = index === 0 ? "Today" : weekday(day.date);
    return {
      dayLabel,
      dateLabel: monthDay(day.date),
      condition,
      icon,
      high,
      low,
      rain,
      gust,
      accessibleLabel: `${dayLabel}: ${condition}. High ${high}, low ${low}. ${rain}. ${gust}.`
    };
  }

  function weekday(value) {
    return formatDate(value, { weekday: "short" });
  }

  function monthDay(value) {
    return formatDate(value, { month: "short", day: "numeric" });
  }

  function formatDate(value, options) {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat([], { ...options, timeZone: "UTC" }).format(date);
  }

  function temperature(value) {
    return present(value) && Number.isFinite(Number(value)) ? `${Math.round(Number(value))}°` : "--";
  }

  function percentage(value) {
    return present(value) && Number.isFinite(Number(value)) ? `${Math.round(Number(value))}% rain` : "Rain --";
  }

  function wind(value) {
    return present(value) && Number.isFinite(Number(value)) ? `Gust ${Math.round(Number(value))} mph` : "Gust --";
  }

  function present(value) {
    return value !== undefined && value !== null && value !== "";
  }

  global.WeatherForecast = Object.freeze({ cardView });
})(window);
