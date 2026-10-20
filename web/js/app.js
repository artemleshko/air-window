// Главный модуль: состояние, загрузка и отрисовка экрана.

import {
  LOCATIONS, POLLUTANTS, CHART_STATION, STALE_HOURS, FORECAST_HOURS, CHART_PAST_HOURS,
} from './config.js';
import { level, LEVELS, BANDS } from './eaqi.js';
import { hourLabel, ageText, startOfHour, warsawParts } from './time.js';
import { precipKind, precipText, roadFlags, skyLabel } from './weather.js';
import {
  homeReference, latestPoint, trainingAdvice, windowAdvice, purifierAdvice, formatValue,
} from './advice.js';
import { loadMeasurements, loadAir, loadWeather, loadCache } from './api.js';
import { renderChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- Настройки пользователя ----------

const PREFS_KEY = 'aw:prefs';

function loadPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    // Нет доступа к хранилищу — используем значения по умолчанию.
  }
  return {
    loc: LOCATIONS[saved.loc] ? saved.loc : 'bialystok',
    pol: POLLUTANTS[saved.pol] ? saved.pol : 'pm25',
  };
}

const prefs = loadPrefs();

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Не страшно: настройки просто не запомнятся.
  }
}

// ---------- Состояние ----------

const cached = (key) => {
  const c = loadCache(key);
  return c ? { data: c.data, savedAt: c.savedAt, fromCache: true, error: null } : null;
};

const state = {
  gios: cached('gios'),
  air: { bialystok: cached('air:bialystok'), suprasl: cached('air:suprasl') },
  weather: { bialystok: cached('weather:bialystok'), suprasl: cached('weather:suprasl') },
  lastFetch: 0,
  loading: false,
};

// ---------- Маленькие помощники для разметки ----------

function pill(pol, value, extra = '') {
  const lv = level(pol, value);
  if (!lv) return `<span class="pill pill-none ${extra}">—</span>`;
  return `<span class="pill ${extra}" style="--c:${lv.color};--t:${lv.text}" title="${esc(lv.label)}">${formatValue(value)}</span>`;
}

function dotValue(pol, value) {
  const lv = level(pol, value);
  const dot = lv ? `<span class="dot" style="--c:${lv.color}" title="${esc(lv.label)}"></span>` : '';
  return `<span class="val"><span class="val-label">${POLLUTANTS[pol].label}</span>${dot}${formatValue(value)}</span>`;
}

const hourAt = (hours, t) => hours?.find((h) => h.time === t) ?? null;

function freshPoint(stations, stationId, pol, now) {
  const st = stations?.find((s) => s.id === stationId);
  const p = latestPoint(st?.series?.[pol]?.points);
  return p && now - p.time <= STALE_HOURS * 3600 ? p : null;
}

const KIND_ICON = {
  дождь: '🌧', морось: '🌦', 'мокрый снег': '🌨', снег: '🌨', гроза: '⛈', 'ледяной дождь': '🧊', осадки: '🌧',
};

// ---------- Блок «Сейчас» ----------

