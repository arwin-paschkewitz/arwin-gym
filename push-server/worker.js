// Gym Log rest-end push scheduler: Cloudflare Worker + Durable Object alarm.
// Secrets (set with `wrangler secret put`): VAPID_PRIVATE_JWK (JSON), VAPID_PUBLIC (base64url), VAPID_SUBJECT (mailto:)
const ORIGINS = ["https://arwin-paschkewitz.github.io"];
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const MAX_DELAY = 2 * 3600e3;
const b64u = { enc: b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0)) };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length } return o };
const te = new TextEncoder();
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
// RFC 8291 aes128gcm payload encryption
async function encrypt(sub, payload) {
  const uaPub = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(te.encode(payload), new Uint8Array([2]))));
  const hdr = new Uint8Array(21); hdr.set(salt); new DataView(hdr.buffer).setUint32(16, 4096); hdr[20] = 65;
  return cat(hdr, asPub, ct);
}
async function vapidAuth(env, endpoint) {
  const u = new URL(endpoint), h = b64u.enc(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u.enc(te.encode(JSON.stringify({ aud: u.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + c));
  return `vapid t=${h}.${c}.${b64u.enc(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function sendPush(env, sub, msg) {
  const body = await encrypt(sub, JSON.stringify(msg));
  return fetch(sub.endpoint, { method: "POST", body, headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "300", Urgency: "high", Topic: "rest", Authorization: await vapidAuth(env, sub.endpoint) } });
}
function okSub(env, s) {
  try { const u = new URL(s.endpoint); return (u.protocol === "https:" && PUSH_HOSTS.some(r => r.test(u.hostname)) || env.DEV_ANY_ENDPOINT === "1") && s.keys && s.keys.p256dh && s.keys.auth } catch { return false }
}
const cors = o => ({ "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" });
export default {
  async fetch(req, env) {
    const o = req.headers.get("Origin") || "", allowed = ORIGINS.includes(o) || (env.DEV_ORIGIN && o === env.DEV_ORIGIN);
    if (req.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? cors(o) : {} });
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/") return new Response("gym-push ok");
    if (!allowed || req.method !== "POST") return new Response("forbidden", { status: 403 });
    let j; try { j = await req.json() } catch { return new Response("bad json", { status: 400, headers: cors(o) }) }
    if (path === "/food-scan") return foodScan(env, j, o);
    if (!/^[a-z0-9]{16,64}$/.test(j.id || "")) return new Response("bad id", { status: 400, headers: cors(o) });
    const stub = env.REST.get(env.REST.idFromName(j.id));
    const r = await stub.fetch("https://do/" + path.replace(/^\//, ""), { method: "POST", body: JSON.stringify(j) });
    return new Response(await r.text(), { status: r.status, headers: cors(o) });
  }
};
export class RestTimer {
  constructor(state, env) { this.s = state; this.env = env }
  async fetch(req) {
    const p = new URL(req.url).pathname, j = await req.json();
    if (p === "/schedule") {
      const at = +j.at, now = Date.now();
      if (!okSub(this.env, j.sub || {})) return new Response("bad subscription", { status: 400 });
      if (!(at > now - 5000 && at < now + MAX_DELAY)) return new Response("bad time", { status: 400 });
      await this.s.storage.put({ sub: j.sub, at, title: String(j.title || "Rest over 💪").slice(0, 80), body: String(j.body || "Time for your next set").slice(0, 160) });
      await this.s.storage.setAlarm(Math.max(at, now));
      return new Response("scheduled");
    }
    if (p === "/cancel") { await this.s.storage.deleteAlarm(); await this.s.storage.delete("at"); return new Response("cancelled") }
    if (p === "/test") {
      if (!okSub(this.env, j.sub || {})) return new Response("bad subscription", { status: 400 });
      const r = await sendPush(this.env, j.sub, { title: "Gym Log", body: "Notifications work ✓" }); return new Response("push " + r.status, { status: r.ok ? 200 : 502 });
    }
    return new Response("not found", { status: 404 });
  }
  async alarm() {
    const [sub, at, title, body] = await Promise.all(["sub", "at", "title", "body"].map(k => this.s.storage.get(k)));
    if (!sub || !at) return;
    await this.s.storage.delete("at");
    const r = await sendPush(this.env, sub, { title, body, at });
    if (r.status === 404 || r.status === 410) await this.s.storage.delete("sub");
  }
}

// ---- Food photo scan: vision AI server-side (key never reaches the browser) ----
// Secret: XAI_API_KEY (wrangler secret put XAI_API_KEY). Optional VISION_MODEL (default grok-4).
async function foodScan(env, j, o) {
  const h = { ...cors(o), "Content-Type": "application/json" };
  if (!env.XAI_API_KEY) return new Response(JSON.stringify({ error: "Food scan not set up (no vision key on server)" }), { status: 503, headers: h });
  const img = String(j.image || "");
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 6e6) return new Response(JSON.stringify({ error: "bad image" }), { status: 400, headers: h });
  const prompt = "Identify each food/drink in this photo. Estimate the portion actually shown. Return ONLY JSON: {\"items\":[{\"name\":string,\"serving\":string (e.g. '150 g' or '1 cup'),\"kcal\":number,\"p\":number,\"c\":number,\"f\":number}]} with protein/carbs/fat in grams for that portion. Use Australian food names. If no food, return {\"items\":[]}." + (j.hint ? " User note: " + String(j.hint).slice(0, 200) : "");
  const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + env.XAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.VISION_MODEL || "grok-4", temperature: 0.2, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: img, detail: "high" } }, { type: "text", text: prompt }] }] }) });
  if (!r.ok) return new Response(JSON.stringify({ error: "vision API " + r.status }), { status: 502, headers: h });
  const d = await r.json(); const t = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
  let out = { items: [] }; try { out = JSON.parse((t.match(/\{[\s\S]*\}/) || ["{}"])[0]) } catch {}
  const n = v => Math.max(0, Math.round(+v || 0));
  const items = (Array.isArray(out.items) ? out.items : []).slice(0, 12).map(x => ({ name: String(x.name || "Food").slice(0, 80), serving: String(x.serving || "1 serve").slice(0, 40), kcal: n(x.kcal), p: n(x.p), c: n(x.c), f: n(x.f) }));
  return new Response(JSON.stringify({ items }), { headers: h });
}
