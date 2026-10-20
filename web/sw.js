// Service worker: позволяет открыть приложение без сети.
// Файлы приложения — «сначала сеть, потом кэш»: обновления видны сразу, а без сети
// открывается последняя сохранённая версия. Данные прогнозов кэширует само приложение
// (localStorage), поэтому запросы к Open-Meteo здесь не перехватываются.

const CACHE = 'air-window-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'js/app.js',
  'js/config.js',
  'js/eaqi.js',
  'js/time.js',
  'js/weather.js',
  'js/advice.js',
  'js/api.js',
  'js/chart.js',
  'js/format.js',
  'js/texts.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Файл измерений с меткой ?t= кэшировать не нужно — его сохраняет приложение.
  if (url.pathname.endsWith('/data/latest.json')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw new Error('offline');
    }
  })());
});
