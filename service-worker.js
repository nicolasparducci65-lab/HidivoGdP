const CACHE_NAME = 'hidivo-v5';
const ASSETS = [
  '/HidivoGdP/',
  '/HidivoGdP/index.html',
  '/HidivoGdP/styles.css',
  '/HidivoGdP/constantes.js',
  '/HidivoGdP/registro-obra.html',
  '/HidivoGdP/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Instalar: cachear assets principales
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS.filter(u => u.startsWith('/')));
    })
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback a cache
self.addEventListener('fetch', e => {
  // Solo manejar peticiones http/https (ignorar chrome-extension:// y otros esquemas)
  if(!e.request.url.startsWith('http')) return;
  // No interceptar peticiones a Supabase (necesitan red siempre)
  if(e.request.url.includes('supabase.co')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Guardar en cache si es exitoso
        if(res.ok && e.request.method === 'GET'){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── WEB PUSH ──

// Recibir una notificación push del servidor y mostrarla
self.addEventListener('push', e => {
  let datos = {};
  try{
    datos = e.data ? e.data.json() : {};
  }catch(err){
    datos = { titulo: 'HIDIVO', cuerpo: e.data ? e.data.text() : 'Tienes una notificación nueva' };
  }

  const titulo = datos.titulo || 'HIDIVO';
  const opciones = {
    body: datos.cuerpo || '',
    icon: 'https://cdn.gamma.app/7qw1kgi7655gw0b/96beb8c70ba84669857fc94d2be25a07/original/logo-Hidivo.png',
    badge: 'https://cdn.gamma.app/7qw1kgi7655gw0b/96beb8c70ba84669857fc94d2be25a07/original/logo-Hidivo.png',
    data: { url: datos.url || '/HidivoGdP/' },
    tag: datos.tag || undefined,
    renotify: !!datos.tag
  };

  e.waitUntil(self.registration.showNotification(titulo, opciones));
});

// Click en la notificación: enfocar una pestaña existente o abrir una nueva
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/HidivoGdP/';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      for(const client of clientsArr){
        if(client.url.includes('/HidivoGdP/') && 'focus' in client){
          return client.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});