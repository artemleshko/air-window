// Погода для тренировки: тип осадков и эвристики «мокрая / скользкая дорога».
// Эвристики — подсказка по прогнозу температуры и осадков, а не знание о состоянии дорог.

const FREEZING_CODES = new Set([56, 57, 66, 67]);

const CODE_LABELS = {
  0: 'ясно', 1: 'почти ясно', 2: 'переменная облачность', 3: 'пасмурно',
  45: 'туман', 48: 'туман с изморозью',
  51: 'морось', 53: 'морось', 55: 'сильная морось', 56: 'ледяная морось', 57: 'ледяная морось',
  61: 'дождь', 63: 'дождь', 65: 'сильный дождь', 66: 'ледяной дождь', 67: 'ледяной дождь',
  71: 'снег', 73: 'снег', 75: 'сильный снег', 77: 'снежная крупа',
  80: 'ливень', 81: 'ливень', 82: 'сильный ливень', 85: 'снегопад', 86: 'сильный снегопад',
  95: 'гроза', 96: 'гроза с градом', 99: 'гроза с градом',
};

export function skyLabel(code) {
  return CODE_LABELS[code] ?? '';
}

// Тип осадков в этот час или null, если осадков не ожидается.
export function precipKind(h) {
  const liquid = (h.rain ?? 0) + (h.showers ?? 0);
  const snow = h.snowfall ?? 0;
  if (FREEZING_CODES.has(h.code)) return 'ледяной дождь';
  if (snow > 0 && liquid > 0) return 'мокрый снег';
  if (snow > 0 || (h.code >= 71 && h.code <= 77) || h.code === 85 || h.code === 86) return 'снег';
  if (h.code >= 95) return 'гроза';
  if (liquid > 0 || (h.precipitation ?? 0) > 0 || (h.code >= 51 && h.code <= 82)) {
    return h.code >= 51 && h.code <= 55 ? 'морось' : 'дождь';
  }
  return null;
}

const MM = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

// Короткая строка об осадках: «дождь · 60% · 0,4 мм» или «осадков нет · 10%».
export function precipText(h) {
  const kind = precipKind(h);
  const prob = h.probability != null ? `${h.probability}%` : null;
  if (!kind && !(h.precipitation > 0)) {
    return prob && h.probability >= 5 ? `без осадков · ${prob}` : 'без осадков';
  }
  return [kind ?? 'осадки', prob, `${MM.format(h.precipitation ?? 0)} мм`].filter(Boolean).join(' · ');
}

// Предупреждения для часа i по почасовым рядам погоды (включая прошедшие часы).
export function roadFlags(hours, i) {
  const h = hours[i];
  const flags = [];
  if (FREEZING_CODES.has(h.code)) {
    flags.push('ледяной дождь — гололёд');
  } else if (h.temperature != null && h.temperature <= 1) {
    let recent = 0;
    for (let k = Math.max(0, i - 6); k <= i; k++) recent += hours[k].precipitation ?? 0;
    if (recent >= 0.2) flags.push('около нуля и недавние осадки — риск гололёда');
  }
  if (h.temperature != null && h.temperature >= 1) {
    let minPast = Infinity;
    for (let k = Math.max(0, i - 48); k < i; k++) {
      if (hours[k].temperature != null) minPast = Math.min(minPast, hours[k].temperature);
    }
    if (minPast <= -1) flags.push('оттепель после мороза — мокро, местами скользко');
  }
  if ((h.gusts ?? 0) >= 14) flags.push(`порывы ветра до ${Math.round(h.gusts)} м/с`);
  return flags;
}

// Значок погоды по коду WMO; ночью вместо солнца — луна.
export function weatherIcon(h) {
  const c = h.code;
  const night = h.isDay === 0;
  const kind = precipKind(h);
  if (kind === 'мокрый снег' || kind === 'снег') return '🌨';
  if (kind === 'гроза') return '⛈';
  if (kind === 'морось') return '🌦';
  if (kind) return '🌧';
  if (c === 45 || c === 48) return '🌫';
  if (c === 0) return night ? '🌙' : '☀️';
  if (c === 1) return night ? '🌙' : '🌤';
  if (c === 2) return night ? '☁️' : '⛅';
  return '☁️';
}
