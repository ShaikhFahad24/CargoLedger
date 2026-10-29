'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'speedcold.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  bank_name TEXT,
  account_no TEXT,
  ifsc TEXT,
  logo TEXT,
  footer_note TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,
  vehicle_type TEXT,
  driver TEXT,
  default_rate REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_number TEXT NOT NULL,
  bill_date TEXT NOT NULL,
  billing_month TEXT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_address TEXT,
  customer_gstin TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  gst_enabled INTEGER NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  gst_type TEXT NOT NULL DEFAULT 'intra',
  adjustments REAL NOT NULL DEFAULT 0,
  adjustment_note TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  sr INTEGER NOT NULL DEFAULT 1,
  month TEXT,
  vehicle_number TEXT,
  route TEXT,
  rate REAL NOT NULL DEFAULT 0,
  advance REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER,
  entity TEXT NOT NULL,
  record_label TEXT,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_bill ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bills_number ON bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_audit_bill ON audit_log(bill_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

/* ---------- migrations for databases created before these features ---------- */
const hasColumn = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('bills', 'layout')) db.exec(`ALTER TABLE bills ADD COLUMN layout TEXT NOT NULL DEFAULT 'portrait'`);
if (!hasColumn('company', 'bill_layout')) db.exec(`ALTER TABLE company ADD COLUMN bill_layout TEXT NOT NULL DEFAULT 'portrait'`);

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/* ---------- passwords & sessions ---------- */
const SESSION_DAYS = 7;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const calc = crypto.scryptSync(String(password), String(salt), 64);
  const stored = Buffer.from(String(hash), 'hex');
  return stored.length === calc.length && crypto.timingSafeEqual(calc, stored);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(token, userId, now(), expires);
  return token;
}

function getSession(token) {
  if (!token) return null;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  const row = db
    .prepare(
      `SELECT s.id AS token, u.id, u.username, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(token);
  if (!row || !row.active) return null;
  return { token: row.token, user: { id: row.id, username: row.username } };
}

function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

/* ---------- seed: default login (fahad / aafiya) ---------- */
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const { salt, hash } = hashPassword('aafiya');
  db.prepare('INSERT INTO users (username, password_hash, salt) VALUES (?,?,?)').run('fahad', hash, salt);
}

/* ---------- seed: company profile taken from the sample SPEEDCOLD bill ---------- */
const companyRow = db.prepare('SELECT id FROM company WHERE id = 1').get();
if (!companyRow) {
  db.prepare(
    `INSERT INTO company (id, name, address, phone, email, gstin, bank_name, account_no, ifsc, footer_note, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'SPEEDCOLD LOGISTIC',
    'Chimbali Phata Kuruli, Tq. Khed, Pune – 412105',
    '7057566802',
    'speedcoldlogistic@gmail.com',
    '',
    'Union Bank of India',
    '651602010011047',
    'UBIN0565164',
    'Thank you for your business.',
    now()
  );
}

/* ---------- seed: sample customer, vehicles and the sample bill 646 ---------- */
const custCount = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
if (custCount === 0) {
  const insCust = db.prepare(
    'INSERT INTO customers (name, address, contact_person, phone, email) VALUES (?, ?, ?, ?, ?)'
  );
  insCust.run('RELIABLE LOGISTICS', '', '', '', '');

  const insVeh = db.prepare('INSERT INTO vehicles (number, vehicle_type, default_rate) VALUES (?, ?, ?)');
  insVeh.run('MH14JL5217', 'Truck', 110000);
  insVeh.run('MH14GD9147', 'Truck', 110000);
  insVeh.run('MH14EM7347', 'Truck', 110000);

  const insBill = db.prepare(
    `INSERT INTO bills (bill_number, bill_date, billing_month, customer_id, customer_name, customer_address, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  );
  const info = insBill.run('646', '2026-09-15', 'August 2026', 1, 'RELIABLE LOGISTICS', '');
  const billId = Number(info.lastInsertRowid);

  const insItem = db.prepare(
    `INSERT INTO bill_items (bill_id, sr, month, vehicle_number, route, rate, advance, balance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  [
    ['MH14JL5217'],
    ['MH14GD9147'],
    ['MH14EM7347'],
  ].forEach(([num], i) => {
    insItem.run(billId, i + 1, 'August', num, 'Zomato to Pune', 110000, 0, 110000);
  });
}

/* ---------- helpers ---------- */
function computeItem(item) {
  const rate = Number(item.rate) || 0;
  const advance = Number(item.advance) || 0;
  return { rate, advance, balance: rate - advance };
}

function computeTotals(items, bill) {
  let subtotal = 0;
  let totalAdvance = 0;
  for (const it of items) {
    subtotal += Number(it.rate) || 0;
    totalAdvance += Number(it.advance) || 0;
  }
  const adjustments = Number(bill.adjustments) || 0;
  const taxable = subtotal + adjustments;
  const gstEnabled = !!bill.gst_enabled;
  const gstRate = gstEnabled ? Number(bill.gst_rate) || 0 : 0;
  const gstAmount = (taxable * gstRate) / 100;
  const cgst = gstEnabled && bill.gst_type === 'intra' ? gstAmount / 2 : 0;
  const sgst = gstEnabled && bill.gst_type === 'intra' ? gstAmount / 2 : 0;
  const igst = gstEnabled && bill.gst_type !== 'intra' ? gstAmount : 0;
  const total = taxable + gstAmount;
  return {
    subtotal,
    total_advance: totalAdvance,
    total_balance_before_tax: subtotal - totalAdvance,
    adjustments,
    taxable,
    gst_rate: gstRate,
    cgst,
    sgst,
    igst,
    gst_total: gstAmount,
    total,
    outstanding: total - totalAdvance,
  };
}

function getBill(id) {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
  if (!bill) return null;
  const items = db
    .prepare('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY sr, id')
    .all(id);
  bill.items = items;
  bill.gst_enabled = !!bill.gst_enabled;
  bill.totals = computeTotals(items, bill);
  return bill;
}

function logAudit({ billId, entity, label, field, oldValue, newValue }) {
  const norm = (v) => (v === undefined || v === null ? '' : String(v));
  if (norm(oldValue) === norm(newValue)) return;
  db.prepare(
    `INSERT INTO audit_log (bill_id, entity, record_label, field, old_value, new_value, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(billId ?? null, entity, label ?? '', field, norm(oldValue), norm(newValue), now());
}

module.exports = {
  db,
  now,
  computeItem,
  computeTotals,
  getBill,
  logAudit,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  DATA_DIR,
};
