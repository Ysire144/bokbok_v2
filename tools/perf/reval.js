const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const base = process.argv[2], root = process.argv[3];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const ready = p => p.waitForFunction(() => document.body.classList.contains('tt-on') && (!document.getElementById('ld-root') || document.getElementById('ld-root').hidden), null, { timeout: 120000 });
  let p = await ctx.newPage(); await p.goto(base); await ready(p); await p.waitForTimeout(1500);
  const sz = async (u) => p.evaluate(async (u) => (await (await fetch(u)).arrayBuffer()).byteLength, u);
  const target = 'images/characters/%EC%8B%9C%EB%93%9C_%EB%85%B8%EB%A7%90.webp';   // 시드_노말
  const before = await sz(target);
  // 서버에서 시드 그림을 다른 그림(벨)으로 바꿔치기
  fs.copyFileSync(root + '/images/characters/벨_노말.webp', root + '/images/characters/시드_노말.webp');
  const bellSize = fs.statSync(root + '/images/characters/벨_노말.webp').size;
  const afterNoReval = await sz(target);
  await fetch(base + '__reset');
  await p.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'revalidate' }));
  await p.waitForTimeout(2500);
  const afterReval = await sz(target);
  const stats = await (await fetch(base + '__stats')).json();
  const cond = stats.filter(e => e.url.includes('/images/'));
  console.log(JSON.stringify({ 원래크기: before, 벨크기: bellSize, 바꾼직후_재확인전: afterNoReval, 재확인후: afterReval,
    재확인요청수: cond.length, 응답304: cond.filter(e => e.status === 304).length, 응답200: cond.filter(e => e.status === 200).length, 받은바이트: cond.reduce((a, e) => a + e.bytes * (e.status === 200 ? 1 : 0), 0) }));
  await b.close();
})();
