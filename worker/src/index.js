// Будильник для сбора данных Air Window.
// Расписание GitHub Actions в этом репозитории не срабатывает (проверено 2026-10-21,
// см. docs/DECISIONS.md), поэтому Cloudflare раз в полчаса просит GitHub запустить
// процесс «Обновление данных и публикация» — так же, как кнопка Run workflow.
//
// Ключ GitHub хранится в зашифрованном секрете GITHUB_TOKEN (wrangler secret put),
// в коде и в репозитории его нет. У Worker нет публичного адреса (workers_dev = false).

const DISPATCH_URL =
  'https://api.github.com/repos/artemleshko/air-window/actions/workflows/update-and-deploy.yml/dispatches';

async function dispatch(env) {
  if (!env.GITHUB_TOKEN) throw new Error('Секрет GITHUB_TOKEN не задан');
  const res = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'air-window-cron',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  // GitHub отвечает 204 без тела, если запуск принят.
  if (res.status !== 204) {
    throw new Error(`GitHub ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export default {
  async scheduled(controller, env) {
    try {
      await dispatch(env);
      console.log(`Запуск обновления отправлен (${controller.cron})`);
    } catch (err) {
      // Ошибка видна в журнале Worker в панели Cloudflare.
      console.error(`Не удалось запустить обновление: ${err.message}`);
      throw err;
    }
  },
};
