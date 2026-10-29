'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const puppeteer = require('puppeteer-core');

const {
  db, now, computeItem, computeTotals, getBill, logAudit,
  hashPassword, verifyPassword, createSession, getSession, deleteSession,
} = require('./db');
const { billHtml } = require('./billTemplate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const getCompany = () => db.prepare('SELECT * FROM company WHERE id = 1').get();

/* ------------------------------ authentication ------------------------------ */
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 3600;

const readToken = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const m = /(?:^|;\s*)sid=([^;\s]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
};

const setSidCookie = (res, token) =>
  res.setHeader(
    'Set-Cookie',
    `sid=${encodeURIComponent(token || '')}; HttpOnly; Path=/; Max-Age=${token ? SESSION_COOKIE_MAX_AGE : 0}; SameSite=Strict`
  );

// every /api route requires a valid session except the login endpoint
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') return next();
  const sess = getSession(readToken(req));
  if (!sess) return res.status(401).json({ error: 'Please log in to continue' });
  req.user = sess.user;
  req.sessionToken = sess.token;
  next();
});

app.post('/api/auth/login', (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter username and password' });
  const u = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (!u || !u.active || !verifyPassword(password, u.salt, u.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const token = createSession(u.id);
  setSidCookie(res, token);
  res.json({ ok: true, token, user: { id: u.id, username: u.username } });
});

app.post('/api/auth/logout', (req, res) => {
  deleteSession(req.sessionToken);
  setSidCookie(res, '');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

app.post('/api/auth/change-password', (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(String(b.old_password || ''), u.salt, u.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const next = String(b.new_password || '');
  if (next.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  const { salt, hash } = hashPassword(next);
  db.prepare('UPDATE users SET password_hash=?, salt=?, updated_at=? WHERE id=?').run(hash, salt, now(), u.id);
  logAudit({ entity: 'user', label: u.username, field: 'password', oldValue: '********', newValue: 'changed' });
  res.json({ ok: true });
});

/* --------------------------------- users --------------------------------- */
const userRow = (id) => db.prepare('SELECT id, username, active, created_at, updated_at FROM users WHERE id = ?').get(id);
const countOtherActive = (id) =>
  db.prepare('SELECT COUNT(*) AS c FROM users WHERE active = 1 AND id != ?').get(id).c;

app.get('/api/users', (req, res) => {
  res.json(db.prepare('SELECT id, username, active, created_at, updated_at FROM users ORDER BY username').all());
});

app.post('/api/users', (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)) {
    return res.status(409).json({ error: `Username "${username}" already exists` });
  }
  const { salt, hash } = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, salt, active) VALUES (?,?,?,1)')
    .run(username, hash, salt);
  logAudit({ entity: 'user', label: username, field: 'record', oldValue: '', newValue: 'created' });
  res.status(201).json(userRow(info.lastInsertRowid));
});

app.put('/api/users/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'User not found' });
  const b = req.body || {};
  const username = b.username !== undefined ? String(b.username).trim() : prev.username;
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  const dup = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(username, prev.id);
  if (dup) return res.status(409).json({ error: `Username "${username}" already exists` });

  let password_hash = prev.password_hash;
  let salt = prev.salt;
  if (b.password !== undefined && b.password !== '') {
    if (String(b.password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const hashed = hashPassword(String(b.password));
    password_hash = hashed.hash;
    salt = hashed.salt;
  }
  const active = b.active !== undefined ? (b.active ? 1 : 0) : prev.active;
  if (prev.active && !active) {
    if (prev.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account' });
    if (countOtherActive(prev.id) === 0) return res.status(400).json({ error: 'At least one active user must remain' });
  }

  db.prepare('UPDATE users SET username=?, password_hash=?, salt=?, active=?, updated_at=? WHERE id=?')
    .run(username, password_hash, salt, active, now(), prev.id);
  if (prev.username !== username) logAudit({ entity: 'user', label: username, field: 'username', oldValue: prev.username, newValue: username });
  if (password_hash !== prev.password_hash) logAudit({ entity: 'user', label: username, field: 'password', oldValue: '********', newValue: 'changed' });
  if (prev.active !== active) logAudit({ entity: 'user', label: username, field: 'active', oldValue: prev.active, newValue: active });
  res.json(userRow(prev.id));
});

app.delete('/api/users/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'User not found' });
  if (prev.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (prev.active && countOtherActive(prev.id) === 0) {
    return res.status(400).json({ error: 'At least one active user must remain' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(prev.id);
  logAudit({ entity: 'user', label: prev.username, field: 'record', oldValue: 'existing', newValue: 'deleted' });
  res.json({ ok: true });
});

/* ------------------------------- dashboard ------------------------------- */
app.get('/api/dashboard', (req, res) => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS bill_count,
              COALESCE(SUM((SELECT COALESCE(SUM(rate),0) FROM bill_items i WHERE i.bill_id = b.id)),0) AS billed,
              COALESCE(SUM((SELECT COALESCE(SUM(advance),0) FROM bill_items i WHERE i.bill_id = b.id)),0) AS received
       FROM bills b WHERE b.status != 'cancelled'`
    )
    .get();
  const active = db.prepare("SELECT COUNT(*) AS c FROM bills WHERE status != 'cancelled'").get().c;
  const cancelled = db.prepare("SELECT COUNT(*) AS c FROM bills WHERE status = 'cancelled'").get().c;
  const customers = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  const vehicles = db.prepare('SELECT COUNT(*) AS c FROM vehicles').get().c;

  const monthly = db
    .prepare(
      `SELECT substr(bill_date,1,7) AS ym, COUNT(*) AS bills,
              COALESCE(SUM((SELECT COALESCE(SUM(rate),0) FROM bill_items i WHERE i.bill_id = b.id)),0) AS amount
       FROM bills b WHERE status != 'cancelled' GROUP BY ym ORDER BY ym DESC LIMIT 8`
    )
    .all();

  const recent = db
    .prepare(
      `SELECT id, bill_number, bill_date, customer_name, status,
              (SELECT COALESCE(SUM(rate),0) FROM bill_items i WHERE i.bill_id = b.id) AS total
       FROM bills b ORDER BY updated_at DESC, id DESC LIMIT 6`
    )
    .all();

  const dues = db
    .prepare(
      `SELECT id, bill_number, bill_date, customer_name,
              (SELECT COALESCE(SUM(rate - advance),0) FROM bill_items i WHERE i.bill_id = b.id) AS due
       FROM bills b WHERE status != 'cancelled'
         AND (SELECT COALESCE(SUM(rate - advance),0) FROM bill_items i WHERE i.bill_id = b.id) > 0
       ORDER BY bill_date DESC LIMIT 6`
    )
    .all();

  res.json({
    bill_count: totals.bill_count,
    active,
    cancelled,
    customers,
    vehicles,
    billed: totals.billed,
    received: totals.received,
    outstanding: totals.billed - totals.received,
    monthly,
    recent,
    dues,
  });
});

/* -------------------------------- company -------------------------------- */
app.get('/api/company', (req, res) => res.json(getCompany() || {}));

app.put('/api/company', (req, res) => {
  const b = req.body || {};
  const cur = getCompany() || {};
  const fields = ['name','address','phone','email','gstin','bank_name','account_no','ifsc','logo','footer_note','bill_layout'];
  const next = {};
  for (const f of fields) next[f] = b[f] !== undefined ? b[f] : (cur[f] || '');
  if (!String(next.name).trim()) return res.status(400).json({ error: 'Company name is required' });
  if (!['portrait', 'landscape'].includes(next.bill_layout)) next.bill_layout = 'portrait';
  db.prepare(
    `UPDATE company SET name=?, address=?, phone=?, email=?, gstin=?, bank_name=?, account_no=?, ifsc=?, logo=?, footer_note=?, bill_layout=?, updated_at=? WHERE id=1`
  ).run(next.name, next.address, next.phone, next.email, next.gstin, next.bank_name, next.account_no, next.ifsc, next.logo, next.footer_note, next.bill_layout, now());
  logAudit({ entity: 'company', label: next.name, field: 'profile', oldValue: 'previous settings', newValue: 'updated settings' });
  res.json(getCompany());
});

/* ------------------------------- customers ------------------------------- */
app.get('/api/customers', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare('SELECT * FROM customers WHERE name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR gstin LIKE ? ORDER BY name')
        .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM customers ORDER BY name').all();
  res.json(rows);
});

app.get('/api/customers/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found' });
  res.json(row);
});

app.post('/api/customers', (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Customer name is required' });
  const info = db
    .prepare('INSERT INTO customers (name, address, contact_person, phone, email, gstin, notes) VALUES (?,?,?,?,?,?,?)')
    .run(b.name, b.address || '', b.contact_person || '', b.phone || '', b.email || '', b.gstin || '', b.notes || '');
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/customers/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Customer not found' });
  const b = req.body || {};
  const name = b.name !== undefined ? b.name : prev.name;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Customer name is required' });
  const merged = {
    name, address: b.address ?? prev.address, contact_person: b.contact_person ?? prev.contact_person,
    phone: b.phone ?? prev.phone, email: b.email ?? prev.email, gstin: b.gstin ?? prev.gstin, notes: b.notes ?? prev.notes,
  };
  db.prepare('UPDATE customers SET name=?, address=?, contact_person=?, phone=?, email=?, gstin=?, notes=? WHERE id=?')
    .run(merged.name, merged.address, merged.contact_person, merged.phone, merged.email, merged.gstin, merged.notes, req.params.id);
  for (const f of Object.keys(merged)) logAudit({ entity: 'customer', label: merged.name, field: f, oldValue: prev[f], newValue: merged[f] });
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

app.delete('/api/customers/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Customer not found' });
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  logAudit({ entity: 'customer', label: prev.name, field: 'record', oldValue: 'existing', newValue: 'deleted' });
  res.json({ ok: true });
});

/* -------------------------------- vehicles -------------------------------- */
app.get('/api/vehicles', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare('SELECT * FROM vehicles WHERE number LIKE ? OR vehicle_type LIKE ? OR driver LIKE ? ORDER BY number')
        .all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM vehicles ORDER BY number').all();
  res.json(rows);
});

app.post('/api/vehicles', (req, res) => {
  const b = req.body || {};
  if (!String(b.number || '').trim()) return res.status(400).json({ error: 'Vehicle number is required' });
  const info = db
    .prepare('INSERT INTO vehicles (number, vehicle_type, driver, default_rate, notes) VALUES (?,?,?,?,?)')
    .run(b.number, b.vehicle_type || '', b.driver || '', Number(b.default_rate) || 0, b.notes || '');
  res.status(201).json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/vehicles/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Vehicle not found' });
  const b = req.body || {};
  const merged = {
    number: b.number ?? prev.number, vehicle_type: b.vehicle_type ?? prev.vehicle_type,
    driver: b.driver ?? prev.driver, default_rate: b.default_rate ?? prev.default_rate, notes: b.notes ?? prev.notes,
  };
  if (!String(merged.number || '').trim()) return res.status(400).json({ error: 'Vehicle number is required' });
  db.prepare('UPDATE vehicles SET number=?, vehicle_type=?, driver=?, default_rate=?, notes=? WHERE id=?')
    .run(merged.number, merged.vehicle_type, merged.driver, Number(merged.default_rate) || 0, merged.notes, req.params.id);
  for (const f of Object.keys(merged)) logAudit({ entity: 'vehicle', label: merged.number, field: f, oldValue: prev[f], newValue: merged[f] });
  res.json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id));
});

app.delete('/api/vehicles/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Vehicle not found' });
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  logAudit({ entity: 'vehicle', label: prev.number, field: 'record', oldValue: 'existing', newValue: 'deleted' });
  res.json({ ok: true });
});

/* --------------------------------- bills --------------------------------- */
function parseBillPayload(b, existing, opts = {}) {
  const src = existing || {};
  const bill = {
    bill_number: String(b.bill_number ?? src.bill_number ?? '').trim(),
    bill_date: b.bill_date ?? src.bill_date ?? new Date().toISOString().slice(0, 10),
    billing_month: b.billing_month ?? src.billing_month ?? '',
    customer_id: b.customer_id !== undefined ? b.customer_id : (src.customer_id ?? null),
    customer_name: b.customer_name ?? src.customer_name ?? '',
    customer_address: b.customer_address ?? src.customer_address ?? '',
    customer_gstin: b.customer_gstin ?? src.customer_gstin ?? '',
    status: b.status ?? src.status ?? 'active',
    layout: ['portrait', 'landscape'].includes(b.layout)
      ? b.layout
      : (['portrait', 'landscape'].includes(src.layout) ? src.layout : 'portrait'),
    gst_enabled: b.gst_enabled !== undefined ? (b.gst_enabled ? 1 : 0) : (src.gst_enabled || 0),
    gst_rate: Number(b.gst_rate ?? src.gst_rate ?? 0) || 0,
    gst_type: b.gst_type ?? src.gst_type ?? 'intra',
    adjustments: Number(b.adjustments ?? src.adjustments ?? 0) || 0,
    adjustment_note: b.adjustment_note ?? src.adjustment_note ?? '',
    notes: b.notes ?? src.notes ?? '',
  };
  const rawItems = Array.isArray(b.items) ? b.items : (src.items || []);
  const items = rawItems.map((it, i) => {
    const base = { rate: 0, advance: 0 };
    const o = { ...base, ...it };
    const calc = computeItem(o);
    return {
      sr: i + 1,
      month: String(o.month ?? '').trim(),
      vehicle_number: String(o.vehicle_number ?? '').trim(),
      route: String(o.route ?? '').trim(),
      rate: calc.rate,
      advance: calc.advance,
      balance: calc.balance,
    };
  });
  if (!bill.bill_number && !opts.allowEmpty) return { error: 'Bill number is required' };
  if (!items.length && !opts.allowEmpty) return { error: 'Add at least one vehicle entry' };
  return { bill, items };
}

app.get('/api/bills/next-number', (req, res) => {
  const row = db.prepare(`SELECT bill_number FROM bills ORDER BY CAST(bill_number AS INTEGER) DESC LIMIT 1`).get();
  const n = row ? parseInt(row.bill_number, 10) : 0;
  res.json({ bill_number: String((Number.isFinite(n) ? n : 0) + 1) });
});

app.get('/api/bills', (req, res) => {
  const { q = '', status = '', from = '', to = '', month = '' } = req.query;
  const clauses = [];
  const params = [];
  if (status) { clauses.push('b.status = ?'); params.push(status); }
  if (from) { clauses.push('b.bill_date >= ?'); params.push(from); }
  if (to) { clauses.push('b.bill_date <= ?'); params.push(to); }
  if (month) { clauses.push('(b.billing_month LIKE ? OR EXISTS (SELECT 1 FROM bill_items i WHERE i.bill_id = b.id AND i.month LIKE ?))'); params.push(`%${month}%`, `%${month}%`); }
  if (q) {
    clauses.push(`(b.bill_number LIKE ? OR b.customer_name LIKE ? OR b.billing_month LIKE ? OR b.bill_date LIKE ?
      OR EXISTS (SELECT 1 FROM bill_items i WHERE i.bill_id = b.id AND (i.vehicle_number LIKE ? OR i.route LIKE ?)))`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT b.id, b.bill_number, b.bill_date, b.billing_month, b.customer_id, b.customer_name, b.status,
              b.gst_enabled, b.adjustments, b.gst_rate, b.gst_type,
              (SELECT COALESCE(SUM(rate),0) FROM bill_items i WHERE i.bill_id = b.id) AS subtotal,
              (SELECT COALESCE(SUM(advance),0) FROM bill_items i WHERE i.bill_id = b.id) AS total_advance,
              (SELECT COUNT(*) FROM bill_items i WHERE i.bill_id = b.id) AS item_count,
              b.updated_at
       FROM bills b ${where} ORDER BY b.bill_date DESC, b.id DESC`
    )
    .all(...params);
  const company = getCompany();
  rows.forEach((r) => {
    const stub = { gst_enabled: r.gst_enabled, adjustments: r.adjustments, gst_rate: r.gst_rate, gst_type: r.gst_type };
    const items = db.prepare('SELECT rate, advance FROM bill_items WHERE bill_id = ?').all(r.id);
    const full = computeTotals(items, stub);
    r.total = full.total;
    r.outstanding = full.outstanding;
  });
  res.json(rows);
});

app.get('/api/bills/:id', (req, res) => {
  const bill = getBill(req.params.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  res.json(bill);
});

app.post('/api/bills', (req, res) => {
  const parsed = parseBillPayload(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { bill, items } = parsed;
  const dup = db.prepare('SELECT id FROM bills WHERE bill_number = ?').get(bill.bill_number);
  if (dup) return res.status(409).json({ error: `Bill number ${bill.bill_number} already exists` });

  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO bills (bill_number, bill_date, billing_month, customer_id, customer_name, customer_address, customer_gstin,
                            status, layout, gst_enabled, gst_rate, gst_type, adjustments, adjustment_note, notes, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(bill.bill_number, bill.bill_date, bill.billing_month, bill.customer_id, bill.customer_name, bill.customer_address,
        bill.customer_gstin, bill.status, bill.layout, bill.gst_enabled, bill.gst_rate, bill.gst_type, bill.adjustments,
        bill.adjustment_note, bill.notes, now());
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare(
      'INSERT INTO bill_items (bill_id, sr, month, vehicle_number, route, rate, advance, balance) VALUES (?,?,?,?,?,?,?,?)'
    );
    items.forEach((it) => ins.run(id, it.sr, it.month, it.vehicle_number, it.route, it.rate, it.advance, it.balance));
    logAudit({ billId: id, entity: 'bill', label: `Bill ${bill.bill_number}`, field: 'created', oldValue: '', newValue: 'created' });
    db.exec('COMMIT');
    res.status(201).json(getBill(id));
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/bills/:id', (req, res) => {
  const prev = getBill(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Bill not found' });
  const parsed = parseBillPayload(req.body || {}, prev);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { bill, items } = parsed;
  const dup = db.prepare('SELECT id FROM bills WHERE bill_number = ? AND id != ?').get(bill.bill_number, prev.id);
  if (dup) return res.status(409).json({ error: `Bill number ${bill.bill_number} already exists` });

  const label = `Bill ${bill.bill_number}`;
  const headerFields = ['bill_number','bill_date','billing_month','customer_name','customer_address','customer_gstin','layout','gst_enabled','gst_rate','gst_type','adjustments','adjustment_note','notes','status'];

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE bills SET bill_number=?, bill_date=?, billing_month=?, customer_id=?, customer_name=?, customer_address=?, customer_gstin=?,
                        status=?, layout=?, gst_enabled=?, gst_rate=?, gst_type=?, adjustments=?, adjustment_note=?, notes=?, updated_at=? WHERE id=?`
    ).run(bill.bill_number, bill.bill_date, bill.billing_month, bill.customer_id, bill.customer_name, bill.customer_address,
      bill.customer_gstin, bill.status, bill.layout, bill.gst_enabled, bill.gst_rate, bill.gst_type, bill.adjustments,
      bill.adjustment_note, bill.notes, now(), prev.id);

    for (const f of headerFields) {
      const before = prev[f] === undefined ? '' : prev[f];
      const after = bill[f] === undefined ? '' : bill[f];
      logAudit({ billId: prev.id, entity: 'bill', label, field: f, oldValue: before, newValue: after });
    }

    const prevItems = prev.items;
    const max = Math.max(prevItems.length, items.length);
    for (let i = 0; i < max; i++) {
      const p = prevItems[i];
      const n = items[i];
      if (p && n) {
        for (const f of ['month','vehicle_number','route','rate','advance','balance']) {
          logAudit({ billId: prev.id, entity: 'bill_item', label, field: `row ${i + 1} ${f}`, oldValue: p[f], newValue: n[f] });
        }
      } else if (p && !n) {
        logAudit({ billId: prev.id, entity: 'bill_item', label, field: `row ${i + 1}`, oldValue: `${p.vehicle_number} / ${p.route} / ${p.rate}`, newValue: 'removed' });
      } else if (!p && n) {
        logAudit({ billId: prev.id, entity: 'bill_item', label, field: `row ${i + 1}`, oldValue: 'none', newValue: `${n.vehicle_number} / ${n.route} / ${n.rate}` });
      }
    }

    db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(prev.id);
    const ins = db.prepare(
      'INSERT INTO bill_items (bill_id, sr, month, vehicle_number, route, rate, advance, balance) VALUES (?,?,?,?,?,?,?,?)'
    );
    items.forEach((it) => ins.run(prev.id, it.sr, it.month, it.vehicle_number, it.route, it.rate, it.advance, it.balance));
    db.exec('COMMIT');
    res.json(getBill(prev.id));
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bills/:id/status', (req, res) => {
  const prev = getBill(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Bill not found' });
  const status = req.body && req.body.status;
  if (!['active', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE bills SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), prev.id);
  logAudit({ billId: prev.id, entity: 'bill', label: `Bill ${prev.bill_number}`, field: 'status', oldValue: prev.status, newValue: status });
  res.json(getBill(prev.id));
});

app.delete('/api/bills/:id', (req, res) => {
  const prev = getBill(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Bill not found' });
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(prev.id);
    db.prepare('DELETE FROM bills WHERE id = ?').run(prev.id);
    logAudit({ billId: null, entity: 'bill', label: `Bill ${prev.bill_number}`, field: 'record', oldValue: 'existing', newValue: 'deleted' });
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/bills/:id/audit', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE bill_id = ? ORDER BY id DESC')
    .all(req.params.id);
  res.json(rows);
});

/* --------------------------- print / PDF output --------------------------- */
app.post('/api/bills/preview', (req, res) => {
  const parsed = parseBillPayload(req.body || {}, null, { allowEmpty: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { bill, items } = parsed;
  const draft = { ...bill, id: null, items };
  draft.totals = computeTotals(items, bill);
  res.type('html').send(billHtml(getCompany(), draft));
});

app.get('/api/bills/:id/html', (req, res) => {
  const bill = getBill(req.params.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  res.type('html').send(billHtml(getCompany(), bill));
});

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null;

async function renderPdf(html, opts = {}) {
  if (!chromePath) throw new Error('Chrome not found - set CHROME_PATH environment variable');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: !!opts.landscape,
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

app.get('/api/bills/:id/pdf', async (req, res) => {
  try {
    const bill = getBill(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const pdf = await renderPdf(billHtml(getCompany(), bill), { landscape: bill.layout === 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Bill-${String(bill.bill_number).replace(/[^\w-]/g, '_')}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (e) {
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

app.post('/api/bills/preview-pdf', async (req, res) => {
  try {
    const parsed = parseBillPayload(req.body || {}, null, { allowEmpty: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { bill, items } = parsed;
    const draft = { ...bill, items, totals: computeTotals(items, bill) };
    const pdf = await renderPdf(billHtml(getCompany(), draft), { landscape: draft.layout === 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Bill-${String(bill.bill_number).replace(/[^\w-]/g, '_')}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (e) {
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

/* -------------------------------- reports -------------------------------- */
app.get('/api/reports', (req, res) => {
  const year = String(req.query.year || '');
  const yClause = year ? 'AND b.bill_date LIKE ?' : '';
  const yParams = year ? [`${year}%`] : [];

  const monthly = db.prepare(
    `SELECT substr(b.bill_date,1,7) AS ym,
            COUNT(DISTINCT b.id) AS bills,
            COUNT(i.id) AS entries,
            COALESCE(SUM(i.rate),0) AS billed,
            COALESCE(SUM(i.advance),0) AS advance,
            COALESCE(SUM(i.rate - i.advance),0) AS outstanding
     FROM bills b JOIN bill_items i ON i.bill_id = b.id
     WHERE b.status != 'cancelled' ${yClause}
     GROUP BY ym ORDER BY ym DESC`
  ).all(...yParams);

  const customers = db.prepare(
    `SELECT b.customer_name AS name,
            COUNT(DISTINCT b.id) AS bills,
            COUNT(i.id) AS entries,
            COALESCE(SUM(i.rate),0) AS billed,
            COALESCE(SUM(i.advance),0) AS advance,
            COALESCE(SUM(i.rate - i.advance),0) AS outstanding
     FROM bills b JOIN bill_items i ON i.bill_id = b.id
     WHERE b.status != 'cancelled' ${yClause}
     GROUP BY b.customer_name ORDER BY billed DESC`
  ).all(...yParams);

  const vehicles = db.prepare(
    `SELECT i.vehicle_number AS number,
            COUNT(DISTINCT b.id) AS bills,
            COUNT(i.id) AS trips,
            COALESCE(SUM(i.rate),0) AS billed,
            COALESCE(SUM(i.advance),0) AS advance,
            COALESCE(SUM(i.rate - i.advance),0) AS outstanding
     FROM bills b JOIN bill_items i ON i.bill_id = b.id
     WHERE b.status != 'cancelled' ${yClause}
     GROUP BY i.vehicle_number ORDER BY billed DESC`
  ).all(...yParams);

  const outstanding = db.prepare(
    `SELECT b.id, b.bill_number, b.bill_date, b.customer_name,
            COALESCE(SUM(i.rate),0) AS billed,
            COALESCE(SUM(i.advance),0) AS advance,
            COALESCE(SUM(i.rate - i.advance),0) AS due
     FROM bills b JOIN bill_items i ON i.bill_id = b.id
     WHERE b.status != 'cancelled' ${yClause}
     GROUP BY b.id HAVING due > 0 ORDER BY b.bill_date DESC`
  ).all(...yParams);

  const years = db
    .prepare(`SELECT DISTINCT substr(bill_date,1,4) AS year FROM bills ORDER BY year DESC`)
    .all()
    .map((r) => r.year);

  res.json({ monthly, customers, vehicles, outstanding, years });
});

/* --------------------------------- backup -------------------------------- */
app.get('/api/backup/export', (req, res) => {
  const payload = {
    app: 'Speedcold Bill Manager',
    version: 1,
    exported_at: new Date().toISOString(),
    company: getCompany(),
    users: db.prepare('SELECT * FROM users ORDER BY id').all(),
    customers: db.prepare('SELECT * FROM customers ORDER BY id').all(),
    vehicles: db.prepare('SELECT * FROM vehicles ORDER BY id').all(),
    bills: db.prepare('SELECT * FROM bills ORDER BY id').all(),
    bill_items: db.prepare('SELECT * FROM bill_items ORDER BY bill_id, sr').all(),
    audit_log: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="bill-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

app.post('/api/backup/restore', (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.bills) || !Array.isArray(data.bill_items)) {
    return res.status(400).json({ error: 'Invalid backup file' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM bill_items').run();
    db.prepare('DELETE FROM bills').run();
    db.prepare('DELETE FROM audit_log').run();
    db.prepare('DELETE FROM customers').run();
    db.prepare('DELETE FROM vehicles').run();

    if (data.company) {
      const c = data.company;
      db.prepare('DELETE FROM company WHERE id = 1').run();
      db.prepare(
        `INSERT INTO company (id, name, address, phone, email, gstin, bank_name, account_no, ifsc, logo, footer_note, updated_at)
         VALUES (1,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(c.name || '', c.address || '', c.phone || '', c.email || '', c.gstin || '', c.bank_name || '',
        c.account_no || '', c.ifsc || '', c.logo || '', c.footer_note || '', now());
    }
    if (Array.isArray(data.users)) {
      const stUser = db.prepare(
        `INSERT OR IGNORE INTO users (id, username, password_hash, salt, active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      );
      data.users.forEach((u) => {
        if (u && u.username && u.password_hash) {
          stUser.run(u.id ?? null, u.username, u.password_hash, u.salt || '', u.active === 0 ? 0 : 1,
            u.created_at || now(), u.updated_at || now());
        }
      });
    }
    if (Array.isArray(data.customers)) {
      const st = db.prepare('INSERT INTO customers (id, name, address, contact_person, phone, email, gstin, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
      data.customers.forEach((c) => st.run(c.id, c.name, c.address || '', c.contact_person || '', c.phone || '', c.email || '', c.gstin || '', c.notes || '', c.created_at || now()));
    }
    if (Array.isArray(data.vehicles)) {
      const st = db.prepare('INSERT INTO vehicles (id, number, vehicle_type, driver, default_rate, notes, created_at) VALUES (?,?,?,?,?,?,?)');
      data.vehicles.forEach((v) => st.run(v.id, v.number, v.vehicle_type || '', v.driver || '', Number(v.default_rate) || 0, v.notes || '', v.created_at || now()));
    }
    const stBill = db.prepare(
      `INSERT INTO bills (id, bill_number, bill_date, billing_month, customer_id, customer_name, customer_address, customer_gstin,
                          status, layout, gst_enabled, gst_rate, gst_type, adjustments, adjustment_note, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    data.bills.forEach((b) =>
      stBill.run(b.id, b.bill_number, b.bill_date, b.billing_month || '', b.customer_id ?? null, b.customer_name || '',
        b.customer_address || '', b.customer_gstin || '', b.status || 'active',
        ['portrait', 'landscape'].includes(b.layout) ? b.layout : 'portrait',
        b.gst_enabled ? 1 : 0,
        Number(b.gst_rate) || 0, b.gst_type || 'intra', Number(b.adjustments) || 0, b.adjustment_note || '',
        b.notes || '', b.created_at || now(), b.updated_at || now())
    );
    const stItem = db.prepare('INSERT INTO bill_items (id, bill_id, sr, month, vehicle_number, route, rate, advance, balance) VALUES (?,?,?,?,?,?,?,?,?)');
    data.bill_items.forEach((i) => stItem.run(i.id, i.bill_id, i.sr || 1, i.month || '', i.vehicle_number || '', i.route || '',
      Number(i.rate) || 0, Number(i.advance) || 0, Number(i.balance) || 0));
    if (Array.isArray(data.audit_log)) {
      const stAudit = db.prepare('INSERT INTO audit_log (id, bill_id, entity, record_label, field, old_value, new_value, changed_at) VALUES (?,?,?,?,?,?,?,?)');
      data.audit_log.forEach((a) => stAudit.run(a.id, a.bill_id ?? null, a.entity, a.record_label || '', a.field, a.old_value || '', a.new_value || '', a.changed_at || now()));
    }
    try { db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('customers','vehicles','bills','bill_items','audit_log')`); } catch (_) {}
    db.exec('COMMIT');
    res.json({ ok: true, bills: data.bills.length, customers: (data.customers || []).length, vehicles: (data.vehicles || []).length });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: 'Restore failed: ' + e.message });
  }
});

/* --------------------------------- start --------------------------------- */
app.listen(PORT, () => {
  console.log(`Speedcold Bill Manager running at http://localhost:${PORT}`);
  console.log(chromePath ? `PDF engine: ${chromePath}` : 'PDF engine: Chrome not found (set CHROME_PATH)');
});
