import { test } from 'node:test';
import assert from 'node:assert/strict';

import { levelIndex } from '../web/js/eaqi.js';
import { warsawLocalToUnix, hourLabel, relativeHourLabel } from '../web/js/time.js';
import { adviceNow, hourAdvice, gasAlerts, homeReference } from '../web/js/advice.js';
import { precipKind, precipText, roadFlags } from '../web/js/weather.js';
import { parseGiosSeries, appendHistory } from '../scripts/update-data.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const iso = (sec) => new Date(sec * 1000).toISOString();

test('EAQI: границы классов PM2.5 (редакция 2024)', () => {
  assert.equal(levelIndex('pm25', 0), 0);
  assert.equal(levelIndex('pm25', 5), 0);
  assert.equal(levelIndex('pm25', 5.1), 1);
  assert.equal(levelIndex('pm25', 13.8), 1);
  assert.equal(levelIndex('pm25', 15.1), 2);
  assert.equal(levelIndex('pm25', 90), 3);
  assert.equal(levelIndex('pm25', 141), 5);
  assert.equal(levelIndex('pm25', null), null);
  assert.equal(levelIndex('o3', 121), 3);
});

test('Время GIOŚ: летнее и зимнее время Варшавы', () => {
  assert.equal(iso(warsawLocalToUnix('2026-10-20 22:00:00')), '2026-10-20T20:00:00.000Z');
  assert.equal(iso(warsawLocalToUnix('2026-12-01 08:00:00')), '2026-12-01T07:00:00.000Z');
  // 25.10.2026: час 02:00 повторяется. Первое вхождение — летнее время, второе — зимнее.
  const taken = new Set();
  const first = warsawLocalToUnix('2026-10-25 02:00:00', taken);
  taken.add(first);
  const second = warsawLocalToUnix('2026-10-25 02:00:00', taken);
  assert.equal(iso(first), '2026-10-25T00:00:00.000Z');
  assert.equal(iso(second), '2026-10-25T01:00:00.000Z');
  // 29.03.2026: часа 02:00 не существует — трактуем как UTC+1.
  assert.equal(iso(warsawLocalToUnix('2026-03-29 02:00:00')), '2026-03-29T01:00:00.000Z');
});

test('Подписи времени в часовом поясе Варшавы', () => {
  const t = Date.UTC(2026, 9, 20, 20) / 1000; // 22:00 CEST
  assert.equal(hourLabel(t), '22:00');
  assert.equal(relativeHourLabel(t + 4 * 3600, t), 'завтра 02:00');
});

test('Разбор ответа GIOŚ: порядок, пропуски, смена времени', () => {
  const json = {
    'Lista danych pomiarowych': [
      { Data: '2026-10-25 03:00:00', 'Wartość': null },
      { Data: '2026-10-25 02:00:00', 'Wartość': 12 },
      { Data: '2026-10-25 02:00:00', 'Wartość': 11 },
      { Data: '2026-10-25 01:00:00', 'Wartość': 10 },
    ],
  };
  const pts = parseGiosSeries(json);
  assert.deepEqual(pts.map(([t, v]) => [iso(t), v]), [
    ['2026-10-24T23:00:00.000Z', 10],
    ['2026-10-25T00:00:00.000Z', 11],
    ['2026-10-25T01:00:00.000Z', 12],
    ['2026-10-25T02:00:00.000Z', null],
  ]);
  assert.throws(() => parseGiosSeries({}));
});

const ctx = (extra) => ({
  pm: { station: 'Warszawska', time: '14:00', kind: 'measured' },
  gas: { station: '42 Pułku', time: '14:00' },
  o3: 40,
  no2: 10,
  cleanest: { label: '17:00', value: 18 },
  ...extra,
});

test('Велосипед: пороги PM2.5 и PM10, озон и NO₂', () => {
  assert.equal(adviceNow(ctx({ pm25: 13, pm10: 20 })).bike.tone, 'ok');
  assert.equal(adviceNow(ctx({ pm25: 25, pm10: 20 })).bike.tone, 'ok');
  assert.equal(adviceNow(ctx({ pm25: 26, pm10: 20 })).bike.tone, 'caution');
  assert.equal(adviceNow(ctx({ pm25: 60, pm10: 70 })).bike.tone, 'warn');
  assert.equal(adviceNow(ctx({ pm25: 95, pm10: 120 })).bike.tone, 'bad');
  // PM10 поднимает уровень и называется в пояснении.
  const pm10 = adviceNow(ctx({ pm25: 10, pm10: 120 })).bike;
  assert.equal(pm10.tone, 'warn');
  assert.match(pm10.explain[0], /^PM10 120/);
  // Нормальные газы упоминаются одной фразой.
  assert.match(adviceNow(ctx({ pm25: 10, pm10: 20 })).bike.explain.at(-1), /невысокие/);
  // Высокий озон — пояснение, сильный — отдельная строка совета.
  assert.match(adviceNow(ctx({ pm25: 10, pm10: 20, o3: 130 })).bike.explain.at(-1), /с утра/);
  const severe = adviceNow(ctx({ pm25: 10, pm10: 20, o3: 190 })).bike;
  assert.equal(severe.line, 'Спокойный темп или дома.');
  assert.match(adviceNow(ctx({ pm25: 10, pm10: 20, no2: 70 })).bike.explain.at(-1), /выхлопов/);
});

