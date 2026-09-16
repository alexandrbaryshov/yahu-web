// Небольшие утилиты для работы с HTTP поверх встроенного модуля 'http' —
// без Express и без внешних зависимостей.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

// Текстовые форматы реально выигрывают от gzip (обычно на 60-80% меньше);
// PNG/ICO уже сжаты внутри собственного формата — гонять их через zlib ещё
// раз бессмысленно (пережимать нечего, только тратить CPU).
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg']);
// Совсем маленькие ответы сжимать не стоит — сам gzip-заголовок и накладные
// расходы могут "съесть" всю экономию.
const MIN_COMPRESS_SIZE = 512;

function acceptsGzip(req) {
  return /\bgzip\b/.test(req.headers['accept-encoding'] || '');
}

// Отправляет body с учётом Accept-Encoding: gzip, если это имеет смысл.
// Общая для sendJSON и serveStatic логика — вынесена, чтобы не дублировать.
function sendCompressible(req, res, status, headers, body, isText) {
  if (isText && body.length >= MIN_COMPRESS_SIZE && acceptsGzip(req)) {
    zlib.gzip(body, (err, gzipped) => {
      if (err) { // сжатие не удалось — не страшно, просто отдаём как есть
        res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
        return res.end(body);
      }
      res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Content-Length': gzipped.length });
      res.end(gzipped);
    });
    return;
  }
  res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendJSON(req, res, status, data) {
  const body = JSON.stringify(data);
  sendCompressible(req, res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body, true);
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

function serveStatic(publicDir, req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(publicDir, filePath);
  if (!fullPath.startsWith(publicDir)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fullPath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControlFor(ext) };
    sendCompressible(req, res, 200, headers, data, COMPRESSIBLE_EXT.has(ext));
  });
}

module.exports = { sendJSON, readBody, serveStatic, MIME, MAX_BODY_SIZE };
