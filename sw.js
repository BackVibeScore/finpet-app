const CACHE = 'finpet-v8-motion-toggle-20260917d';
const ASSETS = ['./','./index.html','./styles.css','./welcome.css','./content.js','./app.js','./welcome.js','./manifest.json','./assets/objects.webp','./assets/extras.webp','./assets/worlds.webp','./assets/welcome-hero.svg','./assets/intro-world.svg','./assets/intro-choice.svg','./assets/intro-room.svg','./assets/intro-week.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url=new URL(e.request.url);
  const core=/\/(?:index\.html|styles\.css|welcome\.css|content\.js|app\.js|welcome\.js|manifest\.json)$/.test(url.pathname)||url.pathname.endsWith('/');
  if(core){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match('./index.html'))));
});