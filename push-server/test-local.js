// End-to-end local test: fake push service decrypts payload & verifies VAPID JWT
const http=require('http'),c=require('crypto'),ece=require('http_ece'),PUB=require('/home/box/.gym-push/vapid.json').publicKey;
const ua=c.createECDH('prime256v1');ua.generateKeys();const auth=c.randomBytes(16);
const sub={endpoint:'http://localhost:9911/push/abc',keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
const got=[];http.createServer((q,s)=>{const b=[];q.on('data',d=>b.push(d));q.on('end',()=>{const body=Buffer.concat(b);
 const m=/vapid t=([^,]+), k=(.+)/.exec(q.headers.authorization);const [h,cl,sig]=m[1].split('.');
 const pk=c.createPublicKey({key:{kty:'EC',crv:'P-256',x:Buffer.from(m[2],'base64url').subarray(1,33).toString('base64url'),y:Buffer.from(m[2],'base64url').subarray(33).toString('base64url')},format:'jwk'});
 const ok=c.verify('sha256',Buffer.from(h+'.'+cl),{key:pk,dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url'));
 const pt=ece.decrypt(body,{version:'aes128gcm',privateKey:ua,authSecret:auth.toString('base64url')}).toString();
 got.push({t:Date.now(),jwtOk:ok,kMatches:m[2]===PUB,enc:q.headers['content-encoding'],pt});s.writeHead(201);s.end()})}).listen(9911);
const P=(p,j)=>fetch('http://localhost:8787/'+p,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:8765'},body:JSON.stringify(j)}).then(r=>r.status+' '+r.statusText);
(async()=>{const id='testdevice0000000001',t0=Date.now();
 console.log('bad origin',await fetch('http://localhost:8787/schedule',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}).then(r=>r.status));
 console.log('test',await P('test',{id,sub}));
 console.log('schedule 3s',await P('schedule',{id,sub,at:t0+3000}));
 console.log('schedule 2s (other, then cancel)',await P('schedule',{id:'testdevice0000000002',sub,at:t0+2000}),await P('cancel',{id:'testdevice0000000002'}));
 console.log('reschedule 4s (adjust)',await P('schedule',{id,sub,at:t0+4000}));
 await new Promise(r=>setTimeout(r,6500));
 got.forEach(g=>console.log({...g,t:g.t-t0}));process.exit(0)})();
