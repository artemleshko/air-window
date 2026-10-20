// Общие настройки: станции GIOŚ, точки прогноза, загрязнители.
// Файл используется и страницей, и скриптом сбора данных (scripts/update-data.mjs).

export const TIME_ZONE = 'Europe/Warsaw';

// Станции GIOŚ в Белостоке. ID стационарных автоматических датчиков (почасовые данные)
// проверены через api.gios.gov.pl/pjp-api/v1/rest/station/sensors/{id} 2026-10-20.
// Ручные датчики (4025 — PM2.5 на Warszawska, 28439 — PM10 на 42 Pułku) не используем:
// их данные — среднесуточные и публикуются через 4–8 недель.
export const STATIONS = [
  {
    id: 609,
    code: 'PdBialWarsza',
    name: 'Warszawska',
    address: 'ul. Warszawska 75A',
    type: 'фон, город',
    lat: 53.129306,
    lon: 23.181744,
    sensors: { pm25: 32441, pm10: 4024 },
  },
  {
    id: 17658,
    code: 'PdBialUpalna',
    name: 'Upalna',
    address: 'ul. Upalna 26',
    type: 'фон, город',
    lat: 53.129601,
    lon: 23.108054,
    sensors: { pm25: 29390, pm10: 32438 },
  },
  {
    id: 11174,
    code: 'PdBialPPiech',
    name: '42 Pułku Piechoty',
    address: 'ul. 42 Pułku Piechoty 117',
    type: 'фон, пригород',
    lat: 53.144122,
    lon: 23.216322,
    sensors: { pm25: 25909, pm10: 25908, no2: 19719, o3: 19718 },
  },
  {
    id: 11814,
    code: 'PdBialAlPils',
    name: 'Piłsudskiego',
    address: 'Al. Piłsudskiego 34',
    type: 'у дороги',
    lat: 53.135286,
    lon: 23.161325,
    sensors: { pm25: 26323, pm10: 21243, no2: 21244 },
  },
];

// Для советов «дома» берём первую станцию из списка со свежими данными PM2.5.
export const HOME_STATION_ORDER = [609, 17658, 11174];

// Какая станция показывается как «измерено» на графике для каждого загрязнителя.
export const CHART_STATION = { pm25: 609, pm10: 609, o3: 11174, no2: 11174 };

// Точки модельного прогноза (центр района, не адрес). Модель CAMS Europe — сетка ~11 км.
export const LOCATIONS = {
  bialystok: { name: 'Białystok', lat: 53.13, lon: 23.17, hasStations: true },
  suprasl: { name: 'Supraśl', lat: 53.21, lon: 23.34, hasStations: false },
};

export const POLLUTANTS = {
  pm25: { label: 'PM2.5', openMeteo: 'pm2_5' },
  pm10: { label: 'PM10', openMeteo: 'pm10' },
  o3: { label: 'O₃', openMeteo: 'ozone' },
  no2: { label: 'NO₂', openMeteo: 'nitrogen_dioxide' },
};

// Данные измерений старше этого считаем устаревшими (часы).
export const STALE_HOURS = 3;

export const FORECAST_HOURS = 12;
export const CHART_PAST_HOURS = 6;
