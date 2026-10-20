// Главный модуль: состояние, загрузка и отрисовка экрана.

import {
  LOCATIONS, POLLUTANTS, CHART_STATION, STALE_HOURS, FORECAST_HOURS, CHART_PAST_HOURS,
} from './config.js';
import { level, levelIndex, LEVELS, BANDS } from './eaqi.js';
import { hourLabel, ageText, startOfHour, warsawParts } from './time.js';
import { precipText, roadFlags, skyLabel, weatherIcon } from './weather.js';
import {
  homeReference, latestPoint, freshPoint, adviceNow, hourAdvice, gasAlerts, formatValue,
} from './advice.js';
import { loadMeasurements, loadAir, loadWeather, loadCache } from './api.js';
import { renderChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const nowSec = () => Math.floor(Date.now() / 1000);

const GAS_STATION = 11174; // 42 Pułku Piechoty — единственная станция с озоном

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
  selectedHour: 0,
};

// ---------- Помощники для разметки ----------

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

// Загрязнитель, который в этот час хуже PM2.5 по шкале EAQI (для метки в ленте).
function worseThanPm25(a) {
  if (!a) return null;
  const base = levelIndex('pm25', a.pm25) ?? -1;
  let worst = null;
  for (const pol of ['pm10', 'o3', 'no2']) {
    const i = levelIndex(pol, a[pol]);
    if (i != null && i > base && (!worst || i > worst.index)) worst = { pol, index: i };
  }
  return worst;
}

// Значения «на сейчас» для верхнего блока и советов.
function currentValues(now) {
  const stations = state.gios?.data?.stations;
  const air = state.air.bialystok?.data;
  const h0 = startOfHour(now);
  const modelNow = hourAt(air?.hours, h0);
  const ref = homeReference(stations, modelNow ? { ...modelNow, time: h0 } : null, now);

  const o3 = freshPoint(stations, GAS_STATION, 'o3', now);
  const no2 = freshPoint(stations, GAS_STATION, 'no2', now);
  let gas = null;
  if (o3 || no2) gas = { station: '42 Pułku', time: hourLabel((o3 ?? no2).time) };
  else if (modelNow) gas = { station: 'модель CAMS', time: hourLabel(h0) };

  let cleanest = null;
  for (const h of air?.hours ?? []) {
    if (h.time <= h0 || h.time > h0 + 6 * 3600 || h.pm25 == null) continue;
    if (!cleanest || h.pm25 < cleanest.value) cleanest = { value: h.pm25, label: hourLabel(h.time) };
  }

  return {
    ref,
    pm25: ref?.value ?? null,
    pm10: ref?.pm10 ?? null,
    o3: o3?.value ?? modelNow?.o3 ?? null,
    no2: no2?.value ?? modelNow?.no2 ?? null,
    pm: ref ? { station: ref.source, time: hourLabel(ref.time), kind: ref.kind } : null,
    gas,
    cleanest,
  };
}

// ---------- Наверху: Варшавская сейчас ----------

function tile(pol, value) {
  const lv = level(pol, value);
  const style = lv ? `style="--c:${lv.color};--t:${lv.text}"` : '';
  return `
    <div class="tile${lv ? '' : ' tile-none'}" ${style}>
      <span class="tile-label">${POLLUTANTS[pol].label}</span>
      <span class="tile-value">${formatValue(value)}</span>
      <span class="tile-level">${esc(lv?.label ?? 'нет данных')}</span>
    </div>`;
}

