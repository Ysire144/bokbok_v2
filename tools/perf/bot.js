// 자동 플레이 봇: 첫 로딩 시간 + 플레이 중 그림 대기(끊김)를 잰다.
// 사용: NODE_PATH=/opt/node22/lib/node_modules node bot.js http://localhost:8123/ [옵션 JSON]
//  옵션: cpu(느리게 배율, 기본 1) rounds(엔딩까지 몇 판, 기본 10) readMs(탭 간격, 기본 350) seed visits(재방문 횟수) label
const { chromium } = require('playwright');
const base = process.argv[2];
const opt = Object.assign({ cpu: 1, rounds: 10, readMs: 350, seed: 1, visits: 1, label: '', maxMs: 600000, noSkip: false, wait: true, offline2: false, blockSW: false, skip: false }, JSON.parse(process.argv[3] || '{}'));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const INIT = `
(function () {
  var T0 = performance.now();
  window.__ev = [];
  window.__t = function () { return Math.round(performance.now()); };
  function rec(k, v) { window.__ev.push([Math.round(performance.now()), k, v]); }
  var last = {};
  function snap() {
    var tt = document.body && document.body.classList.contains('tt-on');
    var ld = document.getElementById('ld-root');
    var ldv = !!(ld && !ld.hidden);
    var vt = document.querySelector('.vn-text');
    var vl = !!(vt && vt.classList.contains('vn-loading'));
    var en = document.getElementById('en-root');
    var env = !!(en && !en.hidden);
    var ei = document.querySelector('.en-img');
    var eimg = !!(ei && !ei.hidden && ei.getAttribute('src'));
    if (document.querySelector('.vn-ph')) window.__phSeen = (window.__phSeen || 0) + 1;
    var cur = { tt: tt, ld: ldv, vl: vl, en: env, eimg: eimg };
    for (var k in cur) if (last[k] !== cur[k]) { last[k] = cur[k]; rec(k, cur[k] ? 1 : 0); }
  }
  new MutationObserver(snap).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['class', 'hidden', 'src'] });
  setInterval(snap, 50);
})();
`;

