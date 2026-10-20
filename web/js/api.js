// Загрузка данных: измерения GIOŚ (файл, который раз в полчаса собирает GitHub Actions)
// и прогнозы Open-Meteo (запрос прямо из браузера). Последний удачный ответ сохраняется
// в localStorage — без сети приложение покажет его с пометкой о возрасте.

import { LOCATIONS, POLLUTANTS } from './config.js';

const CACHE_PREFIX = 'aw:data:';

function saveCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Хранилище недоступно (приватный режим) — просто работаем без кэша.
  }
}

export function loadCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Возвращает { data, savedAt, fromCache, error }.
async function withCache(key, loader) {
  try {
    const data = await loader();
    saveCache(key, data);
    return { data, savedAt: Date.now(), fromCache: false, error: null };
  } catch (error) {
    const cached = loadCache(key);
    return { data: cached?.data ?? null, savedAt: cached?.savedAt ?? null, fromCache: true, error };
  }
}

export function loadMeasurements() {
  return withCache('gios', () => fetchJson(`data/latest.json?t=${Date.now()}`));
}

// Ряды Open-Meteo переводим в массив часов: [{ time, pm25, pm10, ... }, ...].
function toHours(hourly, mapping) {
  return hourly.time.map((time, i) => {
    const row = { time };
    for (const [key, field] of Object.entries(mapping)) row[key] = hourly[field]?.[i] ?? null;
    return row;
  });
}

const AIR_MAPPING = Object.fromEntries(
  Object.entries(POLLUTANTS).map(([key, p]) => [key, p.openMeteo]),
);

export function airUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: Object.values(AIR_MAPPING).join(','),
    domains: 'cams_europe',
    past_days: 1,
    forecast_days: 2,
    timeformat: 'unixtime',
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}

const WEATHER_MAPPING = {
  temperature: 'temperature_2m',
  feelsLike: 'apparent_temperature',
  probability: 'precipitation_probability',
  precipitation: 'precipitation',
  rain: 'rain',
  showers: 'showers',
  snowfall: 'snowfall',
  code: 'weather_code',
  wind: 'wind_speed_10m',
  gusts: 'wind_gusts_10m',
};

function weatherUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: Object.values(WEATHER_MAPPING).join(','),
    past_days: 2,
    forecast_days: 2,
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function loadAir(locKey) {
  return withCache(`air:${locKey}`, async () => {
    const json = await fetchJson(airUrl(LOCATIONS[locKey]));
    return { hours: toHours(json.hourly, AIR_MAPPING), grid: { lat: json.latitude, lon: json.longitude } };
  });
}

export function loadWeather(locKey) {
  return withCache(`weather:${locKey}`, async () => {
    const json = await fetchJson(weatherUrl(LOCATIONS[locKey]));
    return { hours: toHours(json.hourly, WEATHER_MAPPING) };
  });
}
