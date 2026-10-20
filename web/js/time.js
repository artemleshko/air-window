// Работа со временем. Внутри приложения всё хранится как Unix-время (секунды, UTC),
// а показывается в часовом поясе Europe/Warsaw — так переходы на летнее/зимнее время
// обрабатывает сам браузер.

import { TIME_ZONE } from './config.js';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function warsawParts(sec) {
  const parts = {};
  for (const p of partsFormatter.formatToParts(new Date(sec * 1000))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts; // { year, month, day, hour, minute }
}

const pad = (n) => String(n).padStart(2, '0');

export function hourLabel(sec) {
  const p = warsawParts(sec);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function dayNumber(sec) {
  const p = warsawParts(sec);
  return Date.UTC(p.year, p.month - 1, p.day) / 86400000;
}

// «14:00», «вчера 22:00», «завтра 03:00» относительно текущего момента.
export function relativeHourLabel(sec, nowSec) {
  const diff = dayNumber(sec) - dayNumber(nowSec);
  const prefix = { [-1]: 'вчера ', 0: '', 1: 'завтра ' }[diff];
  if (prefix !== undefined) return prefix + hourLabel(sec);
  const p = warsawParts(sec);
  return `${pad(p.day)}.${pad(p.month)} ${hourLabel(sec)}`;
}

export function ageText(sec, nowSec) {
  const min = Math.max(0, Math.round((nowSec - sec) / 60));
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}

export function startOfHour(sec) {
  return Math.floor(sec / 3600) * 3600;
}

// Перевод местного времени Варшавы «2026-10-20 22:00:00» (так его отдаёт GIOŚ) в Unix-время.
// В ночь перехода на зимнее время час 02:00–03:00 повторяется дважды: тогда первое
// вхождение считаем летним временем, второе (если этот момент уже занят) — зимним.
// Несуществующий весенний час 02:00 трактуем как зимнее время (UTC+1).
export function warsawLocalToUnix(text, taken = new Set()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text);
  if (!m) throw new Error(`Неожиданный формат даты: ${text}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi) / 1000;
  const candidates = [asUtc - 7200, asUtc - 3600].filter((sec) => {
    const p = warsawParts(sec);
    return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi;
  });
  if (candidates.length === 0) return asUtc - 3600;
  return candidates.find((sec) => !taken.has(sec)) ?? candidates[0];
}
