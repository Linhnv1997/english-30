// App shell: network first (so updates land), cached copy when offline.
// Audio: cache first, with Range support so iOS Safari can play cached files.
const SHELL = "en30-shell-v1", AUDIO = "en30-audio", FONTS = "en30-fonts";
const FILES = ["./", "index.html", "app.js", "data.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("en30-shell") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function ranged(req, res){
  const range = req.headers.get("range");
  if (!range) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  return new Response(buf.slice(start, end + 1), {status: 206, headers: {
    "Content-Type": "audio/mpeg", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes"}});
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.hostname === "api.github.com" || url.hostname.endsWith("githubusercontent.com")) return;
  if (url.hostname.includes("fonts.g")){
    e.respondWith(caches.open(FONTS).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith(".mp3")){
    e.respondWith((async () => {
      const c = await caches.open(AUDIO), key = url.pathname.replace(/^.*?\/audio\//, "audio/");
      let hit = await c.match(key);
      if (!hit){
        const r = await fetch(url.href);
        if (!r.ok) return r;
        await c.put(key, r.clone()); hit = r;
      }
      return ranged(req, hit);
    })());
    return;
  }
  e.respondWith(fetch(req).then(r => { if (r.ok){ const cp = r.clone(); caches.open(SHELL).then(c => c.put(req, cp)); } return r; })
    .catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
});
