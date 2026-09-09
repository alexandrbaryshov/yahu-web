// Простой service worker: кэширует статическую оболочку приложения (HTML/JS/иконки),
// чтобы после первого открытия приложение быстрее грузилось и частично работало
// офлайн. Запросы к /api/* всегда идут в сеть — данные не должны быть устаревшими
// (актуальность самих данных на экране при этом всё равно обеспечивается
// мгновенно: см. localStorage-кэш состояния в app.js — loadState()).
//
// ВАЖНО: версию CACHE_NAME нужно поднимать при каждом изменении файлов из
// SHELL_FILES — иначе часть пользователей будет ещё какое-то время видеть
// старую версию оболочки из кэша (это штатное поведение stale-while-revalidate
// ниже: старая версия показывается мгновенно, а свежая тихо подгружается на
// следующий раз).
const CACHE_NAME = 'yahu-shell-v2';
const SHELL_FILES = ['/', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // данные — всегда только из сети

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
