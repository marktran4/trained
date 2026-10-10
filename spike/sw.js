/* Spike: pass-through service worker. Its narrower scope (/trained/spike/) wins over
   Trained's cache-first worker, so spike pages always come fresh from the network. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
