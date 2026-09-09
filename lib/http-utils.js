// Небольшие утилиты для работы с HTTP поверх встроенного модуля 'http' —
// без Express и без внешних зависимостей.
const fs = require('fs');
const path = require('path');

// 5 МБ фото в base64 (data URL) весит ~6.8 МБ текста + служебные поля JSON —
// берём предел с запасом.
const MAX_BODY_SIZE = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

// Иконки и манифест визуально никогда не меняются между деплоями — можно
// кэшировать надолго. HTML/JS могут поменяться в любом деплое, поэтому им
// ставим "always revalidate" (без этого браузер мог бы вообще не обратиться
// к серверу при обновлении кода) — основную работу по мгновенной загрузке
// делает service worker (см. public/sw.js), а эти заголовки лишь подстраховка
// на случай, если он ещё не активен (самый первый визит) или недоступен.
function cacheControlFor(ext) {
  if (ext === '.png' || ext === '.ico' || ext === '.svg') return 'public, max-age=86400';
  if (ext === '.json') return 'public, max-age=3600'; // manifest.json
  return 'no-cache'; // .html, .js — разрешаем кэшировать, но всегда проверять свежесть
}

function serveStatic(publicDir, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(publicDir, filePath);
  if (!fullPath.startsWith(publicDir)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControlFor(ext) });
    res.end(data);
  });
}

module.exports = { sendJSON, readBody, serveStatic, MIME, MAX_BODY_SIZE };
