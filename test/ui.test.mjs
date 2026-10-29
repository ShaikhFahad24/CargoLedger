import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let failed = false;
const assert = (c, m) => { if (!c) { failed = true; console.error('FAIL:', m); } else console.log('ok:', m); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // the login flow intentionally produces 401s: probing the session before login,
  // and the deliberately wrong password. Everything else must stay clean.
  if (/status of 401 \(Unauthorized\)/.test(m.text())) return;
  errors.push('console: ' + m.text());
});
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));

const go = async (hash) => {
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));
};

/* ---- login (default user fahad / aafiya) ---- */
await go('#/dashboard');
assert(await page.$eval('#loginScreen', (el) => !el.hidden), 'unauthenticated visit shows the login screen');
assert(!(await page.$('#view .stat')), 'app content is not loaded before login');
await page.type('#loginUser', 'fahad');
await page.type('#loginPass', 'definitely-wrong');
await page.click('#loginBtn');
await new Promise((r) => setTimeout(r, 800));
const loginErr = await page.$eval('#loginErr', (e) => e.textContent);
assert(loginErr.length > 0, 'wrong password shows an error message: ' + JSON.stringify(loginErr));
await page.$eval('#loginPass', (i) => { i.value = ''; });
await page.type('#loginPass', 'aafiya');
await page.click('#loginBtn');
await new Promise((r) => setTimeout(r, 1400));
assert(await page.$eval('#loginScreen', (el) => el.hidden), 'login screen hidden after successful login');
const who = await page.$eval('#whoAmI', (e) => e.textContent);
assert(who === 'fahad', 'topbar shows signed-in username, got ' + JSON.stringify(who));

/* ---- dashboard ---- */
await go('#/dashboard');
assert(await page.$('.stat'), 'dashboard stats rendered');
const statText = await page.$eval('#view', (v) => v.innerText);
assert(statText.toLowerCase().includes('total billed'), 'dashboard shows Total billed');
assert(statText.includes('\u20B93,30,000') || statText.includes('3,30,000'), 'dashboard shows seeded 3,30,000 total');
assert(statText.includes('RELIABLE LOGISTICS'), 'dashboard recent bill lists customer');
await page.screenshot({ path: 'test/out-dashboard.png', fullPage: true });

/* ---- bills list ---- */
await go('#/bills');
let body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('#646'), 'bills list shows seeded bill 646');
await page.type('#fq', 'MH14GD9147');
await new Promise((r) => setTimeout(r, 700));
body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('#646'), 'search by vehicle number filters correctly');
await page.click('#fq', { clickCount: 3 });
await page.keyboard.press('Backspace');
await new Promise((r) => setTimeout(r, 700));

/* ---- create a bill through the UI ---- */
await go('#/bills/new');
assert(await page.$('#itemsBody tr'), 'editor rendered item rows');
const nextNo = await page.$eval('#f_bill_number', (i) => i.value);
assert(nextNo === '647', 'auto bill number is 647, got ' + nextNo);

await page.type('#f_billing_month', 'October 2026');
await page.select('#f_customer', '1');
// row 1: type vehicle number -> default rate auto-fills
const rows = await page.$$('#itemsBody tr');
await rows[0].$eval('[data-f="vehicle_number"]', (i) => i.focus());
await page.keyboard.type('MH14JL5217');
await rows[0].$eval('[data-f="rate"]', (i) => i.blur());
await new Promise((r) => setTimeout(r, 200));
let rate = await rows[0].$eval('[data-f="rate"]', (i) => i.value);
assert(rate === '110000', 'default rate auto-filled from saved vehicle, got ' + rate);

await rows[0].$eval('[data-f="route"]', (i) => i.focus());
await page.keyboard.type('Zomato to Pune');
// advance on row 1
await rows[0].$eval('[data-f="advance"]', (i) => i.focus());
await page.keyboard.type('10000');
await new Promise((r) => setTimeout(r, 300));

// add a second row manually
await page.click('#btnAddVehicle');
await new Promise((r) => setTimeout(r, 200));
const rows2 = await page.$$('#itemsBody tr');
assert(rows2.length === 2, 'add row creates second entry');
await rows2[1].$eval('[data-f="vehicle_number"]', (i) => i.focus());
await page.keyboard.type('MH14GD9147');
await rows2[1].$eval('[data-f="rate"]', (i) => { i.focus(); i.select(); });
await page.keyboard.type('50000');

// enable GST 18%
await page.click('#f_gst_enabled');
await new Promise((r) => setTimeout(r, 1600));

const totals = await page.$eval('#totalsBox', (b) => b.innerText);
console.log('--- totals shown ---\n' + totals + '\n---------------------');
assert(totals.includes('\u20B91,60,000'), 'subtotal 1,60,000 shown');
assert(totals.includes('\u20B910,000'), 'advance 10,000 shown');
// taxable 160000, gst 18% = 28800, total = 188800, due = 178800
assert(totals.includes('\u20B91,88,800'), 'total with GST 1,88,800 shown');
assert(totals.includes('\u20B91,78,800'), 'balance due 1,78,800 shown');

