// PaperScout v3 SW 逃生脚本（8.6）：注销 v2 遗留 SW 并清空其缓存，防止"新旧混合"白屏。
// M8-02 将替换为版本化缓存策略（BUILD_ID）。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('paperscout') || k.startsWith('ps-')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clientList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientList) client.navigate(client.url);
    })(),
  );
});
