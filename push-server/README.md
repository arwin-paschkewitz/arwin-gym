# gym-push — rest-end Web Push scheduler

Cloudflare Worker and a Durable Object. Each device gets one Durable Object, keyed by a random device id.
- `POST /schedule {id, sub, at}` sets the alarm. A new schedule replaces the old one, which handles the −15/+15 and edit-rest changes.
- `POST /cancel {id}` handles Skip, cancel workout and finish.
- `POST /test {id, sub}` sends a push straight away.

When the alarm fires, the worker sends an RFC 8291 (aes128gcm) encrypted push with VAPID (ES256) auth.
Requests are accepted only from the `arwin-paschkewitz.github.io` origin, and only to Apple, Google, Mozilla or Microsoft push endpoints, for times up to 2 h ahead.
The VAPID **private** key never enters this repo. It is set as a Worker secret.

Deploy (free Cloudflare plan; SQLite Durable Objects are included):
```
npm i -D wrangler@3
npx wrangler login            # one-time browser sign-in to Cloudflare
npx wrangler deploy
npx wrangler secret put VAPID_PRIVATE_JWK   # JSON JWK of the private key
npx wrangler secret put VAPID_PUBLIC        # must match VAPID_PUB in index.html
npx wrangler secret put VAPID_SUBJECT       # mailto:...
```
Then set `PUSH_API` in index.html to the `https://gym-push.<subdomain>.workers.dev` URL.
