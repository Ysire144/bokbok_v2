const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2], out = process.argv[3], waits = JSON.parse(process.argv[4] || '[6000]');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: 'commit' });
  let t = 0;
  for (let i = 0; i < waits.length; i++) {
    await p.waitForTimeout(waits[i] - t); t = waits[i];
    await p.screenshot({ path: out + '_' + waits[i] + '.png' });
    console.log('shot', waits[i], await p.evaluate(() => { const l = document.getElementById('ld-root'); return l ? l.innerText.replace(/\n+/g, ' | ') : 'no overlay'; }));
  }
  await b.close();
})();
