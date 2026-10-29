import fs from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let sessionCookie = '';
const J = async (p, o) => {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionCookie) headers.Cookie = sessionCookie;
  const res = await fetch(BASE + p, o ? { ...o, headers: { ...headers, ...(o.headers || {}) }, body: JSON.stringify(o.body) } : { headers });
  const setCookie = res.headers.get('set-cookie') || '';
  const sid = /(?:^|;)\s*sid=([^;]+)/.exec(setCookie);
  if (sid) sessionCookie = 'sid=' + sid[1];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

// 0. authentication: API is locked until you log in
let r = await J('/api/dashboard');
assert(r.status === 401, 'API requires login -> 401, got ' + r.status);

r = await J('/api/auth/login', { method: 'POST', body: { username: 'fahad', password: 'wrong-password' } });
assert(r.status === 401, 'wrong password rejected -> 401, got ' + r.status);

r = await J('/api/auth/login', { method: 'POST', body: { username: 'fahad', password: 'aafiya' } });
assert(r.status === 200 && r.data.user.username === 'fahad', 'default user fahad/aafiya logs in, got ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 120));
assert(sessionCookie.startsWith('sid='), 'login sets a session cookie');

r = await J('/api/auth/me');
assert(r.data && r.data.user && r.data.user.username === 'fahad', 'session identifies current user');
const myId = r.data.user.id;

// 0b. user management: create / rename / password / guards / delete
r = await J('/api/users', { method: 'POST', body: { username: 'operator', password: 'pass1234' } });
assert(r.status === 201 && r.data.username === 'operator', 'create additional user -> 201, got ' + r.status);
const opId = r.data.id;
r = await J('/api/users', { method: 'POST', body: { username: 'OPERATOR', password: 'pass1234' } });
assert(r.status === 409, 'duplicate username rejected -> 409, got ' + r.status);
r = await J('/api/users', { method: 'POST', body: { username: 'xy', password: 'pass1234' } });
assert(r.status === 400, 'username shorter than 3 chars rejected -> 400, got ' + r.status);
r = await J('/api/users', { method: 'POST', body: { username: 'validname', password: 'abc' } });
assert(r.status === 400, 'password shorter than 4 chars rejected -> 400, got ' + r.status);

r = await J('/api/auth/login', { method: 'POST', body: { username: 'operator', password: 'pass1234' } });
assert(r.status === 200, 'newly created user can log in, got ' + r.status);
r = await J('/api/auth/me');
assert(r.data.user.username === 'operator', 'operator session active');
r = await J('/api/auth/login', { method: 'POST', body: { username: 'fahad', password: 'aafiya' } });
assert(r.status === 200, 'switch back to fahad session');

r = await J('/api/users/' + opId, { method: 'PUT', body: { username: 'operator2', password: 'pass5678' } });
assert(r.status === 200 && r.data.username === 'operator2', 'update username + password, got ' + r.status);
r = await J('/api/auth/login', { method: 'POST', body: { username: 'operator2', password: 'pass5678' } });
assert(r.status === 200, 'renamed user logs in with new password, got ' + r.status);
r = await J('/api/auth/login', { method: 'POST', body: { username: 'fahad', password: 'aafiya' } });
assert(r.status === 200, 'back to fahad session again');

r = await J('/api/auth/change-password', { method: 'POST', body: { old_password: 'nope', new_password: 'abcd' } });
assert(r.status === 400, 'change password with wrong current password -> 400, got ' + r.status);
r = await J('/api/auth/change-password', { method: 'POST', body: { old_password: 'aafiya', new_password: 'aafiya2' } });
assert(r.status === 200, 'change own password -> 200, got ' + r.status);
r = await J('/api/auth/login', { method: 'POST', body: { username: 'fahad', password: 'aafiya' } });
assert(r.status === 401, 'old password no longer works -> 401, got ' + r.status);
r = await J('/api/auth/login', { method: 'POST', body: { username: 'fahad', password: 'aafiya2' } });
assert(r.status === 200, 'new password logs in, got ' + r.status);
r = await J('/api/auth/change-password', { method: 'POST', body: { old_password: 'aafiya2', new_password: 'aafiya' } });
assert(r.status === 200, 'password restored to aafiya (later suites need it)');

r = await J('/api/users/' + myId, { method: 'DELETE' });
assert(r.status === 400, 'cannot delete your own account -> 400, got ' + r.status);
r = await J('/api/users/' + opId, { method: 'DELETE' });
assert(r.data && r.data.ok, 'extra user deleted');
r = await J('/api/users');
assert(r.data.length === 1 && r.data[0].username === 'fahad', 'only the default user remains');

// 0c. company default bill format
r = await J('/api/company');
assert(r.data.bill_layout === 'portrait', 'company default bill format is portrait, got ' + r.data.bill_layout);
r = await J('/api/company', { method: 'PUT', body: { bill_layout: 'landscape' } });
assert(r.data.bill_layout === 'landscape', 'company default bill format can be changed');
r = await J('/api/company', { method: 'PUT', body: { bill_layout: 'portrait' } });
assert(r.data.bill_layout === 'portrait', 'company default bill format restored');

// 1. create bill with GST + adjustment (horizontal/landscape format)
const payload = {
  bill_number: '700', bill_date: '2026-10-10', billing_month: 'September 2026',
  customer_id: 1, customer_name: 'RELIABLE LOGISTICS', customer_address: 'Pune',
  layout: 'landscape',
  gst_enabled: true, gst_rate: 18, gst_type: 'intra', adjustments: -100, adjustment_note: 'round off',
  items: [
    { month: 'September', vehicle_number: 'MH14JL5217', route: 'Zomato to Pune', rate: 110000, advance: 20000 },
    { month: 'September', vehicle_number: 'MH14GD9147', route: 'Zomato to Pune', rate: 110000, advance: 0 },
  ],
};
r = await J('/api/bills', { method: 'POST', body: payload });
assert(r.status === 201, 'create bill -> 201, got ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 200));
assert(r.data.layout === 'landscape', 'bill saved with horizontal (landscape) format, got ' + r.data.layout);
const id = r.data.id;
const t = r.data.totals;
// subtotal 220000, adj -100 -> taxable 219900, gst 18% = 39582, total = 259482, advance 20000, outstanding 239482
assert(t.subtotal === 220000, 'subtotal=220000 got ' + t.subtotal);
assert(t.taxable === 219900, 'taxable=219900 got ' + t.taxable);
assert(Math.abs(t.gst_total - 39582) < 0.01, 'gst=39582 got ' + t.gst_total);
assert(Math.abs(t.total - 259482) < 0.01, 'total=259482 got ' + t.total);
assert(Math.abs(t.outstanding - 239482) < 0.01, 'outstanding=239482 got ' + t.outstanding);
assert(r.data.items[0].balance === 90000, 'row balance=90000 got ' + r.data.items[0].balance);

// 2. duplicate bill number rejected
r = await J('/api/bills', { method: 'POST', body: { ...payload, items: payload.items.slice(0, 1) } });
assert(r.status === 409, 'duplicate bill number -> 409, got ' + r.status);

// 3. update bill (including format switch back to portrait), verify audit log
payload.bill_number = '700A';
payload.items[0].rate = 150000;
payload.gst_enabled = false;
payload.layout = 'portrait';
r = await J('/api/bills/' + id, { method: 'PUT', body: payload });
assert(r.status === 200, 'update bill -> 200');
assert(r.data.layout === 'portrait', 'bill format updated to portrait, got ' + r.data.layout);
assert(r.data.totals.subtotal === 260000, 'updated subtotal=260000 got ' + r.data.totals.subtotal);
assert(r.data.items[0].balance === 130000, 'updated balance=130000 got ' + r.data.items[0].balance);

r = await J('/api/bills/' + id + '/audit');
const fields = r.data.map((a) => a.field);
assert(fields.includes('bill_number'), 'audit has bill_number change');
assert(fields.includes('row 1 rate'), 'audit has row 1 rate change');
const rateLog = r.data.find((a) => a.field === 'row 1 rate');
assert(rateLog.old_value === '110000' && rateLog.new_value === '150000', 'audit values 110000 -> 150000, got ' + rateLog.old_value + ' -> ' + rateLog.new_value);

// 4. html print view
r = await J('/api/bills/' + id + '/html');
const html = r.data.toString();
assert(r.status === 200 && html.includes('SPEEDCOLD LOGISTIC'), 'print html contains company name');
assert(html.includes('1,50,000'), 'html shows Indian format 1,50,000');
assert(html.includes('MH14JL5217') && html.includes('Authorized Signature'), 'html has vehicle + signature');
assert(html.includes('size: A4 portrait'), 'portrait bill html prints A4 portrait (vertical)');

// 5. PDF for saved bill
r = await J('/api/bills/' + id + '/pdf');
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'saved bill PDF is a real PDF (' + r.data.length + ' bytes)');
fs.writeFileSync('test/out-bill.pdf', r.data);

// 6. PDF for unsaved draft (preview-pdf) in landscape/horizontal format
payload.layout = 'landscape';
r = await J('/api/bills/preview-pdf', { method: 'POST', body: payload });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'landscape draft PDF ok (' + r.data.length + ' bytes)');

