// 느린 회선 흉내 서버: 모든 응답이 하나의 공유 대역폭을 나눠 쓰고, 응답마다 첫 바이트 전에 지연이 붙음.
// 사용: ROOT=dir PORT=8123 BW=100000 LAT=400 node slowserver.js
//   BW  = 전체 대역폭 (bytes/s, 0 이면 무제한)   LAT = 요청당 지연 (ms)
//   MAXAGE = Cache-Control max-age (GitHub Pages 기본은 600)
//   /__stats  -> JSON (요청 목록),  /__reset -> 통계 초기화
//   /__bw?v=NNN&lat=NNN -> 실행 중에 대역폭/지연 바꾸기 (0 = 무제한)
//   /__fail?p=0.3&mode=drop|stall -> 이미지 요청을 이 확률로 중간에 끊거나(drop) 멈춤(stall) (불안정한 회선 흉내. BW 가 0 이면 안 걸림)
//   /__die -> 서버 종료
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), url = require('url');
const ROOT = path.resolve(process.env.ROOT || '.');
const PORT = +(process.env.PORT || 8123);
let BW = +(process.env.BW || 0), LAT = +(process.env.LAT || 0);
const MAXAGE = +(process.env.MAXAGE || 600);
let FAIL = +(process.env.FAIL || 0), FAILMODE = process.env.FAILMODE || 'drop';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.md': 'text/plain; charset=utf-8' };
let log = [];
const active = new Set();   // { res, buf, pos, done }

setInterval(() => {
  if (!active.size) return;
  const tick = 25;
  let budget = BW ? Math.max(1, Math.floor(BW * tick / 1000)) : Infinity;
  let list = Array.from(active);
  // 공정하게 나눔
  let guard = 0;
  while (budget > 0 && list.length && guard++ < 1000) {
    const share = budget === Infinity ? Infinity : Math.max(1, Math.floor(budget / list.length));
    const next = [];
    for (const a of list) {
      if (a.res.destroyed) { active.delete(a); continue; }
      const n = Math.min(share, a.buf.length - a.pos, budget);
      if (n > 0) { a.res.write(a.buf.subarray(a.pos, a.pos + n)); a.pos += n; budget -= n; a.entry.sent += n; }
      if (a.pos >= a.buf.length) { a.res.end(); active.delete(a); a.entry.t1 = Date.now(); }
      else if (a.failAt != null && a.pos >= a.failAt) { a.entry.failed = FAILMODE; if (FAILMODE === 'drop') a.res.destroy(); active.delete(a); }
      else next.push(a);
    }
    list = next;
    if (budget === Infinity) break;
  }
}, 25);

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === '/__stats') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(log)); return; }
  if (u.pathname === '/__reset') { log = []; res.end('ok'); return; }
  if (u.pathname === '/__die') { res.end('bye'); setTimeout(() => process.exit(0), 50); return; }          // 서버를 끔 (오프라인 시험용)
  if (u.pathname === '/__bw') { if (u.query.v != null) BW = +u.query.v; if (u.query.lat != null) LAT = +u.query.lat; res.end('ok'); return; }
  if (u.pathname === '/__fail') { FAIL = +(u.query.p || 0); FAILMODE = u.query.mode || 'drop'; res.end('ok'); return; }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  const entry = { url: p, t0: Date.now(), t1: null, status: 0, bytes: 0, sent: 0, cond: !!req.headers['if-none-match'], ua: (req.headers['user-agent'] || '').slice(0, 20) };
  log.push(entry);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    setTimeout(() => { entry.status = 404; entry.t1 = Date.now(); res.statusCode = 404; res.end('nf'); }, LAT);
    return;
  }
  const st = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  setTimeout(() => {
    if (req.headers['if-none-match'] === etag) {
      entry.status = 304; entry.t1 = Date.now();
      res.writeHead(304, { etag, 'cache-control': 'max-age=' + MAXAGE });
      res.end(); return;
    }
    let buf = fs.readFileSync(file);
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', etag, 'last-modified': st.mtime.toUTCString(), 'cache-control': 'max-age=' + MAXAGE, 'access-control-allow-origin': '*' };
    if (/\.(html|js|css|json)$/.test(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) { buf = zlib.gzipSync(buf, { level: 6 }); headers['content-encoding'] = 'gzip'; }
    headers['content-length'] = buf.length;
    entry.status = 200; entry.bytes = buf.length;
    res.writeHead(200, headers);
    const a = { res, buf, pos: 0, entry, failAt: null };
    if (FAIL && /\.(webp|png)$/.test(ext) && Math.random() < FAIL) a.failAt = Math.floor(buf.length * Math.random() * 0.8);
    req.on('close', () => { active.delete(a); });
    active.add(a);
  }, LAT);
}).listen(PORT, () => console.log('slowserver', ROOT, PORT, 'BW', BW, 'LAT', LAT));