test('Окна и очиститель', () => {
  assert.match(adviceNow(ctx({ pm25: 10 })).windows.line, /сколько угодно/);
  assert.match(adviceNow(ctx({ pm25: 20 })).windows.line, /10–15/);
  const w = adviceNow(ctx({ pm25: 30 })).windows;
  assert.match(w.line, /5–10/);
  assert.match(w.explain[0], /17:00/);
  assert.match(adviceNow(ctx({ pm25: 30, cleanest: null })).windows.explain[0], /Проветривайте коротко/);
  assert.match(adviceNow(ctx({ pm25: 60 })).windows.line, /душно/);
  assert.match(adviceNow(ctx({ pm25: 10, o3: 130 })).windows.explain.at(-1), /утром/);
  assert.equal(adviceNow(ctx({ pm25: 20 })).purifier.line, 'Режим «Авто».');
  assert.match(adviceNow(ctx({ pm25: 26 })).purifier.line, /Максимум/);
  // Значение модели помечается в начале пояснения.
  const model = adviceNow(ctx({ pm25: 10, pm: { station: 'модель', time: '14:00', kind: 'model' } }));
  assert.match(model.windows.explain[0], /прогноз модели/);
  assert.equal(adviceNow(ctx({ pm25: null })).bike.line, 'Нет данных.');
});

test('Совет на час прогноза и предупреждения о газах', () => {
  assert.equal(hourAdvice({ pm25: 30, pm10: 40, o3: 50 }).tone, 'caution');
  assert.equal(hourAdvice({ pm25: 10, o3: 130 }).notes.length, 1);
  assert.equal(hourAdvice({}).tone, 'none');
  assert.deepEqual(gasAlerts({ o3: 110, no2: 30 }), []);
  assert.deepEqual(gasAlerts({ o3: 125, no2: 61, gas: null }).map((a) => a.pol), ['o3', 'no2']);
});

test('Опорное значение: свежая станция, иначе следующая, иначе модель', () => {
  const now = 1_000_000;
  const st = (id, t, v) => ({ id, name: `S${id}`, series: { pm25: { points: [[t, v], [t + 3600, null]] } } });
  const fresh = homeReference([st(609, now - 3600, 20)], null, now);
  assert.deepEqual([fresh.source, fresh.value, fresh.kind], ['S609', 20, 'measured']);
  const fallback = homeReference([st(609, now - 5 * 3600, 20), st(17658, now - 3600, 30)], null, now);
  assert.equal(fallback.source, 'S17658');
  const model = homeReference([st(609, now - 9 * 3600, 20)], { pm25: 7, time: now }, now);
  assert.equal(model.kind, 'model');
});

test('Погода: тип осадков и предупреждения о дороге', () => {
  assert.equal(precipKind({ code: 61, rain: 0.5 }), 'дождь');
  assert.equal(precipKind({ code: 68, rain: 0.2, snowfall: 0.3 }), 'мокрый снег');
  assert.equal(precipKind({ code: 66 }), 'ледяной дождь');
  assert.equal(precipKind({ code: 3, precipitation: 0 }), null);
  assert.equal(precipText({ code: 61, rain: 0.4, precipitation: 0.4, probability: 60 }), 'дождь · 60% · 0,4 мм');

  const hours = [];
  for (let i = 0; i < 60; i++) hours.push({ temperature: i < 30 ? -3 : 3, precipitation: 0, code: 3 });
  assert.ok(roadFlags(hours, 40).some((f) => f.includes('оттепель')));
  const icy = Array.from({ length: 10 }, () => ({ temperature: 0.5, precipitation: 0.1, code: 3 }));
  assert.ok(roadFlags(icy, 9).some((f) => f.includes('гололёда')));
  assert.deepEqual(roadFlags([{ temperature: 12, precipitation: 0, code: 0, gusts: 5 }], 0), []);
});

test('Архив измерений: повторный запуск дописывает и обновляет значения', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aw-'));
  try {
    const t = Date.UTC(2026, 9, 20, 20) / 1000;
    const st = (points) => [{ id: 609, series: { pm25: { points } } }];
    await appendHistory(dir, st([[t, 13.8], [t + 3600, null]]));
    await appendHistory(dir, st([[t, 14.0], [t + 3600, 12.5]]));
    const csv = await readFile(path.join(dir, 'history', 'gios', '2026-10.csv'), 'utf8');
    assert.equal(csv, 'time_utc,station_id,param,value\n'
      + '2026-10-20T20:00:00.000Z,609,pm25,14\n'
      + '2026-10-20T21:00:00.000Z,609,pm25,12.5\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