function renderNow(now, v) {
  const { ref } = v;
  if (!ref) {
    $('#now').innerHTML = '<p class="muted">Нет данных об измерениях.</p>';
    return;
  }
  const where = ref.kind === 'measured'
    ? `${esc(ref.source)} · ${hourLabel(ref.time)} · ${ageText(ref.time, now)}`
    : 'Свежих измерений нет — прогноз модели CAMS';

  const alerts = gasAlerts(v).map((a) => {
    const lv = level(a.pol, a.value);
    return `<p class="alert">⚠ ${POLLUTANTS[a.pol].label === 'O₃' ? 'Озон' : POLLUTANTS[a.pol].label} ${formatValue(a.value)} — ${esc(lv.label.toLowerCase())}
      <span class="muted">(${esc(a.source.station)}, ${esc(a.source.time)})</span></p>`;
  }).join('');

  $('#now').innerHTML = `
    <p class="muted small">${where}</p>
    <div class="tiles">${tile('pm25', v.pm25)}${tile('pm10', v.pm10)}</div>
    <p class="muted small unit-note">мкг/м³, среднее за час</p>
    ${alerts}`;
}

// ---------- Советы на сейчас ----------

function renderAdvice(v) {
  const adv = adviceNow(v);
  const row = (icon, title, a) => `
    <details class="advice-row tone-${a.tone}">
      <summary>
        <span class="ic" aria-hidden="true">${icon}</span>
        <span class="advice-text"><span class="advice-title">${title}</span>${esc(a.line)}</span>
        <span class="chev" aria-hidden="true"></span>
      </summary>
      <div class="advice-explain">${a.explain.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    </details>`;

  $('#advice').innerHTML = `
    <div class="block-head"><h2>Советы на сейчас</h2></div>
    ${row('🚴', 'Велосипед', adv.bike)}
    ${row('🪟', 'Окна', adv.windows)}
    ${row('🌀', 'Очиститель', adv.purifier)}`;
}

// ---------- Лента прогноза ----------

