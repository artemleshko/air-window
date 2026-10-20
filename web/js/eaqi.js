// Европейский индекс качества воздуха (EAQI), редакция EEA 2024.
// Верхние границы классов в мкг/м³, по часовым значениям — как в документации Open-Meteo
// (https://open-meteo.com/en/docs/air-quality-api) и отчёте ETC HE 2024/17.

export const LEVELS = [
  { key: 'good', label: 'Хорошо', color: '#50F0E6', text: '#0b2b2a' },
  { key: 'fair', label: 'Удовлетворительно', color: '#50CCAA', text: '#0b2b22' },
  { key: 'moderate', label: 'Умеренно', color: '#F0E641', text: '#2e2b05' },
  { key: 'poor', label: 'Плохо', color: '#FF5050', text: '#ffffff' },
  { key: 'very-poor', label: 'Очень плохо', color: '#960032', text: '#ffffff' },
  { key: 'extremely-poor', label: 'Крайне плохо', color: '#7D2181', text: '#ffffff' },
];

export const BANDS = {
  pm25: [5, 15, 50, 90, 140],
  pm10: [15, 45, 120, 195, 270],
  no2: [10, 25, 60, 100, 150],
  o3: [60, 100, 120, 160, 180],
};

// Номер класса 0–5 или null, если значения нет.
export function levelIndex(pollutant, value) {
  if (value == null || Number.isNaN(value)) return null;
  const bands = BANDS[pollutant];
  if (!bands) throw new Error(`Неизвестный загрязнитель: ${pollutant}`);
  const i = bands.findIndex((upper) => value <= upper);
  return i === -1 ? bands.length : i;
}

export function level(pollutant, value) {
  const i = levelIndex(pollutant, value);
  return i == null ? null : { index: i, ...LEVELS[i] };
}