function renderNow(now) {
  const gios = state.gios?.data;
  const air = state.air.bialystok?.data;
  const w = state.weather.bialystok?.data;
  const h0 = startOfHour(now);
  const ref = homeReference(gios?.stations, { value: hourAt(air?.hours, h0)?.pm25, time: h0 }, now);

  let hero = '<p class="muted">Нет данных.</p>';
  if (ref) {
    const lv = level('pm25', ref.value);
    const source = ref.kind === 'measured'
      ? `${esc(ref.source)} · измерено в ${hourLabel(ref.time)} (${ageText(ref.time, now)})`
      : 'свежих измерений нет — значение модели CAMS';
    hero = `
      <div class="hero">
        ${pill('pm25', ref.value, 'pill-big')}
        <div>
          <div class="hero-title">PM2.5 <span class="unit">мкг/м³</span> · ${esc(lv?.label ?? '')}</div>
          <div class="muted small">${source}</div>
        </div>
      </div>`;
  }

  let stationsHtml = '';
  if (gios?.stations?.length) {
    stationsHtml = '<ul class="stations">' + gios.stations.map((st) => {
      const latest = Object.keys(st.series)
        .map((pol) => ({ pol, p: latestPoint(st.series[pol].points) }))
        .filter((x) => x.p);
      const newest = Math.max(...latest.map((x) => x.p.time), 0);
      const stale = !newest || now - newest > STALE_HOURS * 3600;
      const time = newest ? hourLabel(newest) : 'нет данных';
      const vals = ['pm25', 'pm10', 'no2', 'o3']
        .filter((pol) => st.series[pol])
        .map((pol) => dotValue(pol, latest.find((x) => x.pol === pol)?.p.value))
        .join('');
      return `
        <li class="station${stale ? ' is-stale' : ''}">
          <div class="st-head">
            <span class="st-name">${esc(st.name)}</span>
            <span class="tag">${esc(st.type)}</span>
            <span class="st-time">${stale ? '⏱ ' : ''}${esc(time)}</span>
          </div>
          <div class="st-vals">${vals}</div>
        </li>`;
    }).join('') + '</ul>';
  }

  // Сравнение с моделью в тот же час, что и последнее измерение на Warszawska.
  let modelLine = '';
  const refMeas = freshPoint(gios?.stations, 609, 'pm25', now);
  const modelThen = refMeas && hourAt(air?.hours, refMeas.time);
  if (modelThen) {
    modelLine = `<p class="muted small">Модель CAMS для района на ${hourLabel(refMeas.time)}:
      PM2.5 ${formatValue(modelThen.pm25)} · PM10 ${formatValue(modelThen.pm10)} — для сравнения с измерениями.</p>`;
  }

  let issues = '';
  if (gios?.errors?.length) {
    issues += `<p class="warn-text small">GIOŚ не ответил по ${gios.errors.length} датчик(ам) — у них показаны прежние значения.</p>`;
  }
  if (gios?.generatedAtUnix && now - gios.generatedAtUnix > 2 * 3600) {
    issues += `<p class="warn-text small">Сбор данных GIOŚ не обновлялся с ${hourLabel(gios.generatedAtUnix)} (${ageText(gios.generatedAtUnix, now)}).</p>`;
  }

  let weatherLine = '';
  const wNow = hourAt(w?.hours, h0);
  if (wNow) {
    const parts = [
      `${Math.round(wNow.temperature)}° (ощущается ${Math.round(wNow.feelsLike)}°)`,
      skyLabel(wNow.code),
      `ветер ${Math.round(wNow.wind)} м/с, порывы ${Math.round(wNow.gusts)}`,
      precipText(wNow),
    ].filter(Boolean);
    weatherLine = `<p class="weather-now">${esc(parts.join(' · '))}</p>`;
  }

  $('#now').innerHTML = `
    <div class="card-head"><h2>Сейчас</h2><span class="muted small">измерения GIOŚ</span></div>
    ${hero}
    ${stationsHtml}
    ${modelLine}
    ${issues}
    ${weatherLine}`;
  return ref;
}

// ---------- Блок «Советы» ----------

function renderAdvice(now, ref) {
  const gios = state.gios?.data;
  const air = state.air.bialystok?.data;
  const h0 = startOfHour(now);
  const modelNow = hourAt(air?.hours, h0);
  const pm10 = freshPoint(gios?.stations, 609, 'pm10', now)?.value ?? modelNow?.pm10;
  const o3 = freshPoint(gios?.stations, 11174, 'o3', now)?.value ?? modelNow?.o3;

  let cleanest = null;
  for (const h of air?.hours ?? []) {
    if (h.time <= h0 || h.time > h0 + 6 * 3600 || h.pm25 == null) continue;
    if (!cleanest || h.pm25 < cleanest.value) cleanest = { value: h.pm25, label: hourLabel(h.time) };
  }

  const training = trainingAdvice({ pm25: ref?.value, pm10, o3 });
  const windows = windowAdvice(ref?.value, cleanest);
  const purifier = purifierAdvice(ref?.value);

  const row = (icon, title, adv) => `
    <li class="tone-${adv.tone}">
      <span class="ic" aria-hidden="true">${icon}</span>
      <div>
        <b>${title}</b>
        <p>${esc(adv.text)}</p>
        ${(adv.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join('')}
      </div>
    </li>`;

  const basis = ref
    ? `по PM2.5 ${formatValue(ref.value)} · ${esc(ref.kind === 'measured' ? `${ref.source}, ${hourLabel(ref.time)}` : 'модель')}`
    : 'нет данных';

  $('#advice').innerHTML = `
    <div class="card-head"><h2>Советы сейчас</h2><span class="muted small">${basis}</span></div>
    <ul class="advice">
      ${row('🚴', 'Тренировка', training)}
      ${row('🪟', 'Окна', windows)}
      ${row('🌀', 'Очиститель', purifier)}
    </ul>
    <p class="muted small">Советы — про воздух на улице. Что в квартире, показывает дисплей очистителя.
      Это ориентир, а не медицинская рекомендация.</p>`;
}