function renderForecast(now) {
  const loc = prefs.loc;
  const air = state.air[loc]?.data;
  const w = state.weather[loc]?.data;
  const h0 = startOfHour(now);

  for (const b of document.querySelectorAll('#loc-seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.loc === loc));
  }

  if (!air && !w) {
    $('#strip').innerHTML = '<p class="muted small">Прогноз недоступен.</p>';
    $('#hour-detail').innerHTML = '';
    return;
  }

  const hours = [];
  for (let k = 0; k <= FORECAST_HOURS; k++) {
    const t = h0 + k * 3600;
    const wi = w?.hours?.findIndex((h) => h.time === t) ?? -1;
    hours.push({ t, k, a: hourAt(air?.hours, t), wh: wi >= 0 ? w.hours[wi] : null, flags: wi >= 0 ? roadFlags(w.hours, wi) : [] });
  }

  let prevDay = warsawParts(h0).day;
  const cols = hours.map(({ t, k, a, wh, flags }) => {
    const day = warsawParts(t).day;
    const newDay = day !== prevDay;
    prevDay = day;
    const worse = worseThanPm25(a);
    const mark = [
      worse ? `<span class="mark" style="--c:${LEVELS[worse.index].color}">${POLLUTANTS[worse.pol].label}</span>` : '',
      flags.length ? '<span class="flag">⚠</span>' : '',
    ].join('');
    const prob = wh?.probability;
    const mm = wh?.precipitation;
    return `
      <button type="button" class="col${k === state.selectedHour ? ' is-selected' : ''}${newDay ? ' new-day' : ''}" data-k="${k}"
        aria-label="${hourLabel(t)}">
        <span class="c-time">${k === 0 ? 'сейчас' : hourLabel(t)}</span>
        <span class="c-pill">${pill('pm25', a?.pm25, 'pill-sm')}</span>
        <span class="c-mark">${mark}</span>
        <span class="c-icon">${wh ? weatherIcon(wh) : ''}</span>
        <span class="c-prob${prob >= 30 ? ' strong' : ''}">${prob != null ? prob : '—'}</span>
        <span class="c-mm${mm >= 0.1 ? ' strong' : ''}">${mm >= 0.1 ? formatValue(mm) : '–'}</span>
        <span class="c-wind">${wh ? Math.round(wh.wind) : '—'}</span>
      </button>`;
  }).join('');

  $('#strip').innerHTML = `
    <div class="strip">
      <div class="labels" aria-hidden="true">
        <span class="c-time"></span>
        <span class="c-pill">PM2.5</span>
        <span class="c-mark"></span>
        <span class="c-icon"></span>
        <span class="c-prob">осадки, %</span>
        <span class="c-mm">мм</span>
        <span class="c-wind">ветер, м/с</span>
      </div>
      ${cols}
    </div>`;

  renderHourDetail(hours[Math.min(state.selectedHour, hours.length - 1)], loc);
}

function renderHourDetail(h, loc) {
  if (!h) return;
  const { t, k, a, wh, flags } = h;
  const adv = a ? hourAdvice(a) : null;
  const pols = ['pm25', 'pm10', 'o3', 'no2']
    .map((p) => `<span class="det-val">${POLLUTANTS[p].label} ${pill(p, a?.[p], 'pill-xs')}</span>`)
    .join('');
  const weather = wh
    ? [
      `${weatherIcon(wh)} ${skyLabel(wh.code)}`,
      `${Math.round(wh.temperature)}°`,
      precipText(wh),
      `ветер ${Math.round(wh.wind)} м/с, порывы ${Math.round(wh.gusts)}`,
    ].filter(Boolean).join(' · ')
    : 'нет прогноза погоды';

  $('#hour-detail').innerHTML = `
    <p class="det-head"><b>${k === 0 ? `Сейчас (${hourLabel(t)})` : hourLabel(t)}</b>
      <span class="muted">· ${esc(LOCATIONS[loc].name)}, прогноз</span></p>
    <div class="det-vals">${pols}</div>
    <p>${esc(weather)}</p>
    ${flags.map((f) => `<p class="warn-text">⚠ ${esc(f)}</p>`).join('')}
    ${adv ? `<p class="det-advice tone-${adv.tone}">🚴 ${esc(adv.line)}</p>` : ''}
    ${(adv?.notes ?? []).map((n) => `<p class="muted">${esc(n)}</p>`).join('')}`;
}

// ---------- Данные измерений ----------

function renderStations(now) {
  const gios = state.gios?.data;
  const air = state.air.bialystok?.data;
  if (!gios?.stations?.length) {
    $('#stations').innerHTML = '<p class="muted small">Нет данных.</p>';
    return;
  }
  const list = gios.stations.map((st) => {
    const latest = Object.keys(st.series)
      .map((pol) => ({ pol, p: latestPoint(st.series[pol].points) }))
      .filter((x) => x.p);
    const newest = Math.max(...latest.map((x) => x.p.time), 0);
    const stale = !newest || now - newest > STALE_HOURS * 3600;
    const vals = ['pm25', 'pm10', 'no2', 'o3']
      .filter((pol) => st.series[pol])
      .map((pol) => dotValue(pol, latest.find((x) => x.pol === pol)?.p.value))
      .join('');
    return `
      <li class="station${stale ? ' is-stale' : ''}">
        <div class="st-head">
          <span class="st-name">${esc(st.name)}</span>
          <span class="tag">${esc(st.type)}</span>
          <span class="st-time">${stale ? '⏱ ' : ''}${newest ? hourLabel(newest) : 'нет данных'}</span>
        </div>
        <div class="st-vals">${vals}</div>
      </li>`;
  }).join('');

  let modelLine = '';
  const ref = freshPoint(gios.stations, 609, 'pm25', now);
  const modelThen = ref && hourAt(air?.hours, ref.time);
  if (modelThen) {
    modelLine = `<p class="muted small">Для сравнения, модель CAMS на ${hourLabel(ref.time)}:
      PM2.5 ${formatValue(modelThen.pm25)} · PM10 ${formatValue(modelThen.pm10)}.</p>`;
  }

  let issues = '';
  if (gios.errors?.length) {
    issues += `<p class="warn-text small">GIOŚ не ответил по ${gios.errors.length} датчик(ам) — у них показаны прежние значения.</p>`;
  }
  if (gios.generatedAtUnix && now - gios.generatedAtUnix > 2 * 3600) {
    issues += `<p class="warn-text small">Сбор данных не обновлялся с ${hourLabel(gios.generatedAtUnix)} (${ageText(gios.generatedAtUnix, now)}).</p>`;
  }

  $('#stations').innerHTML = `<ul class="stations">${list}</ul>${modelLine}${issues}`;
}

// ---------- График ----------

function renderChartBlock(now) {
  const pol = prefs.pol;
  const air = state.air.bialystok?.data;
  const h0 = startOfHour(now);
  for (const b of document.querySelectorAll('#pol-seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.pol === pol));
  }
  const st = state.gios?.data?.stations?.find((s) => s.id === CHART_STATION[pol]);
  const measured = st?.series?.[pol]?.points ?? null;

  $('#chart').innerHTML = air
    ? renderChart({
      pollutant: pol,
      start: h0 - CHART_PAST_HOURS * 3600,
      now,
      end: h0 + FORECAST_HOURS * 3600,
      model: air.hours,
      measured,
    })
    : '<p class="muted small">Нет данных для графика.</p>';

  $('#chart-legend').innerHTML = `
    ${measured ? `<span><i class="lg-meas"></i>измерено · ${esc(st.name)}</span>` : ''}
    <span><i class="lg-model"></i>модель CAMS</span>
    <span class="muted">${POLLUTANTS[pol].label}, мкг/м³</span>`;
}

// ---------- Источники и статус ----------

function renderSources() {
  const gios = state.gios?.data;
  const grid = state.air[prefs.loc]?.data?.grid;
  $('#sources').innerHTML = `
    <p>Измерения: <a href="https://powietrze.gios.gov.pl/" target="_blank" rel="noopener">GIOŚ</a>,
      текущие данные, не верифицированы${gios ? `, собраны в ${hourLabel(gios.generatedAtUnix)}` : ''}.</p>
    <p>Прогноз воздуха: CAMS European ensemble (Copernicus) через
      <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0,
      сетка ~11 км${grid ? `, узел ${grid.lat.toFixed(2)}, ${grid.lon.toFixed(2)}` : ''}.</p>
    <p>Погода: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0. Время — Europe/Warsaw.</p>`;
}

function renderStatus() {
  const status = state.loading
    ? 'обновление…'
    : state.lastFetch
      ? `обновлено в ${hourLabel(Math.floor(state.lastFetch / 1000))}`
      : 'загрузка…';
  $('#status').textContent = status;

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
    ? `Не удалось обновить: ${failed.map(([n]) => n).join(', ')}. Показаны данные от ${hourLabel(Math.floor(oldest / 1000))}.`
    : `Нет данных: ${failed.map(([n]) => n).join(', ')}. Проверьте подключение.`;
}

function render() {
  const now = nowSec();
  const v = currentValues(now);
  renderNow(now, v);
  renderAdvice(v);
  renderForecast(now);
  renderStations(now);
  renderChartBlock(now);
  renderSources();
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
    renderChartBlock(nowSec());
  });
  $('#strip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    state.selectedHour = Number(b.dataset.k);
    for (const c of document.querySelectorAll('#strip .col')) c.classList.toggle('is-selected', c === b);
    // Перерисовываем только подробности часа, чтобы лента не прыгала.
    const scroll = $('#strip .strip').scrollLeft;
    renderForecast(nowSec());
    $('#strip .strip').scrollLeft = scroll;
  });
  $('#refresh').addEventListener('click', refresh);

  // Приложение с главного экрана часто остаётся в памяти: при возвращении обновляем данные.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - state.lastFetch > 10 * 60 * 1000) refresh();
    else render();
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
