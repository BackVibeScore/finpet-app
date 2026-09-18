const CACHE = 'finpet-v12-onboarding-render-fix-20260918c-pets-v11-20260918e';
const ASSETS = ['./','./index.html','./styles.css','./welcome.css','./content.js','./app.js','./welcome.js','./manifest.json','./assets/objects.webp','./assets/extras.webp','./assets/worlds.webp','./assets/kopihvost-splash.webp','./assets/onboarding-1.webp','./assets/onboarding-2.webp','./assets/onboarding-3.webp','./assets/onboarding-4.webp','./assets/pets/cat.webp','./assets/pets/dog.webp','./assets/pets/mumo.webp'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url=new URL(e.request.url);
  const core=/\/(?:index\.html|styles\.css|welcome\.css|content\.js|app\.js|welcome\.js|manifest\.json)$/.test(url.pathname)||url.pathname.endsWith('/');
  const onboarding=/\/assets\/(?:kopihvost-splash|onboarding-[1-4])\.webp$/.test(url.pathname);
  const petArt=/\/assets\/pets\/(?:cat|dog|mumo)\.webp$/.test(url.pathname);
  if(core || onboarding || petArt){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('HTTP '+r.status);
      const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return r;
    }).catch(()=>caches.match(e.request).then(hit=>{
      if(hit) return hit;
      if(onboarding || petArt){
        const plain='./'+url.pathname.replace(/^\/+/, '');
        return caches.match(plain);
      }
      return caches.match('./index.html');
    })));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match('./index.html'))));
});