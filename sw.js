const CACHE="msr-hce-v32";
const CORE=["./","./index.html","./styles.css","./app.js","./cloud-config.js","./cloud.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("message",event=>{
  if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;

  const req=event.request;
  const url=new URL(req.url);
  const sameOrigin=url.origin===self.location.origin;
  const isAppShell=sameOrigin && (
    req.mode==="navigate" ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/cloud.js") ||
    url.pathname.endsWith("/cloud-config.js") ||
    url.pathname.endsWith("/index.html")
  );

  if(isAppShell){
    event.respondWith(
      fetch(req)
        .then(resp=>{
          if(resp&&resp.ok){
            const copy=resp.clone();
            caches.open(CACHE).then(cache=>cache.put(req,copy));
          }
          return resp;
        })
        .catch(()=>caches.match(req).then(r=>r||caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached)return cached;
      return fetch(req).then(resp=>{
        if(resp&&(resp.ok||resp.type==="opaque")){
          const copy=resp.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy));
        }
        return resp;
      });
    })
  );
});