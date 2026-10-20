// Сбор измерений GIOŚ. Запускается GitHub Actions раз в полчаса (и вручную для проверки):
//
//   node scripts/update-data.mjs --store <папка>
//
// В папке <store> (это ветка `data` репозитория) скрипт обновляет:
//   latest.json                       — последние 72 ч по всем станциям, его читает страница;
//   history/gios/ГГГГ-ММ.csv          — накопительный архив измерений;
//   history/forecasts/ГГГГ-ММ-ДД.json — утренний снимок прогноза CAMS (для будущей проверки точности).
//
// Если GIOŚ не ответил, для этого датчика остаются прежние значения из latest.json,
// а ошибка записывается в поле errors — страница покажет, что данные устарели.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIONS, LOCATIONS, TIME_ZONE } from '../web/js/config.js';
import { warsawLocalToUnix, warsawParts } from '../web/js/time.js';
import { airUrl } from '../web/js/api.js';

const GIOS_DATA = 'https://api.gios.gov.pl/pjp-api/v1/rest/data/getData/';
const KEEP_HOURS = 72;

function parseArgs(argv) {
  const args = { store: 'data-store' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--store') args.store = argv[++i];
  }
  return args;
}

async function fetchJson(url, { attempts = 3, timeoutMs = 20000 } = {}) {
  let lastError;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (a < attempts) await new Promise((r) => setTimeout(r, 2000 * a));
    }
  }
  throw lastError;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// Ответ GIOŚ → [[unixSec, value|null], ...] по возрастанию времени.
export function parseGiosSeries(json) {
  const list = json?.['Lista danych pomiarowych'];
  if (!Array.isArray(list)) throw new Error('В ответе GIOŚ нет списка измерений');
  // GIOŚ отдаёт от новых к старым; разворачиваем, чтобы повторяющийся час осенней
  // смены времени первым трактовался как летнее время.
  const taken = new Set();
  const points = [];
  for (const row of [...list].reverse()) {
    const sec = warsawLocalToUnix(row['Data'], taken);
    taken.add(sec);
    const v = row['Wartość'];
    points.push([sec, typeof v === 'number' && Number.isFinite(v) ? v : null]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}

async function collectStations(prev, nowSec) {
  const errors = [];
  const stations = [];
  for (const st of STATIONS) {
    const prevStation = prev?.stations?.find((s) => s.id === st.id);
    const series = {};
    for (const [param, sensorId] of Object.entries(st.sensors)) {
      let points;
      let ok = true;
      try {
        points = parseGiosSeries(await fetchJson(`${GIOS_DATA}${sensorId}?size=500`));
      } catch (err) {
        ok = false;
        points = prevStation?.series?.[param]?.points ?? [];
        errors.push(`${st.name} ${param} (датчик ${sensorId}): ${err.message}`);
      }
      series[param] = {
        sensorId,
        unit: 'µg/m³',
        updatedOk: ok,
        points: points.filter(([t]) => t >= nowSec - KEEP_HOURS * 3600),
      };
    }
    const { sensors, ...meta } = st;
    stations.push({ ...meta, series });
  }
  return { stations, errors };
}

function utcMonth(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 7);
}

export async function appendHistory(store, stations) {
  const byMonth = new Map();
  for (const st of stations) {
    for (const [param, s] of Object.entries(st.series)) {
      for (const [t, v] of s.points) {
        if (v == null) continue;
        const month = utcMonth(t);
        if (!byMonth.has(month)) byMonth.set(month, new Map());
        byMonth.get(month).set(`${t},${st.id},${param}`, v);
      }
    }
  }
  const dir = path.join(store, 'history', 'gios');
  await mkdir(dir, { recursive: true });
  for (const [month, fresh] of byMonth) {
    const file = path.join(dir, `${month}.csv`);
    const rows = new Map();
    try {
      const old = await readFile(file, 'utf8');
      for (const line of old.split('\n').slice(1)) {
        if (!line.trim()) continue;
        const [t, id, param, v] = line.split(',');
        rows.set(`${Date.parse(t) / 1000},${id},${param}`, Number(v));
      }
    } catch {
      // Первый файл за месяц.
    }
    // Новые значения заменяют старые: GIOŚ может уточнять данные задним числом.
    for (const [k, v] of fresh) rows.set(k, v);
    const lines = [...rows.entries()]
      .map(([k, v]) => {
        const [t, id, param] = k.split(',');
        return { t: Number(t), id, param, v };
      })
      .sort((a, b) => a.t - b.t || a.id.localeCompare(b.id) || a.param.localeCompare(b.param))
      .map(({ t, id, param, v }) => `${new Date(t * 1000).toISOString()},${id},${param},${v}`);
    await writeFile(file, `time_utc,station_id,param,value\n${lines.join('\n')}\n`);
  }
}

// Раз в день (первый запуск после 06:00 по Варшаве) сохраняем прогноз CAMS на 48 ч вперёд.
async function snapshotForecast(store, nowSec) {
  const p = warsawParts(nowSec);
  if (p.hour < 6) return null;
  const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const dir = path.join(store, 'history', 'forecasts');
  const file = path.join(dir, `${day}.json`);
  if (await readJson(file)) return null;
  const snapshot = { fetchedAt: new Date(nowSec * 1000).toISOString(), model: 'CAMS Europe via Open-Meteo', locations: {} };
  for (const [key, loc] of Object.entries(LOCATIONS)) {
    const json = await fetchJson(airUrl(loc));
    const h = json.hourly;
    const keep = h.time.map((t, i) => [t, i]).filter(([t]) => t >= nowSec - 3600);
    snapshot.locations[key] = {
      grid: { lat: json.latitude, lon: json.longitude },
      time: keep.map(([t]) => t),
      pm2_5: keep.map(([, i]) => h.pm2_5[i]),
      pm10: keep.map(([, i]) => h.pm10[i]),
      ozone: keep.map(([, i]) => h.ozone[i]),
      nitrogen_dioxide: keep.map(([, i]) => h.nitrogen_dioxide[i]),
    };
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(snapshot));
  return file;
}

async function main() {
  const { store } = parseArgs(process.argv.slice(2));
  await mkdir(store, { recursive: true });
  const latestFile = path.join(store, 'latest.json');
  const prev = await readJson(latestFile);
  const nowSec = Math.floor(Date.now() / 1000);

  const { stations, errors } = await collectStations(prev, nowSec);
  const latest = {
    generatedAt: new Date(nowSec * 1000).toISOString(),
    generatedAtUnix: nowSec,
    timeZone: TIME_ZONE,
    source: {
      name: 'GIOŚ — Główny Inspektorat Ochrony Środowiska',
      url: 'https://powietrze.gios.gov.pl/',
      note: 'Dane bieżące, niezweryfikowane — mogą ulec zmianie.',
    },
    stations,
    errors,
  };
  await writeFile(latestFile, JSON.stringify(latest));
  await appendHistory(store, stations);

  try {
    const snap = await snapshotForecast(store, nowSec);
    if (snap) console.log(`Снимок прогноза: ${snap}`);
  } catch (err) {
    console.warn(`Снимок прогноза не сохранён: ${err.message}`);
  }

  for (const e of errors) console.warn(`Ошибка: ${e}`);
  console.log(`Готово: ${stations.length} станций, ошибок: ${errors.length}`);
}

if (process.argv[1]?.endsWith('update-data.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
