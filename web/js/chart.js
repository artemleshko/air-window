// График одного загрязнителя: прошедшие часы — измерения станции (сплошная линия),
// весь диапазон — модель CAMS (пунктир). Фон — цветные полосы классов EAQI.

import { BANDS, LEVELS } from './eaqi.js';
import { hourLabel } from './time.js';

const W = 360;
const H = 170;
const PAD = { left: 30, right: 10, top: 10, bottom: 22 };

function pathFrom(points, x, y) {
  // Разрывы (null) прерывают линию.
  let d = '';
  let pen = false;
  for (const [t, v] of points) {
    if (v == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function renderChart({ pollutant, start, now, end, model, measured }) {
  const inRange = (t) => t >= start && t <= end;
  const modelPts = (model ?? []).filter((h) => inRange(h.time)).map((h) => [h.time, h[pollutant]]);
  const measPts = (measured ?? []).filter(([t]) => inRange(t) && t <= now);
  const values = [...modelPts, ...measPts].map(([, v]) => v).filter((v) => v != null);
  if (values.length === 0) return '<p class="muted small">Нет данных для графика.</p>';

  const bands = BANDS[pollutant];
  const yMax = Math.max(Math.max(...values) * 1.15, bands[1] * 1.1);
  const x = (t) => PAD.left + ((t - start) / (end - start)) * (W - PAD.left - PAD.right);
  const y = (v) => H - PAD.bottom - (Math.min(v, yMax) / yMax) * (H - PAD.top - PAD.bottom);

  let svg = '';
  // Полосы классов EAQI.
  let lower = 0;
  [...bands, Infinity].forEach((upper, i) => {
    if (lower >= yMax) return;
    const top = Math.min(upper, yMax);
    svg += `<rect x="${PAD.left}" y="${y(top).toFixed(1)}" width="${W - PAD.left - PAD.right}" height="${(y(lower) - y(top)).toFixed(1)}" fill="${LEVELS[i].color}" opacity="0.22"/>`;
    if (upper < yMax) {
      svg += `<text x="${PAD.left - 4}" y="${(y(upper) + 3).toFixed(1)}" class="ax" text-anchor="end">${upper}</text>`;
    }
    lower = upper;
  });
  svg += `<text x="${PAD.left - 4}" y="${(y(0) + 3).toFixed(1)}" class="ax" text-anchor="end">0</text>`;

  // Подписи часов каждые 3 часа.
  for (let t = start; t <= end; t += 3600) {
    if (Math.round((t - start) / 3600) % 3 !== 0) continue;
    svg += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${PAD.top}" y2="${H - PAD.bottom}" class="grid"/>`;
    svg += `<text x="${x(t).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${hourLabel(t)}</text>`;
  }

  // Линия «сейчас».
  svg += `<line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="${PAD.top}" y2="${H - PAD.bottom}" class="now-line"/>`;
  svg += `<text x="${(x(now) + 3).toFixed(1)}" y="${PAD.top + 9}" class="ax now-label">сейчас</text>`;

  svg += `<path d="${pathFrom(modelPts, x, y)}" class="model-line"/>`;
  if (measPts.length) {
    svg += `<path d="${pathFrom(measPts, x, y)}" class="meas-line"/>`;
    for (const [t, v] of measPts) {
      if (v != null) svg += `<circle cx="${x(t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" class="meas-dot"/>`;
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="График концентрации">${svg}</svg>`;
}