// ---------- Блок «Ближайшие 12 часов» ----------

function precipShort(wh) {
  if (!wh) return '<span class="muted">—</span>';
  const kind = precipKind(wh);
  const prob = wh.probability ?? 0;
  if (!kind && prob < 10) return '<span class="muted">—</span>';
  const icon = KIND_ICON[kind ?? 'осадки'] ?? '💧';
  const mm = wh.precipitation > 0 ? ` · ${formatValue(wh.precipitation)} мм` : '';
  return `<span class="${prob >= 50 || kind ? 'rainy' : ''}">${icon} ${prob}%${mm}</span>`;
}

function renderForecast(now) {
  const loc = prefs.loc;
  const pol = prefs.pol;
  const air = state.air[loc]?.data;
  const w = state.weather[loc]?.data;
  const h0 = startOfHour(now);

  for (const b of document.querySelectorAll('#loc-seg button')) b.setAttribute('aria-pressed', String(b.dataset.loc === loc));
  for (const b of document.querySelectorAll('#pol-seg button')) b.setAttribute('aria-pressed', String(b.dataset.pol === pol));

  let measured = null;
  let measuredName = '';
  if (LOCATIONS[loc].hasStations) {
    const st = state.gios?.data?.stations?.find((s) => s.id === CHART_STATION[pol]);
    measured = st?.series?.[pol]?.points ?? null;
    measuredName = st?.name ?? '';
  }

  $('#chart').innerHTML = air
    ? renderChart({
      pollutant: pol,
      start: h0 - CHART_PAST_HOURS * 3600,
      now,
      end: h0 + FORECAST_HOURS * 3600,
      model: air.hours,
      measured,
    })
    : '<p class="muted small">Прогноз недоступен.</p>';

  $('#chart-legend').innerHTML = `
    ${measured ? `<span><i class="lg-meas"></i>измерено · ${esc(measuredName)}</span>` : ''}
    <span><i class="lg-model"></i>модель CAMS · ${POLLUTANTS[pol].label}, мкг/м³</span>
    ${LOCATIONS[loc].hasStations ? '' : '<span class="muted">в Супрасле станций GIOŚ нет — только модель</span>'}`;

  const rows = [];
  let prevDay = warsawParts(h0).day;
  for (let k = 0; k <= FORECAST_HOURS; k++) {
    const t = h0 + k * 3600;
    const day = warsawParts(t).day;
    if (day !== prevDay) {
      rows.push('<li class="day-sep">завтра</li>');
      prevDay = day;
    }
    const a = hourAt(air?.hours, t);
    const wi = w?.hours?.findIndex((h) => h.time === t) ?? -1;
    const wh = wi >= 0 ? w.hours[wi] : null;
    const flags = wh ? roadFlags(w.hours, wi) : [];
    const training = a ? trainingAdvice({ pm25: a.pm25, pm10: a.pm10, o3: a.o3 }) : null;
    const pols = ['pm25', 'pm10', 'o3', 'no2']
      .map((p) => `<span class="det-val">${POLLUTANTS[p].label} ${pill(p, a?.[p], 'pill-sm')}</span>`)
      .join('');
    const weatherDet = wh
      ? [
        `${Math.round(wh.temperature)}°, ощущается ${Math.round(wh.feelsLike)}°`,
        skyLabel(wh.code),
        `ветер ${Math.round(wh.wind)} м/с, порывы ${Math.round(wh.gusts)}`,
        precipText(wh),
      ].filter(Boolean).join(' · ')
      : 'нет прогноза погоды';

    rows.push(`
      <li>
        <details>
          <summary class="hour-row${k === 0 ? ' is-now' : ''}">
            <span class="h-time">${k === 0 ? 'сейчас' : hourLabel(t)}</span>
            ${pill(pol, a?.[pol])}
            <span class="h-temp">${wh ? `${Math.round(wh.temperature)}°` : ''}</span>
            <span class="h-precip">${precipShort(wh)}</span>
            <span class="h-flag">${flags.length ? '⚠' : ''}</span>
          </summary>
          <div class="hour-detail">
            <div class="det-vals">${pols}</div>
            <p>${esc(weatherDet)}</p>
            ${flags.map((f) => `<p class="warn-text">⚠ ${esc(f)}</p>`).join('')}
            ${training ? `<p class="tone-${training.tone}">🚴 ${esc(training.text)} <span class="muted">(по прогнозу модели)</span></p>` : ''}
            ${(training?.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join('')}
          </div>
        </details>
      </li>`);
  }
  $('#hours').innerHTML = rows.join('');
}

