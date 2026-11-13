// v2026.11.14.4 · Gym Log SW: network-first documents, clear old caches, rest-end push
const BUILD="2026.11.14.4";
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil((async()=>{
  try{const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)))}catch(_){}
  await self.clients.claim();
})()));
self.addEventListener("message",e=>{if(e.data&&e.data.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  const path=url.pathname;
  const isDoc=req.mode==="navigate"||req.destination==="document"
    ||/\/(index\.html)?$/.test(path)
    ||path.endsWith("/version.json")
    ||path.endsWith("/sw.js")
    ||path.endsWith("version.json");
  if(!isDoc)return;
  e.respondWith((async()=>{
    try{return await fetch(req,{cache:"no-store"})}
    catch(err){const cached=await caches.match(req);if(cached)return cached;throw err}
  })());
});
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}
 e.waitUntil(self.registration.showNotification(d.title||"Rest over 💪",{body:d.body||"Time for your next set",tag:"gym-rest",renotify:true,icon:"img/icon-192.png",badge:"img/icon-192.png",data:{url:self.registration.scope}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l)if(c.url.startsWith(self.registration.scope)&&"focus"in c)return c.focus();return self.clients.openWindow(self.registration.scope)}))});
