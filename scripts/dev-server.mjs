// Локальный просмотр: `npm run dev` → http://localhost:8080
// Отдаёт папку web/, а data/latest.json — из .local-store (его создаёт `npm run update-data`).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = rel.startsWith('data/')
    ? path.resolve('.local-store', rel.slice(5))
    : path.resolve('web', rel);
  if (!file.startsWith(path.resolve('web')) && !file.startsWith(path.resolve('.local-store'))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
