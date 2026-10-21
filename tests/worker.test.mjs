import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/src/index.js';

const controller = { cron: '17,47 * * * *' };

test('Будильник отправляет запрос на запуск процесса GitHub', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  t.mock.method(console, 'log', () => {});
  await worker.scheduled(controller, { GITHUB_TOKEN: 'test-token' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /artemleshko\/air-window\/actions\/workflows\/update-and-deploy\.yml\/dispatches$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main' });
});

test('Будильник сообщает об ошибке, если GitHub не принял запуск или нет ключа', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad credentials', { status: 401 }));
  t.mock.method(console, 'error', () => {});
  await assert.rejects(worker.scheduled(controller, { GITHUB_TOKEN: 'bad' }), /401/);
  await assert.rejects(worker.scheduled(controller, {}), /GITHUB_TOKEN/);
});