const preview = await page.$eval('#livePreview', (f) => f.srcdoc || '');
assert(preview.includes('SPEEDCOLD LOGISTIC'), 'live preview iframe rendered bill');

await page.screenshot({ path: 'test/out-editor.png', fullPage: true });

/* ---- save ---- */
await Promise.all([
  page.waitForFunction(() => location.hash.startsWith('#/bills/') && !location.hash.endsWith('/new'), { timeout: 10000 }),
  page.click('#btnSave'),
]);
const savedHash = await page.evaluate(() => location.hash);
assert(savedHash === '#/bills/2', 'saved bill navigates to detail, got ' + savedHash);
await new Promise((r) => setTimeout(r, 900));
body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('Change history'), 'detail page shows change history section');
assert(body.includes('created'), 'audit shows creation entry');
const previewFrame = await page.$('#preview');
assert(previewFrame, 'saved bill preview iframe present');
await page.screenshot({ path: 'test/out-bill-detail.png', fullPage: true });

/* ---- cancel flow from UI ---- */
page.on('dialog', async (d) => await d.accept());
await page.click('#btnCancelBill');
await new Promise((r) => setTimeout(r, 1200));
body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('CANCELLED'), 'bill marked cancelled from UI');
await page.click('#btnRestore');
await new Promise((r) => setTimeout(r, 1200));
body = await page.$eval('#view', (v) => v.innerText);
assert(!body.includes('CANCELLED'), 'bill restored from UI');

/* ---- deep link from customers ---- */
await go('#/customers');
const custLinks = await page.$$('#custRows a[href^="#/bills?q="]');
assert(custLinks.length === 1, 'customer bills deep link exists');
await custLinks[0].click();
await new Promise((r) => setTimeout(r, 900));
const fqVal = await page.$eval('#fq', (i) => i.value);
assert(fqVal === 'RELIABLE LOGISTICS', 'bills page prefills search from deep link, got ' + JSON.stringify(fqVal));
body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('#646') && body.includes('#647'), 'deep link search shows matching bills');

/* ---- other pages ---- */
for (const [hash, marker] of [
  ['#/customers', 'Add customer'],
  ['#/vehicles', 'Add vehicle'],
  ['#/users', 'Add user'],
  ['#/reports', 'Monthly billing'],
  ['#/settings', 'Company profile'],
  ['#/backup', 'Export backup'],
]) {
  await go(hash);
  body = await page.$eval('#view', (v) => v.innerText);
  assert(body.includes(marker), `${hash} renders (${marker})`);
}
await page.screenshot({ path: 'test/out-reports.png', fullPage: true });

/* ---- user management from the UI ---- */
await go('#/users');
await page.click('#addUser');
await new Promise((r) => setTimeout(r, 400));
await page.type('#u_name', 'testdriver');
await page.type('#u_pass', 'secret12');
await page.type('#u_pass2', 'secret12');
await page.click('#saveUser');
await new Promise((r) => setTimeout(r, 900));
body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('testdriver'), 'user created and listed from UI');

await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-edit]'))
    .find((b) => b.closest('tr').innerText.includes('testdriver'));
  btn.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.$eval('#u_name', (i) => { i.value = ''; });
await page.type('#u_name', 'testdriver2');
await page.type('#u_pass', 'secret12');
await page.type('#u_pass2', 'secret12');
await page.click('#saveUser');
await new Promise((r) => setTimeout(r, 900));
body = await page.$eval('#view', (v) => v.innerText);
assert(body.includes('testdriver2'), 'user renamed from UI');

await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-del]'))
    .find((b) => b.closest('tr').innerText.includes('testdriver2'));
  btn.click();
});
await new Promise((r) => setTimeout(r, 1000));
body = await page.$eval('#view', (v) => v.innerText);
assert(!body.includes('testdriver2'), 'user deleted from UI');
assert(body.includes('fahad'), 'default user still listed');

// settings: company form prefilled with SPEEDCOLD details
await go('#/settings');
const name = await page.$eval('#s_name', (i) => i.value);
const acct = await page.$eval('#s_acct', (i) => i.value);
const ifsc = await page.$eval('#s_ifsc', (i) => i.value);
assert(name === 'SPEEDCOLD LOGISTIC', 'settings prefilled company name: ' + name);
assert(acct === '651602010011047' && ifsc === 'UBIN0565164', 'settings prefilled bank details');
await new Promise((r) => setTimeout(r, 900));
const sp = await page.$eval('#settingsPreview', (f) => f.srcdoc || '');
assert(sp.includes('Union Bank of India'), 'settings preview uses saved bank details');

assert(errors.length === 0, 'no browser console/page errors' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

await browser.close();
console.log(failed ? '\nUI TEST FAILED' : '\nALL UI TESTS PASSED');
process.exit(failed ? 1 : 0);