// ---------- Источники и статус ----------

function renderSources(now) {
  const gios = state.gios?.data;
  const air = state.air[prefs.loc];
  const grid = air?.data?.grid;
  $('#sources').innerHTML = `
    <p><b>Измерения:</b> <a href="https://powietrze.gios.gov.pl/" target="_blank" rel="noopener">GIOŚ</a>
      (Główny Inspektorat Ochrony Środowiska) — текущие данные, не верифицированы.
      ${gios ? `Собраны ${hourLabel(gios.generatedAtUnix)}.` : ''}</p>
    <p><b>Прогноз воздуха:</b> CAMS European ensemble (Copernicus) через
      <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0.
      Сетка ~11 км${grid ? `, ближайший узел ${grid.lat.toFixed(2)}, ${grid.lon.toFixed(2)}` : ''}.</p>
    <p><b>Погода:</b> <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0.</p>
    <p>Время — Europe/Warsaw.</p>`;
}

function renderStatus() {
  const loc = LOCATIONS[prefs.loc].name;
  const status = state.loading
    ? 'обновление…'
    : state.lastFetch
      ? `обновлено ${hourLabel(Math.floor(state.lastFetch / 1000))}`
      : 'загрузка…';
  $('#status').textContent = `${loc} · ${status}`;

  const results = [
    ['измерения GIOŚ', state.gios],
    ['прогноз воздуха', state.air[prefs.loc]],
    ['погода', state.weather[prefs.loc]],
  ];
  const failed = results.filter(([, r]) => r?.error);
  const banner = $('#banner');
  if (!failed.length) {
    banner.hidden = true;
    return;
  }
  const oldest = Math.min(...failed.map(([, r]) => r.savedAt ?? Infinity));
  banner.hidden = false;
  banner.textContent = Number.isFinite(oldest)
    ? `Не удалось обновить: ${failed.map(([n]) => n).join(', ')}. Показаны сохранённые данные от ${hourLabel(Math.floor(oldest / 1000))}.`
    : `Нет данных: ${failed.map(([n]) => n).join(', ')}. Проверьте подключение.`;
}

function render() {
  const now = nowSec();
  const ref = renderNow(now);
  renderAdvice(now, ref);
  renderForecast(now);
  renderSources(now);
  renderStatus();
}

// ---------- Загрузка ----------

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  renderStatus();
  const [gios, airB, airS, wB, wS] = await Promise.all([
    loadMeasurements(),
    loadAir('bialystok'),
    loadAir('suprasl'),
    loadWeather('bialystok'),
    loadWeather('suprasl'),
  ]);
  state.gios = gios;
  state.air = { bialystok: airB, suprasl: airS };
  state.weather = { bialystok: wB, suprasl: wS };
  state.lastFetch = Date.now();
  state.loading = false;
  render();
}

// ---------- Легенда ----------

function renderLegend() {
  const pols = ['pm25', 'pm10', 'o3', 'no2'];
  const range = (pol, i) => {
    const b = BANDS[pol];
    const lo = i === 0 ? 0 : b[i - 1];
    return i < b.length ? `${lo}–${b[i]}` : `>${lo}`;
  };
  $('#legend-table').innerHTML = `
    <thead><tr><th>Класс</th>${pols.map((p) => `<th>${POLLUTANTS[p].label}</th>`).join('')}</tr></thead>
    <tbody>${LEVELS.map((lv, i) => `
      <tr>
        <td><span class="dot" style="--c:${lv.color}"></span>${lv.label}</td>
        ${pols.map((p) => `<td>${range(p, i)}</td>`).join('')}
      </tr>`).join('')}
    </tbody>`;
}

// ---------- Запуск ----------

function bindUi() {
  $('#loc-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-loc]');
    if (!b) return;
    prefs.loc = b.dataset.loc;
    savePrefs();
    render();
  });
  $('#pol-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pol]');
    if (!b) return;
    prefs.pol = b.dataset.pol;
    savePrefs();
    render();
  });
  $('#refresh').addEventListener('click', refresh);
  $('#legend-btn').addEventListener('click', () => $('#legend').showModal());
  $('#legend-close').addEventListener('click', () => $('#legend').close());
  $('#legend').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  // Приложение с главного экрана часто остаётся в памяти: при возвращении обновляем данные.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > 10 * 60 * 1000) refresh();
    else if (document.visibilityState === 'visible') render();
  });
}

bindUi();
renderLegend();
render();
refresh();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Без service worker приложение работает, просто без офлайн-режима.
  });
}
