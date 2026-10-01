const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ready = p => p.waitForFunction(() => document.body.classList.contains('tt-on') && (!document.getElementById('ld-root') || document.getElementById('ld-root').hidden), null, { timeout: 60000 });
  let p = await ctx.newPage();
  await p.goto(base); await ready(p); await p.waitForTimeout(1500);
  console.log('1차 방문 완료. SW 제어 중:', await p.evaluate(() => !!navigator.serviceWorker.controller),
    '저장소 항목:', await p.evaluate(async () => { const ks = await caches.keys(); const out = {}; for (const k of ks) out[k] = (await (await caches.open(k)).keys()).length; return out; }));
  await p.close();
  try { await fetch(base + '__die'); } catch (e) {}
  await new Promise(r => setTimeout(r, 800));
  let reachable = true; try { await fetch(base + 'sw.js'); } catch (e) { reachable = false; }
  console.log('서버 접근 가능?', reachable);
  p = await ctx.newPage();
  const errs = [], fails = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 100)));
  p.on('requestfailed', r => fails.push(r.url().slice(-40)));
  const t0 = Date.now();
  await p.goto(base).catch(e => console.log('goto 실패', String(e).slice(0, 80)));
  await ready(p);
  console.log('2차(서버 꺼진 상태) 타이틀까지', Date.now() - t0, 'ms');
  await p.waitForTimeout(800); await p.evaluate(() => document.querySelector('.tt-btn.tt-b0').click());
  for (let i = 0; i < 40; i++) { await p.evaluate(() => { const b = document.querySelector('.vn-box'); b && b.click(); }); await p.waitForTimeout(250); }
  const info = await p.evaluate(() => ({ cls: document.body.className, hub: !!document.querySelector('.vn-choices:not([hidden]) button'), vn: document.body.classList.contains('vn-on'), imgs: Array.from(document.querySelectorAll('.vn-sprite')).map(i => i.alt + ':' + (i.naturalWidth > 0)), name: (document.querySelector('.vn-name') || {}).textContent }));
  console.log('대사 장면 진행:', JSON.stringify(info), '에러:', errs, '실패 요청:', fails.slice(0, 3));
  await p.screenshot({ path: process.argv[4] || 'offline-shot.png' });
  await b.close();
})();
