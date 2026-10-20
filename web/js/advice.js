// Советы: велосипед, окна, очиститель. Пороги согласованы 2026-10-20 (см. docs/DECISIONS.md),
// тексты — в texts.js (docs/ADVICE-TEXTS.md).
// Основа — PM2.5 и PM10 в мкг/м³ (часовые значения), озон и NO₂ дополняют совет для велосипеда.

import { HOME_STATION_ORDER, STALE_HOURS } from './config.js';
import { formatValue } from './format.js';
import * as T from './texts.js';

export { formatValue };

export const PM25_TIERS = [25, 50, 90];
export const PM10_TIERS = [50, 100, 180];
export const O3_HIGH = 120;
export const O3_SEVERE = 180;
export const NO2_HIGH = 60;

const BIKE_TONES = ['ok', 'caution', 'warn', 'bad'];
const WINDOW_TONES = ['ok', 'ok', 'caution', 'warn'];

const tierOf = (v, tiers) => (v == null ? -1 : tiers.filter((t) => v > t).length);

// Последнее непустое значение ряда [[unixSec, value], ...].
export function latestPoint(points) {
  if (!points) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i][1] != null) return { time: points[i][0], value: points[i][1] };
  }
  return null;
}

export function freshPoint(stations, stationId, pol, nowSec) {
  const st = stations?.find((s) => s.id === stationId);
  const p = latestPoint(st?.series?.[pol]?.points);
  return p && nowSec - p.time <= STALE_HOURS * 3600 ? { ...p, station: st.name } : null;
}

// Опорная станция для частиц: Варшавская, при устаревших данных — следующая фоновая,
// без свежих измерений — модель на текущий час (с пометкой).
export function homeReference(stations, modelNow, nowSec) {
  for (const id of HOME_STATION_ORDER) {
    const p = freshPoint(stations, id, 'pm25', nowSec);
    if (p) {
      const pm10 = freshPoint(stations, id, 'pm10', nowSec);
      return { value: p.value, pm10: pm10?.value ?? null, time: p.time, kind: 'measured', source: p.station, stationId: id };
    }
  }
  if (modelNow?.pm25 != null) {
    return { value: modelNow.pm25, pm10: modelNow.pm10 ?? null, time: modelNow.time, kind: 'model', source: 'модель CAMS' };
  }
  return null;
}

function bikeLevel({ pm25, pm10, o3 }) {
  const t25 = tierOf(pm25, PM25_TIERS);
  const t10 = tierOf(pm10, PM10_TIERS);
  const pmTier = Math.max(t25, t10);
  const driver = t10 > t25 ? 'pm10' : 'pm25';
  // Сильный озон поднимает уровень, но респиратор от него не помогает — отдельная строка.
  const ozoneDriven = o3 != null && o3 > O3_SEVERE && pmTier >= 0 && pmTier < 2;
  return { tier: ozoneDriven ? 2 : pmTier, pmTier, driver, ozoneDriven };
}

const bikeLine = ({ tier, ozoneDriven }) => (ozoneDriven ? T.BIKE_OZONE_SEVERE_LINE : T.BIKE[tier].line);

const NONE = { tone: 'none', line: 'Нет данных.', explain: [] };

// Советы «на сейчас». v: { pm25, pm10, o3, no2, pm: {station, time, kind}, gas: {station, time} | null, cleanest }
export function adviceNow(v) {
  if (v.pm25 == null) return { bike: NONE, windows: NONE, purifier: NONE };
  const prefix = v.pm.kind === 'model' ? [T.MODEL_PREFIX] : [];

  const bl = bikeLevel(v);
  const bikeExplain = [...prefix, T.BIKE[bl.pmTier].explain({ ...v, driver: bl.driver })];
  if (v.gas && (v.o3 != null || v.no2 != null)) {
    const ozoneHigh = v.o3 != null && v.o3 > O3_HIGH;
    const no2High = v.no2 != null && v.no2 > NO2_HIGH;
    if (v.o3 > O3_SEVERE) bikeExplain.push(T.BIKE_GASES.ozoneSevere(v));
    else if (ozoneHigh) bikeExplain.push(T.BIKE_GASES.ozone(v));
    if (no2High) bikeExplain.push(T.BIKE_GASES.no2(v));
    if (!ozoneHigh && !no2High) bikeExplain.push(T.BIKE_GASES.normal(v));
  }

  const wTier = tierOf(v.pm25, [15, 25, 50]);
  const windowsExplain = [...prefix, T.WINDOWS[wTier].explain(v)];
  if (v.gas && v.o3 != null && v.o3 > O3_HIGH) windowsExplain.push(T.WINDOWS_OZONE(v));

  const pTier = v.pm25 > 25 ? 1 : 0;

  return {
    bike: { tone: BIKE_TONES[bl.tier], line: bikeLine(bl), explain: bikeExplain },
    windows: { tone: WINDOW_TONES[wTier], line: T.WINDOWS[wTier].line, explain: windowsExplain },
    purifier: {
      tone: pTier ? 'caution' : 'ok',
      line: T.PURIFIER[pTier].line,
      explain: [...prefix, T.PURIFIER[pTier].explain(v), T.PURIFIER_TAIL],
    },
  };
}

// Короткий совет для велосипеда на час прогноза (по значениям модели).
export function hourAdvice({ pm25, pm10, o3, no2 }) {
  const bl = bikeLevel({ pm25, pm10, o3 });
  if (bl.pmTier < 0) return { tone: 'none', line: 'Нет данных о частицах.', notes: [] };
  const notes = [];
  if (o3 != null && o3 > O3_HIGH) notes.push(T.HOUR_OZONE);
  if (no2 != null && no2 > NO2_HIGH) notes.push(T.HOUR_NO2);
  return { tone: BIKE_TONES[bl.tier], line: bikeLine(bl), notes };
}

// Предупреждения для верхнего блока: озон и NO₂ в классе «плохо» и хуже.
export function gasAlerts({ o3, no2, gas }) {
  const alerts = [];
  if (o3 != null && o3 > O3_HIGH) alerts.push({ pol: 'o3', value: o3, source: gas });
  if (no2 != null && no2 > NO2_HIGH) alerts.push({ pol: 'no2', value: no2, source: gas });
  return alerts;
}
