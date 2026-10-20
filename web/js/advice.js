// Советы: тренировка, окна, очиститель. Пороги согласованы 2026-10-20 (см. docs/DECISIONS.md).
// Основа — PM2.5 в мкг/м³ (часовое значение). PM10 — с порогами примерно вдвое выше,
// озон — по классу EAQI «плохо» (>120 мкг/м³) и выше.

import { HOME_STATION_ORDER, STALE_HOURS } from './config.js';

const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
export const formatValue = (v) => (v == null ? '—' : fmt.format(v));

// Последнее непустое значение ряда [[unixSec, value], ...].
export function latestPoint(points) {
  if (!points) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i][1] != null) return { time: points[i][0], value: points[i][1] };
  }
  return null;
}

// Опорное значение PM2.5 «сейчас» для советов: свежее измерение ближайшей фоновой станции,
// иначе — значение модели на текущий час (с пометкой).
export function homeReference(stations, modelNow, nowSec) {
  for (const id of HOME_STATION_ORDER) {
    const st = stations?.find((s) => s.id === id);
    const p = latestPoint(st?.series?.pm25?.points);
    if (p && nowSec - p.time <= STALE_HOURS * 3600) {
      return { value: p.value, time: p.time, kind: 'measured', source: st.name };
    }
  }
  if (modelNow?.value != null) {
    return { value: modelNow.value, time: modelNow.time, kind: 'model', source: 'модель CAMS' };
  }
  return null;
}

const PM25_TIERS = [25, 50, 90];
const PM10_TIERS = [50, 100, 180];
const tierOf = (v, tiers) => (v == null ? -1 : tiers.filter((t) => v > t).length);

const TRAINING = [
  { tone: 'ok', text: 'По воздуху ограничений нет.' },
  { tone: 'caution', text: 'На интенсивных отрезках и в городе — респиратор.' },
  { tone: 'warn', text: 'Респиратор и спокойный темп — или тренировка дома.' },
  { tone: 'bad', text: 'Лучше тренироваться дома.' },
];

export function trainingAdvice({ pm25, pm10, o3 }) {
  let tier = Math.max(tierOf(pm25, PM25_TIERS), tierOf(pm10, PM10_TIERS));
  if (o3 != null && o3 > 180) tier = Math.max(tier, 2);
  if (tier < 0) return { tone: 'none', text: 'Нет данных о частицах.', notes: [] };
  const notes = [];
  if (o3 != null && o3 > 120) {
    notes.push('Озон высокий: лучше ехать утром. Фильтр от частиц от озона почти не защищает.');
  }
  return { ...TRAINING[tier], notes };
}

export function windowAdvice(pm25, cleanest) {
  if (pm25 == null) return { tone: 'none', text: 'Нет данных.' };
  if (pm25 <= 15) return { tone: 'ok', text: 'Можно проветривать свободно.' };
  if (pm25 <= 25) return { tone: 'ok', text: 'Как обычно, но коротко и интенсивно — 10–15 минут.' };
  if (pm25 <= 50) {
    const when = cleanest
      ? ` Самый чистый час в ближайшие 6 ч по прогнозу — ${cleanest.label} (≈${formatValue(cleanest.value)}).`
      : '';
    return { tone: 'caution', text: `Коротко, 5–10 минут, затем очиститель на максимум.${when}` };
  }
  return { tone: 'warn', text: 'Только при необходимости (духота, влажность), коротко — и сразу очиститель.' };
}

export function purifierAdvice(pm25) {
  if (pm25 == null) return { tone: 'none', text: 'Авто-режим.' };
  if (pm25 <= 25) return { tone: 'ok', text: 'Авто-режим.' };
  return { tone: 'caution', text: 'Максимум на 30–45 минут (особенно после проветривания), затем авто.' };
}
