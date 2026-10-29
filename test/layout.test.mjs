import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let failed = false;
const assert = (c, m) => { if (!c) { failed = true; console.error('FAIL:', m); } else console.log('ok:', m); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

/* ---- sign in once; the session cookie is shared by every page ---- */
{
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fahad', password: 'aafiya' }),
    });
    return res.status;
  });
  assert(status === 200, 'layout suite logs in first (status ' + status + ')');
  await page.close();
}

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  for (const hash of ['#/dashboard', '#/bills', '#/bills/new', '#/customers', '#/vehicles', '#/users', '#/reports', '#/settings', '#/backup']) {
    await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 900));
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth > window.innerWidth + 1;
      const cards = Array.from(document.querySelectorAll('#view .card')).map((c) => c.getBoundingClientRect());
      const zeroCards = cards.filter((b) => b.width < 40 || b.height < 20).length;
      const viewBox = document.querySelector('#view').getBoundingClientRect();
      return { overflowX, scrollW: doc.scrollWidth, winW: window.innerWidth, cards: cards.length, zeroCards, viewRight: Math.round(viewBox.right) };
    });
    assert(!m.overflowX, `${vp.width}px ${hash}: no horizontal overflow (scrollW=${m.scrollW} win=${m.winW})`);
    assert(m.zeroCards === 0, `${vp.width}px ${hash}: all ${m.cards} cards have size (zero=${m.zeroCards})`);
  }
  await page.close();
}

/* ---- editor interaction at 1024px: totals + preview still usable ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 800 });
  await page.goto(BASE + '/#/bills/new', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 900));
  const visible = await page.evaluate(() => {
    const t = document.querySelector('#totalsBox');
    const r = t.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: t.innerText.length };
  });
  assert(visible.w > 200 && visible.h > 100 && visible.text > 50, 'editor totals box renders at 1024px: ' + JSON.stringify(visible).slice(0, 80));
  await page.close();
}

/* ---- A4 print layout of the seeded bill ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123 });
  await page.goto(BASE + '/api/bills/1/html', { waitUntil: 'load', timeout: 20000 });
  await page.emulateMediaType('print');
  await new Promise((r) => setTimeout(r, 400));
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const page = document.querySelector('.page');
    return {
      contentBottom: Math.round(page.getBoundingClientRect().bottom),
      scrollW: d.scrollWidth,
      pageW: Math.round(page.getBoundingClientRect().width),
      sigTop: Math.round(document.querySelector('.signature').getBoundingClientRect().top),
      footBottom: Math.round(document.querySelector('.footer').getBoundingClientRect().bottom),
      rupeeWidth: (() => {
        const s = document.createElement('span');
        s.style.cssText = 'font-family:"Segoe UI";font-size:100px;position:absolute;visibility:hidden';
        s.textContent = '\u20B9';
        document.body.appendChild(s);
        const w = s.getBoundingClientRect().width;
        s.textContent = '';
        const w2 = s.getBoundingClientRect().width;
        s.remove();
        return Math.round(w - w2);
      })(),
    };
  });
  console.log('A4 layout metrics:', JSON.stringify(m));
  // printable height with 12mm margins ~= (297-24)mm = 273mm = ~1032px at 96dpi
  // printable A4 height with 12mm top/bottom margins ~= 273mm = 1032px at 96dpi
  assert(m.contentBottom <= 1032, `bill fits on a single A4 page (content bottom ${m.contentBottom}px <= 1032px)`);
  assert(m.scrollW <= 795, `bill fits A4 width (width ${m.scrollW}px)`);
  assert(m.footBottom <= 1123, `footer within first page (${m.footBottom}px)`);
  assert(m.rupeeWidth > 0, `rupee glyph has width in Segoe UI (${m.rupeeWidth}px difference vs X)`);
  await page.close();
}

/* ---- A4 landscape (horizontal) bill layout ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1123, height: 794 }); // A4 landscape at 96dpi
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill_number: '901', bill_date: '2026-10-16', billing_month: 'October 2026',
        customer_name: 'Layout Test Co', layout: 'landscape',
        items: [{ month: 'October', vehicle_number: 'MH14XX0001', route: 'Test route', rate: 50000, advance: 10000 }],
      }),
    });
    if (!res.ok) return null;
    const b = await res.json();
    return b.id;
  });
  assert(id, 'landscape test bill created');
  if (id) {
    await page.goto(BASE + '/api/bills/' + id + '/html', { waitUntil: 'load', timeout: 20000 });
    await page.emulateMediaType('print');
    await new Promise((r) => setTimeout(r, 400));
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      pageW: Math.round(document.querySelector('.page').getBoundingClientRect().width),
      bottom: Math.round(document.querySelector('.page').getBoundingClientRect().bottom),
    }));
    console.log('A4 landscape metrics:', JSON.stringify(m));
    // A4 landscape: 297mm wide, printable height = 210 - 24 = 186mm = 703px at 96dpi
    assert(m.scrollW <= 1124, `landscape bill fits A4 width (scrollW ${m.scrollW}px <= 1124px)`);
    assert(m.pageW >= 1000, `landscape bill uses full landscape width (${m.pageW}px >= 1000px)`);
    assert(m.bottom <= 703, `landscape bill fits printable height (content bottom ${m.bottom}px <= 703px)`);
    await page.evaluate(async (bid) => { await fetch('/api/bills/' + bid, { method: 'DELETE' }); }, id);
  }
  await page.close();
}

await browser.close();
console.log(failed ? '\nLAYOUT CHECK FAILED' : '\nALL LAYOUT CHECKS PASSED');
process.exit(failed ? 1 : 0);
