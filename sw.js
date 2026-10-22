// Gym Log service worker: rest-end push notifications only (no caching, so updates always load fresh)
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}
 e.waitUntil(self.registration.showNotification(d.title||"Rest over 💪",{body:d.body||"Time for your next set",tag:"gym-rest",renotify:true,icon:"img/icon-192.png",badge:"img/icon-192.png",data:{url:self.registration.scope}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l)if(c.url.startsWith(self.registration.scope)&&"focus"in c)return c.focus();return self.clients.openWindow(self.registration.scope)}))});
