import { precacheAndRoute } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)

// Sans ça, un nouveau service worker installé reste "en attente" tant qu'un
// onglet utilisant l'ancien est encore ouvert — l'app resterait figée sur
// une version périmée même après un rafraîchissement classique.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'mymt5', {
      body: data.body ?? '',
      icon: '/pwa/icon-192.png',
      badge: '/pwa/icon-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/'))
})
