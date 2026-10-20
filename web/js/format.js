// Форматирование чисел для экрана: «13,8», «—» вместо пустого значения.

const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const formatValue = (v) => (v == null ? '—' : fmt.format(v));