// 7. preview html for unsaved draft
r = await J('/api/bills/preview', { method: 'POST', body: payload });
assert(r.status === 200 && r.data.toString().includes('LOGISTICS BILL'), 'draft preview html ok');
assert(r.data.toString().includes('size: A4 landscape'), 'landscape draft preview prints A4 landscape (horizontal)');

// 8. cancel + restore
r = await J('/api/bills/' + id + '/status', { method: 'POST', body: { status: 'cancelled' } });
assert(r.data.status === 'cancelled', 'bill cancelled');
r = await J('/api/bills?q=700A');
assert(r.data[0].status === 'cancelled', 'search finds cancelled bill');
r = await J('/api/bills/' + id + '/status', { method: 'POST', body: { status: 'active' } });
assert(r.data.status === 'active', 'bill restored');

// 9. search filters
r = await J('/api/bills?q=MH14GD9147');
assert(r.data.some((b) => b.id === id), 'search by vehicle number works');
r = await J('/api/bills?q=RELIABLE');
assert(r.data.length >= 2, 'search by customer works');
r = await J('/api/bills?month=September');
assert(r.data.some((b) => b.id === id), 'search by month works');

// 10. backup export + restore round trip
r = await J('/api/backup/export');
const backup = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
assert(backup.bills.length >= 2 && backup.audit_log.length > 0, 'backup contains bills and audit log');
assert(Array.isArray(backup.users) && backup.users.some((u) => u.username === 'fahad'), 'backup contains users');
r = await J('/api/backup/restore', { method: 'POST', body: backup });
assert(r.status === 200 && r.data.ok, 'restore succeeds: ' + JSON.stringify(r.data));
r = await J('/api/bills');
assert(r.data.some((b) => b.id === id), 'bill survived restore');
r = await J('/api/bills/' + id + '/audit');
assert(r.data.length > 0, 'audit history survived restore');

// 11. customers/vehicles CRUD
r = await J('/api/customers', { method: 'POST', body: { name: 'Test Movers' } });
const cid = r.data.id;
assert(r.status === 201, 'customer created');
r = await J('/api/customers/' + cid, { method: 'PUT', body: { phone: '9999999999' } });
assert(r.data.phone === '9999999999', 'customer updated');
r = await J('/api/customers/' + cid, { method: 'DELETE' });
assert(r.data.ok, 'customer deleted');

r = await J('/api/vehicles', { method: 'POST', body: { number: 'MH99XX9999', default_rate: 5000 } });
const vid = r.data.id;
assert(r.status === 201, 'vehicle created');
r = await J('/api/vehicles/' + vid, { method: 'DELETE' });
assert(r.data.ok, 'vehicle deleted');

// 12. dashboard after everything
r = await J('/api/dashboard');
assert(r.data.bill_count >= 1, 'dashboard counts bills');
assert(r.data.billed > 0, 'dashboard billed > 0');

// cleanup so repeated runs do not leave test bills behind
r = await J('/api/bills/' + id, { method: 'DELETE' });
assert(r.data.ok, 'cleanup: test bill deleted');

console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nALL SMOKE TESTS PASSED');
