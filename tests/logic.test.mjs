import { test } from 'node:test';
import assert from 'node:assert/strict';

import { levelIndex } from '../web/js/eaqi.js';
import { warsawLocalToUnix, hourLabel, relativeHourLabel } from '../web/js/time.js';
import { trainingAdvice, windowAdvice, purifierAdvice, homeReference } from '../web/js/advice.js';
import { precipKind, precipText, roadFlags } from '../web/js/weather.js';
import { parseGiosSeries } from '../scripts/update-data.mjs';

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

test('Советы для тренировки по согласованным порогам', () => {
  assert.equal(trainingAdvice({ pm25: 13 }).tone, 'ok');
  assert.equal(trainingAdvice({ pm25: 25 }).tone, 'ok');
  assert.equal(trainingAdvice({ pm25: 26 }).tone, 'caution');
  assert.equal(trainingAdvice({ pm25: 60 }).tone, 'warn');
  assert.equal(trainingAdvice({ pm25: 95 }).tone, 'bad');
  // PM10 с порогами вдвое выше поднимает уровень, даже если PM2.5 низкий.
  assert.equal(trainingAdvice({ pm25: 10, pm10: 120 }).tone, 'warn');
  // Высокий озон добавляет пояснение.
  assert.equal(trainingAdvice({ pm25: 10, o3: 130 }).notes.length, 1);
  assert.equal(trainingAdvice({}).tone, 'none');
});

test('Советы для окон и очистителя', () => {
  assert.match(windowAdvice(10).text, /свободно/);
  assert.match(windowAdvice(20).text, /10–15/);
  assert.match(windowAdvice(30, { label: '14:00', value: 18 }).text, /14:00/);
  assert.match(windowAdvice(60).text, /необходимости/);
  assert.equal(purifierAdvice(20).text, 'Авто-режим.');
  assert.match(purifierAdvice(26).text, /Максимум/);
});

test('Опорное значение: свежая станция, иначе следующая, иначе модель', () => {
  const now = 1_000_000;
  const st = (id, t, v) => ({ id, name: `S${id}`, series: { pm25: { points: [[t, v], [t + 3600, null]] } } });
  const fresh = homeReference([st(609, now - 3600, 20)], null, now);
  assert.deepEqual([fresh.source, fresh.value, fresh.kind], ['S609', 20, 'measured']);
  const fallback = homeReference([st(609, now - 5 * 3600, 20), st(17658, now - 3600, 30)], null, now);
  assert.equal(fallback.source, 'S17658');
  const model = homeReference([st(609, now - 9 * 3600, 20)], { value: 7, time: now }, now);
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