(async () => {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: opt.blockSW ? 'block' : 'allow' });
  const out = { label: opt.label, visits: [] };
  for (let v = 0; v < opt.visits; v++) {
    const page = await ctx.newPage();
    await page.addInitScript(INIT);
    const cdp = await ctx.newCDPSession(page);
    if (opt.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.cpu });
    const errs = [], failed = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 160)); });
    page.on('requestfailed', r => failed.push(r.url().slice(-60)));
    const rand = rng(opt.seed + v);
    const res = { visit: v + 1, errs, failed };
    const tNav = Date.now();
    await page.goto(base, { waitUntil: 'commit' });
    if (opt.skip) {
      const tS = Date.now();
      await page.waitForSelector('.ld-skip-soft:not([hidden])', { timeout: 300000 });
      await page.click('.ld-skip-soft');
      res.skipPressedAtMs = Date.now() - tNav;
    }
    // 타이틀 화면이 뜰 때까지 (로딩 화면이 끝나고 시작 가능해지는 시간)
    const tTitle = await page.waitForFunction(() => {
      var b = document.body; if (!b) return false;
      var ld = document.getElementById('ld-root');
      var tt = b.classList.contains('tt-on');
      if (tt && !window.__ttAt) window.__ttAt = performance.now();
      return tt && (performance.now() - window.__ttAt > 1200) && (!ld || ld.hidden);
    }, null, { timeout: 900000, polling: 100 }).then(() => Date.now() - tNav);
    res.msToTitle = tTitle;
    // 로딩 화면이 보인 시간
    const ev0 = await page.evaluate(() => window.__ev);
    let ldOn = null, ldTotal = 0;
    ev0.forEach(([t, k, v]) => { if (k === 'ld') { if (v) ldOn = t; else if (ldOn != null) { ldTotal += t - ldOn; ldOn = null; } } });
    res.loadingScreenMs = ldTotal;

    // 플레이
    const tPlay0 = Date.now();
    const evStart = await page.evaluate(() => window.__ev.length);
    await page.evaluate(() => { window.__playStart = performance.now(); });
    const box = () => page.evaluate(() => {
      const b = document.querySelector('.vn-box'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    let taps = 0, endings = 0, scenes = 0, hubs = 0;
    const seenEnd = new Set();
    async function state() {
      return page.evaluate(() => {
        const q = s => document.querySelector(s);
        const vis = e => !!e && !e.hidden && e.offsetParent !== null;
        const tt = document.body.classList.contains('tt-on');
        const en = q('#en-root'), enBtn = q('.en-btn');
        const chs = q('.vn-choices');
        const chOn = !!(chs && !chs.hidden && chs.querySelectorAll('button.vn-ch').length);
        return {
          tt, vn: document.body.classList.contains('vn-on'),
          en: !!(en && !en.hidden), enDone: !!(en && en.classList.contains('st-btn')),
          chOn, nCh: chOn ? chs.querySelectorAll('button.vn-ch').length : 0,
          gl: !!q('#gl-root') && !q('#gl-root').hidden,
          loading: !!(q('.vn-text') && q('.vn-text').classList.contains('vn-loading')),
          ending: (q('.en-label') || {}).textContent,
          enText: ((q('.en-text') || {}).textContent || '').slice(0, 14)
        };
      });
    }
    async function clickTitle(i) { // 타이틀 버튼 (0: 게임 시작, 2: 갤러리 ... 용의자 선택은 별도)
      const sel = '.tt-btn.tt-b' + i;
      await page.evaluate(s => { const b = document.querySelector(s); b && b.click(); }, sel);
    }
    let guard = 0;
    const tEnd = Date.now() + opt.maxMs;
    // 첫 판은 게임 시작, 이후는 '용의자 선택으로' 버튼
    await clickTitle(0);
    let doneRounds = 0, idle = 0;
    while (doneRounds < opt.rounds && Date.now() < tEnd && guard++ < 6000) {
      const s = await state();
      if (s.tt) {
        // 타이틀로 돌아왔음: 용의자 선택 버튼 (2번 인덱스부터 찾아봄) 시도
        const hub = await page.evaluate(() => {
          const bs = Array.from(document.querySelectorAll('.tt-btn'));
          const i = bs.findIndex(b => /용의자/.test(b.textContent) && !b.classList.contains('tt-off'));
          if (i >= 0) { bs[i].click(); return true; } return false;
        });
        if (!hub) await clickTitle(0);
        await page.waitForTimeout(300);
        continue;
      }
      if (s.en) {
        if (s.enDone) {
          if (!seenEnd.has(s.enText)) seenEnd.add(s.enText);
          endings++; doneRounds++;
          await page.evaluate(() => { const b = document.querySelector('.en-btn'); b && b.click(); });
          await page.waitForTimeout(250);
        } else {
          await page.waitForTimeout(150);
          // 엔딩 애니메이션을 사람처럼 기다리지 않고 눌러서 넘김
          if (rand() < 0.4) await page.evaluate(() => { const r = document.querySelector('#en-root'); r && r.click(); });
        }
        continue;
      }
      if (s.vn && s.chOn) {
        const pick = Math.floor(rand() * s.nCh);
        await page.waitForTimeout(opt.readMs);
        await page.evaluate(i => { const bs = document.querySelectorAll('.vn-choices button.vn-ch'); bs[Math.min(i, bs.length - 1)].click(); }, pick);
        hubs++;
        await page.waitForTimeout(120);
        continue;
      }
      if (s.vn) {
        const b = await box();
        if (b) { await page.touchscreen.tap(b.x, b.y); taps++; }
        await page.waitForTimeout(opt.readMs);
        continue;
      }
      await page.waitForTimeout(100);
    }
    // 이벤트 분석
    const evAll = await page.evaluate(() => window.__ev);
    const playStart = await page.evaluate(() => window.__playStart);
    let vlOn = null, stalls = [], enOn = null, enWaits = [];
    evAll.forEach(([t, k, v]) => {
      if (t < playStart) return;
      if (k === 'vl') { if (v) vlOn = t; else if (vlOn != null) { stalls.push(t - vlOn); vlOn = null; } }
      if (k === 'en') { if (v) enOn = t; }
      if (k === 'eimg' && v && enOn != null) { enWaits.push(t - enOn); enOn = null; }
    });
    res.playMs = Date.now() - tPlay0;
    res.taps = taps; res.endings = endings; res.choices = hubs;
    res.sceneStalls = stalls.length;
    res.stallTotalMs = stalls.reduce((a, b) => a + b, 0);
    res.stallMaxMs = Math.max(0, ...stalls);
    res.stallsOver1s = stalls.filter(x => x > 1000).length;
    res.endingImgWaits = enWaits;
    res.endingImgWaitMax = Math.max(0, ...enWaits);
    res.phSeen = await page.evaluate(() => window.__phSeen || 0);
    res.errors = errs.filter(e => !/Failed to load resource|favicon/.test(e)).slice(0, 5);
    res.failedReq = failed.slice(0, 5);
    const mem = await page.evaluate(() => performance.memory ? { jsHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) } : {});
    res.mem = mem;
    try {
      const ps = require('child_process').execSync("ps -eo rss,args | grep -i 'chrom' | grep -v grep", { encoding: 'utf8' }).split('\n').filter(Boolean);
      let tot = 0, ren = 0;
      ps.forEach(l => { const kb = +l.trim().split(/\s+/)[0]; tot += kb; if (/--type=renderer/.test(l)) ren += kb; });
      res.rssTotalMB = Math.round(tot / 1024); res.rssRendererMB = Math.round(ren / 1024);
      res.renderers = ps.filter(l => /--type=renderer/.test(l)).map(l => Math.round(+l.trim().split(/\s+/)[0] / 1024)).sort((a, b) => b - a);
    } catch (e) {}
    out.visits.push(res);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error('BOT FAIL', e); process.exit(1); });
