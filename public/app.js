'use strict';

/* =============================== helpers =============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const h = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n) => {
  const num = Number(n) || 0;
  const neg = num < 0;
  const [i, d] = Math.abs(num).toFixed(2).split('.');
  let out;
  if (i.length > 3) {
    const last3 = i.slice(-3);
    out = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  } else out = i;
  return (neg ? '-\u20B9' : '\u20B9') + out + (d === '00' ? '' : '.' + d);
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return d && m && y ? `${d}-${m}-${y}` : iso;
};

const parseNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 2600);
}

async function api(path, opts = {}) {
  const init = { headers: { 'Content-Type': 'application/json' }, ...opts };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
    err.status = res.status;
    if (res.status === 401 && !path.startsWith('/api/auth/')) showLogin();
    throw err;
  }
  return data;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function openModal(title, bodyHtml, footHtml, large) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-bg">
      <div class="modal ${large ? 'lg' : ''}">
        <div class="modal-h"><h3>${title}</h3><button class="x" data-close>&times;</button></div>
        <div class="modal-b">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-f">${footHtml}</div>` : ''}
      </div>
    </div>`;
  const bg = $('.modal-bg', root);
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeModal(); });
  return root;
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

function download(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadBlob(url, options, filename) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = 'Download failed';
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const confirmBox = (msg) => window.confirm(msg);

/* =============================== state =============================== */
const state = { company: null, customers: [], vehicles: [], user: null };

async function loadGlobals() {
  const [company, customers, vehicles] = await Promise.all([
    api('/api/company'), api('/api/customers'), api('/api/vehicles'),
  ]);
  state.company = company;
  state.customers = customers;
  state.vehicles = vehicles;
}

/* =============================== router =============================== */
const ROUTES = {
  dashboard: { title: 'Dashboard', crumb: 'Overview of your billing', render: viewDashboard },
  bills: { title: 'Bills', crumb: 'Create, edit, search and print', render: viewBills },
  customers: { title: 'Customers', crumb: 'Manage customer profiles', render: viewCustomers },
  vehicles: { title: 'Vehicles', crumb: 'Saved vehicle records and default rates', render: viewVehicles },
  users: { title: 'Users', crumb: 'Login accounts for this computer', render: viewUsers },
  reports: { title: 'Reports', crumb: 'Monthly totals, advances and dues', render: viewReports },
  settings: { title: 'Company Settings', crumb: 'Company profile, bank details and logo', render: viewSettings },
  backup: { title: 'Backup & Restore', crumb: 'Export or restore all records', render: viewBackup },
};

let editorDirty = false;
window.addEventListener('beforeunload', (e) => {
  if (editorDirty) { e.preventDefault(); e.returnValue = ''; }
});

async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const params = new URLSearchParams(queryPart || '');
  const parts = pathPart.split('/').filter(Boolean);
  const key = parts[0] || 'dashboard';
  const view = $('#view');

  try {
    if (key === 'bills' && parts[1] === 'new') return await viewBillEditor(null);
    if (key === 'bills' && parts[1] && parts[2] === 'edit') return await viewBillEditor(Number(parts[1]));
    if (key === 'bills' && parts[1]) return await viewBillDetail(Number(parts[1]));

    const r = ROUTES[key] || ROUTES.dashboard;
    $('#pageTitle').textContent = r.title;
    $('#pageCrumb').textContent = r.crumb;
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    view.innerHTML = '<div class="card"><div class="empty">Loading\u2026</div></div>';
    await r.render(view, params);
  } catch (e) {
    view.innerHTML = `<div class="card"><div class="empty">Something went wrong: ${h(e.message)}</div></div>`;
  }
}

window.addEventListener('hashchange', route);
$('#quickNewBill').addEventListener('click', () => (location.hash = '#/bills/new'));

/* =============================== dashboard =============================== */
async function viewDashboard(view) {
  const d = await api('/api/dashboard');
  $('#billCountBadge').textContent = d.active || '';

  const max = Math.max(1, ...d.monthly.map((m) => m.amount));
  const chart = d.monthly.length
    ? d.monthly.slice().reverse().map((m) => `
        <div class="bar" title="${h(m.ym)}: ${money(m.amount)}">
          <i style="height:${Math.round((m.amount / max) * 100)}%"></i>
          <b>${h(m.ym.slice(5))}/${h(m.ym.slice(2, 4))}</b>
        </div>`).join('')
    : '<div class="empty">No bills yet</div>';

  view.innerHTML = `
    <div class="stats">
      <div class="stat n"><div class="k">Active bills</div><div class="v">${d.active}</div><div class="d">${d.cancelled} cancelled</div></div>
      <div class="stat"><div class="k">Total billed</div><div class="v">${money(d.billed)}</div><div class="d">${d.bill_count} bills total</div></div>
      <div class="stat g"><div class="k">Advance received</div><div class="v">${money(d.received)}</div><div class="d">across all bills</div></div>
      <div class="stat o"><div class="k">Outstanding</div><div class="v">${money(d.outstanding)}</div><div class="d">balance yet to collect</div></div>
      <div class="stat"><div class="k">Customers / Vehicles</div><div class="v">${d.customers} / ${d.vehicles}</div><div class="d">saved records</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-h"><h3>Monthly billing</h3><span class="sub">last ${d.monthly.length} months</span></div>
        <div class="card-b"><div class="bar-chart">${chart}</div></div>
      </div>

      <div class="card">
        <div class="card-h"><h3>Outstanding dues</h3><a class="btn sm ghost" href="#/reports">All reports</a></div>
        <div class="card-b" style="padding-top:6px">
          ${d.dues.length ? `<table class="grid"><thead><tr><th>Bill</th><th>Customer</th><th>Date</th><th class="num">Due</th></tr></thead><tbody>
            ${d.dues.map((b) => `<tr>
              <td><a href="#/bills/${b.id}">#${h(b.bill_number)}</a></td>
              <td>${h(b.customer_name) || '-'}</td>
              <td>${fmtDate(b.bill_date)}</td>
              <td class="num strong">${money(b.due)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">No pending dues \uD83C\uDF89</div>'}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-h"><h3>Recent bills</h3><a class="btn sm primary" href="#/bills/new">+ New bill</a></div>
      <div class="card-b" style="padding-top:6px">
        ${d.recent.length ? `<table class="grid"><thead><tr><th>Bill no.</th><th>Date</th><th>Customer</th><th>Status</th><th class="num">Total</th><th>Action</th></tr></thead><tbody>
          ${d.recent.map((b) => `<tr>
            <td><a href="#/bills/${b.id}">#${h(b.bill_number)}</a></td>
            <td>${fmtDate(b.bill_date)}</td>
            <td>${h(b.customer_name) || '-'}</td>
            <td>${b.status === 'cancelled' ? '<span class="pill red">CANCELLED</span>' : `<span class="pill green">ACTIVE</span>`}</td>
            <td class="num">${money(b.total)}</td>
            <td>${b.status === 'cancelled' ? '<span class="muted">\u2014</span>' : '<a class="btn sm" href="#/bills/' + b.id + '">Open</a>'}</td>
          </tr>`).join('')}
        </tbody></table>` : '<div class="empty">No bills yet \u2014 create your first bill</div>'}
      </div>
    </div>`;
}

/* =============================== bills list =============================== */
async function viewBills(view, params) {
  const initialQ = (params && params.get('q')) || '';
  const filters = { q: initialQ, status: '', from: '', to: '', month: '' };

  view.innerHTML = `
    <div class="toolbar">
      <div class="grow"><input type="text" id="fq" value="${h(initialQ)}" placeholder="Search bill no, customer, month, route or vehicle number\u2026"></div>
      <input type="date" id="ffrom" title="From date">
      <input type="date" id="fto" title="To date">
      <select id="fstatus">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <a class="btn primary" href="#/bills/new">+ New Bill</a>
    </div>
    <div class="card"><div id="billRows"><div class="empty">Loading\u2026</div></div></div>`;

  const render = async () => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
    const rows = await api('/api/bills?' + qs.toString());
    $('#billRows').innerHTML = rows.length ? `
      <table class="grid">
        <thead><tr>
          <th>Bill no.</th><th>Date</th><th>Period</th><th>Customer</th><th>Entries</th>
          <th class="num">Total</th><th class="num">Outstanding</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>${rows.map((b) => `
          <tr>
            <td class="strong"><a href="#/bills/${b.id}">#${h(b.bill_number)}</a></td>
            <td>${fmtDate(b.bill_date)}</td>
            <td>${h(b.billing_month) || '-'}</td>
            <td>${h(b.customer_name) || '-'}</td>
            <td>${b.item_count}</td>
            <td class="num strong">${money(b.total)}</td>
            <td class="num">${b.outstanding > 0 ? `<span style="color:var(--warn);font-weight:700">${money(b.outstanding)}</span>` : '<span class="muted">\u2014</span>'}</td>
            <td>${b.status === 'cancelled' ? '<span class="pill red">CANCELLED</span>' : '<span class="pill green">ACTIVE</span>'}</td>
            <td class="num">
              <a class="btn sm" href="#/bills/${b.id}">Open</a>
              <a class="btn sm" href="#/bills/${b.id}/edit">Edit</a>
            </td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No bills match your search</div>';
  };

  $('#fq').addEventListener('input', (e) => { filters.q = e.target.value.trim(); debounce(render); });
  $('#ffrom').addEventListener('change', (e) => { filters.from = e.target.value; render(); });
  $('#fto').addEventListener('change', (e) => { filters.to = e.target.value; render(); });
  $('#fstatus').addEventListener('change', (e) => { filters.status = e.target.value; render(); });
  await render();
}

let debounceT;
const debounce = (fn, ms = 260) => { clearTimeout(debounceT); debounceT = setTimeout(fn, ms); };

/* =============================== bill detail =============================== */
async function viewBillDetail(id) {
  const view = $('#view');
  const bill = await api('/api/bills/' + id);
  const audit = await api('/api/bills/' + id + '/audit');
  const cancelled = bill.status === 'cancelled';

  $('#pageTitle').textContent = `Bill #${bill.bill_number}`;
  $('#pageCrumb').textContent = `${bill.customer_name || 'Customer'} \u00b7 ${fmtDate(bill.bill_date)}`;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === 'bills'));

  view.innerHTML = `
    <div class="page-actions" style="margin-bottom:16px">
      <a class="btn" href="#/bills">&larr; All bills</a>
      <a class="btn primary" href="#/bills/${bill.id}/edit">Edit</a>
      <button class="btn success" id="btnPdf">Download PDF</button>
      <button class="btn" id="btnPrint">Print</button>
      ${cancelled
        ? '<button class="btn" id="btnRestore">Restore bill</button>'
        : '<button class="btn danger" id="btnCancelBill">Mark cancelled</button>'}
      <button class="btn danger" id="btnDelete">Delete</button>
    </div>

    <div class="card">
      <div class="card-h">
        <h3>Preview <span class="sub">A4 ${bill.layout === 'landscape' ? '\u00b7 Landscape (horizontal)' : '\u00b7 Portrait (vertical)'} \u00b7 ${bill.gst_enabled ? 'Tax invoice' : 'Logistics bill'}</span></h3>
        <span class="sub">${cancelled ? '<span class="pill red">CANCELLED</span>' : '<span class="pill green">ACTIVE</span>'}</span>
      </div>
      <div class="card-b">
        <div class="preview-wrap"><iframe class="preview-frame" id="preview" src="/api/bills/${bill.id}/html"></iframe></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-h"><h3>Change history</h3><span class="sub">${audit.length} recorded change${audit.length === 1 ? '' : 's'}</span></div>
      <div class="card-b" style="padding-top:6px">
        ${audit.length ? `<table class="grid">
          <thead><tr><th>When</th><th>Record</th><th>Field</th><th>Previous value</th><th>New value</th></tr></thead>
          <tbody>${audit.map((a) => `<tr>
            <td class="muted">${h(a.changed_at)}</td>
            <td>${h(a.record_label) || '-'}</td>
            <td class="mono">${h(a.field)}</td>
            <td class="audit-old">${h(a.old_value) || '\u2014'}</td>
            <td class="audit-new">${h(a.new_value) || '\u2014'}</td>
          </tr>`).join('')}</tbody></table>` : '<div class="empty">No changes recorded yet</div>'}
      </div>
    </div>`;

  $('#btnPdf').addEventListener('click', () => download(`/api/bills/${bill.id}/pdf`, `Bill-${bill.bill_number}.pdf`));
  $('#btnPrint').addEventListener('click', () => window.open(`/api/bills/${bill.id}/html`, '_blank'));
  $('#btnDelete').addEventListener('click', async () => {
    if (!confirmBox(`Delete bill #${bill.bill_number} permanently? This cannot be undone.`)) return;
    await api('/api/bills/' + bill.id, { method: 'DELETE' });
    toast('Bill deleted', 'ok');
    location.hash = '#/bills';
  });
  const statusBtn = $('#btnCancelBill') || $('#btnRestore');
  statusBtn.addEventListener('click', async () => {
    const next = cancelled ? 'active' : 'cancelled';
    if (!confirmBox(cancelled ? 'Restore this bill to active?' : 'Mark this bill as cancelled? The record and history are kept.')) return;
    await api(`/api/bills/${bill.id}/status`, { method: 'POST', body: { status: next } });
    toast(next === 'cancelled' ? 'Bill marked cancelled' : 'Bill restored', 'ok');
    route();
  });
}

/* =============================== bill editor =============================== */
async function viewBillEditor(id) {
  const view = $('#view');
  const isNew = !id;
  await loadGlobals();

  let bill;
  if (isNew) {
    let nextNo = '1';
    try { nextNo = (await api('/api/bills/next-number')).bill_number; } catch (_) {}
    bill = {
      id: null,
      bill_number: nextNo,
      bill_date: new Date().toISOString().slice(0, 10),
      billing_month: '',
      customer_id: null,
      customer_name: '',
      customer_address: '',
      customer_gstin: '',
      status: 'active',
      layout: (state.company && state.company.bill_layout) || 'portrait',
      gst_enabled: false,
      gst_rate: 18,
      gst_type: 'intra',
      adjustments: 0,
      adjustment_note: '',
      notes: '',
      items: [{ month: '', vehicle_number: '', route: '', rate: 0, advance: 0, balance: 0 }],
    };
  } else {
    bill = await api('/api/bills/' + id);
  }

  $('#pageTitle').textContent = isNew ? 'New Bill' : `Edit Bill #${bill.bill_number}`;
  $('#pageCrumb').textContent = 'All fields are editable \u2014 totals recalculate automatically';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === 'bills'));

  const custOptions = ['<option value="">\u2014 Select customer \u2014</option>']
    .concat(state.customers.map((c) => `<option value="${c.id}" ${bill.customer_id === c.id ? 'selected' : ''}>${h(c.name)}</option>`))
    .join('');

  view.innerHTML = `
    <div class="page-actions" style="margin-bottom:16px">
      <a class="btn" href="${isNew ? '#/bills' : '#/bills/' + bill.id}">&larr; Cancel</a>
      <button class="btn primary" id="btnSave">Save bill</button>
      <button class="btn success" id="btnSavePdf">Save &amp; download PDF</button>
      <span class="hint" id="dirtyHint" style="align-self:center"></span>
    </div>

    <div class="editor-grid">
      <div>
        <div class="card">
          <div class="card-h"><h3>Bill details</h3></div>
          <div class="card-b">
            <div class="row c4">
              <div class="field"><label>Bill number</label><input type="text" id="f_bill_number" value="${h(bill.bill_number)}"></div>
              <div class="field"><label>Bill date</label><input type="date" id="f_bill_date" value="${h(bill.bill_date)}"></div>
              <div class="field"><label>Billing period</label><input type="text" id="f_billing_month" value="${h(bill.billing_month || '')}" placeholder="e.g. August 2026"></div>
              <div class="field"><label>Customer</label>
                <select id="f_customer">${custOptions}</select>
              </div>
            </div>
            <div class="row c3">
              <div class="field"><label>Customer name</label><input type="text" id="f_customer_name" value="${h(bill.customer_name || '')}"></div>
              <div class="field"><label>Customer address</label><input type="text" id="f_customer_address" value="${h(bill.customer_address || '')}"></div>
              <div class="field"><label>Customer GSTIN (optional)</label><input type="text" id="f_customer_gstin" value="${h(bill.customer_gstin || '')}"></div>
            </div>
            <div class="row c3">
              <div class="field"><label>Notes on bill</label><input type="text" id="f_notes" value="${h(bill.notes || '')}" placeholder="Optional note printed on the bill"></div>
              <div class="field"><label>Adjustment note</label><input type="text" id="f_adjustment_note" value="${h(bill.adjustment_note || '')}" placeholder="e.g. rounding off, discount"></div>
              <div class="field"><label>Bill format</label>
                <select id="f_layout">
                  <option value="portrait" ${bill.layout !== 'landscape' ? 'selected' : ''}>Vertical \u00b7 A4 Portrait</option>
                  <option value="landscape" ${bill.layout === 'landscape' ? 'selected' : ''}>Horizontal \u00b7 A4 Landscape</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:18px">
          <div class="card-h">
            <h3>Vehicle entries</h3>
            <div style="display:flex;gap:8px">
              <button class="btn sm" id="btnAddVehicle">+ Add row</button>
              <button class="btn sm" id="btnAddFromFleet">+ From saved vehicles</button>
            </div>
          </div>
          <div class="card-b">
            <table class="items-editor" id="itemsTable">
              <thead><tr>
                <th style="width:34px">Sr.</th>
                <th style="width:110px">Month</th>
                <th style="width:150px">Vehicle no.</th>
                <th>From / To</th>
                <th class="num" style="width:120px">Rate (\u20B9)</th>
                <th class="num" style="width:120px">Advance (\u20B9)</th>
                <th class="num" style="width:120px">Balance (\u20B9)</th>
                <th style="width:34px"></th>
              </tr></thead>
              <tbody id="itemsBody"></tbody>
            </table>
            <datalist id="vehicleList">${state.vehicles.map((v) => `<option value="${h(v.number)}">`).join('')}</datalist>
            <div class="hint" style="margin-top:10px">Balance = Rate &minus; Advance. Type a saved vehicle number to auto-fill its default rate.</div>
          </div>
        </div>

        <div class="card" style="margin-top:18px">
          <div class="card-h"><h3>Taxes (optional)</h3></div>
          <div class="card-b">
            <label class="switch"><input type="checkbox" id="f_gst_enabled" ${bill.gst_enabled ? 'checked' : ''}> Apply GST to this bill</label>
            <div class="row c3" id="gstFields" style="margin-top:14px;${bill.gst_enabled ? '' : 'opacity:.4;pointer-events:none'}">
              <div class="field"><label>GST rate (%)</label><input type="text" id="f_gst_rate" value="${h(bill.gst_rate)}"></div>
              <div class="field"><label>GST type</label>
                <select id="f_gst_type">
                  <option value="intra" ${bill.gst_type === 'intra' ? 'selected' : ''}>Within state (CGST + SGST)</option>
                  <option value="inter" ${bill.gst_type === 'inter' ? 'selected' : ''}>Inter state (IGST)</option>
                </select>
              </div>
              <div class="field"><label>Adjustment (\u20B9)</label><input type="text" id="f_adjustments" value="${h(bill.adjustments || 0)}"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="side-col">
        <div class="card">
          <div class="card-h"><h3>Bill summary</h3></div>
          <div class="card-b totals-box" id="totalsBox"></div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Live preview</h3></div>
          <div class="card-b">
            <div class="preview-wrap"><iframe class="preview-frame" id="livePreview" style="height:560px"></iframe></div>
            <div class="hint" style="margin-top:8px">Preview refreshes as you type.</div>
          </div>
        </div>
      </div>
    </div>`;

  /* ---------- editor state ---------- */
  const items = bill.items.map((i) => ({ ...i }));
  let previewTimer = null;

  const rowsHtml = () => items
    .map((it, i) => `
      <tr data-i="${i}">
        <td class="muted" style="text-align:center">${i + 1}</td>
        <td><input type="text" data-f="month" value="${h(it.month || '')}" placeholder="August"></td>
        <td><input type="text" data-f="vehicle_number" list="vehicleList" value="${h(it.vehicle_number || '')}" placeholder="MH14XX0000"></td>
        <td><input type="text" data-f="route" value="${h(it.route || '')}" placeholder="Zomato to Pune"></td>
        <td class="num"><input type="text" data-f="rate" value="${it.rate ? String(it.rate) : ''}" placeholder="0"></td>
        <td class="num"><input type="text" data-f="advance" value="${it.advance ? String(it.advance) : ''}" placeholder="0"></td>
        <td class="bal" data-bal>${money(it.rate - it.advance)}</td>
        <td style="text-align:center"><button class="rmin" title="Remove row" data-rm>&times;</button></td>
      </tr>`)
    .join('');

  const renderRows = () => {
    $('#itemsBody').innerHTML = rowsHtml();
    $$('#itemsBody tr').forEach((tr) => {
      const i = Number(tr.dataset.i);
      $$('input[data-f]', tr).forEach((inp) => {
        inp.addEventListener('input', () => {
          const f = inp.dataset.f;
          items[i][f] = ['rate', 'advance'].includes(f) ? parseNum(inp.value) : inp.value;
          if (f === 'vehicle_number') onVehiclePick(i, inp.value);
          recalc();
        });
      });
      $('[data-rm]', tr).addEventListener('click', () => {
        if (items.length === 1) return toast('A bill needs at least one entry', 'err');
        items.splice(i, 1);
        renderRows();
        recalc();
      });
    });
  };

  function onVehiclePick(i, number) {
    const v = state.vehicles.find((x) => x.number.toLowerCase() === String(number).trim().toLowerCase());
    if (v && !items[i].rate) {
      items[i].rate = Number(v.default_rate) || 0;
      const cell = $$('#itemsBody tr')[i];
      if (cell) $('[data-f="rate"]', cell).value = items[i].rate || '';
      recalc();
    }
  }

  const collect = () => ({
    bill_number: $('#f_bill_number').value.trim(),
    bill_date: $('#f_bill_date').value,
    billing_month: $('#f_billing_month').value.trim(),
    customer_id: $('#f_customer').value ? Number($('#f_customer').value) : null,
    customer_name: $('#f_customer_name').value.trim(),
    customer_address: $('#f_customer_address').value.trim(),
    customer_gstin: $('#f_customer_gstin').value.trim(),
    gst_enabled: $('#f_gst_enabled').checked,
    gst_rate: parseNum($('#f_gst_rate').value),
    gst_type: $('#f_gst_type').value,
    adjustments: parseNum($('#f_adjustments').value),
    adjustment_note: $('#f_adjustment_note').value.trim(),
    notes: $('#f_notes').value.trim(),
    layout: $('#f_layout').value,
    items: items.filter((it) => it.vehicle_number || it.route || it.rate || it.advance)
      .map((it, idx) => ({ ...it, sr: idx + 1, balance: (Number(it.rate) || 0) - (Number(it.advance) || 0) })),
  });

  function recalc() {
    $$('#itemsBody tr').forEach((tr, i) => {
      if (items[i]) $('[data-bal]', tr).textContent = money((items[i].rate || 0) - (items[i].advance || 0));
    });

    const d = collect();
    let subtotal = 0, advance = 0;
    d.items.forEach((it) => { subtotal += it.rate; advance += it.advance; });
    const taxable = subtotal + d.adjustments;
    const gstAmt = d.gst_enabled ? (taxable * d.gst_rate) / 100 : 0;
    const total = taxable + gstAmt;
    const outstanding = total - advance;

    $('#totalsBox').innerHTML = `
      <div class="line"><span>Entries</span><span>${d.items.length}</span></div>
      <div class="line"><span>Subtotal (rate)</span><span>${money(subtotal)}</span></div>
      ${d.adjustments ? `<div class="line"><span>Adjustment</span><span>${money(d.adjustments)}</span></div>` : ''}
      ${d.gst_enabled ? `
        ${d.gst_type === 'intra'
          ? `<div class="line"><span>CGST @ ${(d.gst_rate / 2).toFixed(2)}%</span><span>${money(gstAmt / 2)}</span></div>
             <div class="line"><span>SGST @ ${(d.gst_rate / 2).toFixed(2)}%</span><span>${money(gstAmt / 2)}</span></div>`
          : `<div class="line"><span>IGST @ ${d.gst_rate}%</span><span>${money(gstAmt)}</span></div>`}` : ''}
      <div class="line grand"><span>Total</span><span>${money(total)}</span></div>
      <div class="line"><span>Advance paid</span><span>${money(advance)}</span></div>
      <div class="line due"><span>Balance due</span><span>${money(outstanding)}</span></div>`;

    editorDirty = true;
    $('#dirtyHint').textContent = 'Unsaved changes';
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 550);
  }

  async function refreshPreview() {
    try {
      const html = await api('/api/bills/preview', { method: 'POST', body: collect() });
      const frame = $('#livePreview');
      if (frame) frame.srcdoc = html;
    } catch (e) {
      const frame = $('#livePreview');
      if (frame && !frame.srcdoc) frame.srcdoc = `<div style="padding:16px;font-family:sans-serif;color:#b3261e">${h(e.message)}</div>`;
    }
  }

  /* ---------- listeners ---------- */
  $('#btnAddVehicle').addEventListener('click', () => {
    items.push({ month: '', vehicle_number: '', route: '', rate: 0, advance: 0, balance: 0 });
    renderRows();
    recalc();
    const rows = $$('#itemsBody tr');
    const last = rows[rows.length - 1];
    if (last) $('[data-f="month"]', last).focus();
  });

  $('#btnAddFromFleet').addEventListener('click', () => {
    if (!state.vehicles.length) return toast('No saved vehicles yet \u2014 add them under Vehicles', 'err');
    openModal('Add saved vehicles', `
      <div class="hint" style="margin-bottom:10px">Tick the vehicles to add as bill rows.</div>
      ${state.vehicles.map((v, i) => `
        <label class="switch" style="padding:7px 0;border-bottom:1px solid var(--line)">
          <input type="checkbox" class="pickVeh" value="${i}">
          <span><b class="mono">${h(v.number)}</b> <span class="muted">${h(v.vehicle_type || '')} &middot; default ${money(v.default_rate)}</span></span>
        </label>`).join('')}
    `, `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doAddVeh">Add selected</button>`, true);

    $('#doAddVeh').addEventListener('click', () => {
      $$('.pickVeh').forEach((cb) => {
        if (!cb.checked) return;
        const v = state.vehicles[Number(cb.value)];
        items.push({ month: '', vehicle_number: v.number, route: '', rate: Number(v.default_rate) || 0, advance: 0, balance: 0 });
      });
      closeModal();
      renderRows();
      recalc();
    });
  });

  $('#f_customer').addEventListener('change', (e) => {
    const c = state.customers.find((x) => x.id === Number(e.target.value));
    if (c) {
      $('#f_customer_name').value = c.name || '';
      $('#f_customer_address').value = c.address || '';
      $('#f_customer_gstin').value = c.gstin || '';
      recalc();
    }
  });

  $('#f_gst_enabled').addEventListener('change', (e) => {
    $('#gstFields').style.opacity = e.target.checked ? '1' : '.4';
    $('#gstFields').style.pointerEvents = e.target.checked ? 'auto' : 'none';
    recalc();
  });

  ['f_bill_number','f_bill_date','f_billing_month','f_customer_name','f_customer_address','f_customer_gstin',
   'f_gst_rate','f_gst_type','f_adjustments','f_adjustment_note','f_notes','f_layout'].forEach((idn) => {
    $('#' + idn).addEventListener('input', recalc);
    $('#' + idn).addEventListener('change', recalc);
  });

  const save = async (thenPdf) => {
    const payload = collect();
    if (!payload.bill_number) return toast('Bill number is required', 'err');
    if (!payload.items.length) return toast('Add at least one vehicle entry', 'err');
    try {
      const saved = isNew
        ? await api('/api/bills', { method: 'POST', body: payload })
        : await api('/api/bills/' + bill.id, { method: 'PUT', body: payload });
      editorDirty = false;
      $('#dirtyHint').textContent = '';
      toast('Bill saved', 'ok');
      if (thenPdf) {
        download(`/api/bills/${saved.id}/pdf`, `Bill-${saved.bill_number}.pdf`);
        location.hash = '#/bills/' + saved.id;
      } else {
        location.hash = '#/bills/' + saved.id;
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  $('#btnSave').addEventListener('click', () => save(false));
  $('#btnSavePdf').addEventListener('click', () => save(true));

  editorDirty = false;
  renderRows();
  recalc();
  editorDirty = false;
  $('#dirtyHint').textContent = '';
  refreshPreview();
}

/* =============================== customers =============================== */
function customerForm(c = {}) {
  return `
    <div class="row c2">
      <div class="field"><label>Company / customer name *</label><input type="text" id="c_name" value="${h(c.name || '')}"></div>
      <div class="field"><label>Contact person</label><input type="text" id="c_contact" value="${h(c.contact_person || '')}"></div>
    </div>
    <div class="field"><label>Address</label><input type="text" id="c_address" value="${h(c.address || '')}"></div>
    <div class="row c3">
      <div class="field"><label>Phone</label><input type="tel" id="c_phone" value="${h(c.phone || '')}"></div>
      <div class="field"><label>Email</label><input type="email" id="c_email" value="${h(c.email || '')}"></div>
      <div class="field"><label>GSTIN</label><input type="text" id="c_gstin" value="${h(c.gstin || '')}"></div>
    </div>
    <div class="field"><label>Notes</label><input type="text" id="c_notes" value="${h(c.notes || '')}"></div>`;
}

const readCustomerForm = () => ({
  name: $('#c_name').value.trim(),
  contact_person: $('#c_contact').value.trim(),
  address: $('#c_address').value.trim(),
  phone: $('#c_phone').value.trim(),
  email: $('#c_email').value.trim(),
  gstin: $('#c_gstin').value.trim(),
  notes: $('#c_notes').value.trim(),
});

async function viewCustomers(view) {
  const render = async (q = '') => {
    const rows = await api('/api/customers' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#custRows').innerHTML = rows.length ? `
      <table class="grid">
        <thead><tr><th>Name</th><th>Contact person</th><th>Phone</th><th>GSTIN</th><th>Bills</th><th></th></tr></thead>
        <tbody>${rows.map((c) => `<tr>
          <td class="strong">${h(c.name)}</td>
          <td>${h(c.contact_person) || '-'}</td>
          <td class="mono">${h(c.phone) || '-'}</td>
          <td class="mono">${h(c.gstin) || '-'}</td>
          <td class="muted">${h(c.address) || ''}</td>
          <td class="num">
            <a class="btn sm" href="#/bills?q=${encodeURIComponent(c.name)}">Bills</a>
            <button class="btn sm" data-edit="${c.id}">Edit</button>
            <button class="btn sm danger" data-del="${c.id}">Delete</button>
          </td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No customers yet \u2014 add your first customer</div>';

    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => openCustomerModal(rows.find((x) => x.id === Number(b.dataset.edit)))));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const c = rows.find((x) => x.id === Number(b.dataset.del));
      if (!confirmBox(`Delete customer "${c.name}"?`)) return;
      await api('/api/customers/' + c.id, { method: 'DELETE' });
      await loadGlobals();
      toast('Customer deleted', 'ok');
      render($('#cq').value.trim());
    }));
  };

  const openCustomerModal = (c) => {
    openModal(c ? 'Edit customer' : 'Add customer', customerForm(c || {}),
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveCust">${c ? 'Save changes' : 'Add customer'}</button>`);
    $('#saveCust').addEventListener('click', async () => {
      try {
        const body = readCustomerForm();
        if (!body.name) return toast('Customer name is required', 'err');
        if (c) await api('/api/customers/' + c.id, { method: 'PUT', body });
        else await api('/api/customers', { method: 'POST', body });
        closeModal();
        await loadGlobals();
        toast(c ? 'Customer updated' : 'Customer added', 'ok');
        render($('#cq').value.trim());
      } catch (e) { toast(e.message, 'err'); }
    });
  };

  view.innerHTML = `
    <div class="toolbar">
      <div class="grow"><input type="text" id="cq" placeholder="Search customers by name, contact, phone or GSTIN\u2026"></div>
      <button class="btn primary" id="addCust">+ Add customer</button>
    </div>
    <div class="card"><div id="custRows"><div class="empty">Loading\u2026</div></div></div>`;

  $('#addCust').addEventListener('click', () => openCustomerModal(null));
  $('#cq').addEventListener('input', (e) => debounce(() => render(e.target.value.trim())));
  await render();
}

/* =============================== vehicles =============================== */
async function viewVehicles(view) {
  const render = async (q = '') => {
    const rows = await api('/api/vehicles' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#vehRows').innerHTML = rows.length ? `
      <table class="grid">
        <thead><tr><th>Vehicle no.</th><th>Type</th><th>Driver</th><th class="num">Default rate</th><th>Notes</th><th></th></tr></thead>
        <tbody>${rows.map((v) => `<tr>
          <td class="strong mono">${h(v.number)}</td>
          <td>${h(v.vehicle_type) || '-'}</td>
          <td>${h(v.driver) || '-'}</td>
          <td class="num strong">${money(v.default_rate)}</td>
          <td class="muted">${h(v.notes) || ''}</td>
          <td class="num">
            <button class="btn sm" data-edit="${v.id}">Edit</button>
            <button class="btn sm danger" data-del="${v.id}">Delete</button>
          </td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No vehicles saved yet</div>';

    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => openVehicleModal(rows.find((x) => x.id === Number(b.dataset.edit)))));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const v = rows.find((x) => x.id === Number(b.dataset.del));
      if (!confirmBox(`Delete vehicle ${v.number}?`)) return;
      await api('/api/vehicles/' + v.id, { method: 'DELETE' });
      await loadGlobals();
      toast('Vehicle deleted', 'ok');
      render($('#vq').value.trim());
    }));
  };

  const openVehicleModal = (v) => {
    openModal(v ? 'Edit vehicle' : 'Add vehicle', `
      <div class="row c2">
        <div class="field"><label>Vehicle number *</label><input type="text" id="v_number" value="${h(v?.number || '')}" placeholder="MH14JL5217"></div>
        <div class="field"><label>Vehicle type</label><input type="text" id="v_type" value="${h(v?.vehicle_type || '')}" placeholder="Truck / Tempo"></div>
      </div>
      <div class="row c2">
        <div class="field"><label>Driver</label><input type="text" id="v_driver" value="${h(v?.driver || '')}"></div>
        <div class="field"><label>Default rate (\u20B9)</label><input type="text" id="v_rate" value="${v?.default_rate ?? 0}"></div>
      </div>
      <div class="field"><label>Notes</label><input type="text" id="v_notes" value="${h(v?.notes || '')}"></div>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveVeh">${v ? 'Save changes' : 'Add vehicle'}</button>`);

    $('#saveVeh').addEventListener('click', async () => {
      try {
        const body = {
          number: $('#v_number').value.trim(),
          vehicle_type: $('#v_type').value.trim(),
          driver: $('#v_driver').value.trim(),
          default_rate: parseNum($('#v_rate').value),
          notes: $('#v_notes').value.trim(),
        };
        if (!body.number) return toast('Vehicle number is required', 'err');
        if (v) await api('/api/vehicles/' + v.id, { method: 'PUT', body });
        else await api('/api/vehicles', { method: 'POST', body });
        closeModal();
        await loadGlobals();
        toast(v ? 'Vehicle updated' : 'Vehicle added', 'ok');
        render($('#vq').value.trim());
      } catch (e) { toast(e.message, 'err'); }
    });
  };

  view.innerHTML = `
    <div class="toolbar">
      <div class="grow"><input type="text" id="vq" placeholder="Search vehicle number, type or driver\u2026"></div>
      <button class="btn primary" id="addVeh">+ Add vehicle</button>
    </div>
    <div class="card"><div id="vehRows"><div class="empty">Loading\u2026</div></div></div>`;

  $('#addVeh').addEventListener('click', () => openVehicleModal(null));
  $('#vq').addEventListener('input', (e) => debounce(() => render(e.target.value.trim())));
  await render();
}

/* =============================== users =============================== */
async function viewUsers(view) {
  const render = async () => {
    const rows = await api('/api/users');
    const meId = state.user && state.user.id;
    $('#userRows').innerHTML = rows.length ? `
      <table class="grid">
        <thead><tr><th>Username</th><th>Status</th><th>Created</th><th>Last updated</th><th></th></tr></thead>
        <tbody>${rows.map((u) => `<tr>
          <td class="strong">${h(u.username)} ${u.id === meId ? '<span class="pill blue">YOU</span>' : ''}</td>
          <td>${u.active ? '<span class="pill green">ACTIVE</span>' : '<span class="pill gray">DISABLED</span>'}</td>
          <td class="muted">${h(u.created_at) || '-'}</td>
          <td class="muted">${h(u.updated_at) || '-'}</td>
          <td class="num">
            <button class="btn sm" data-edit="${u.id}">Edit</button>
            ${u.id === meId ? '' : `<button class="btn sm danger" data-del="${u.id}">Delete</button>`}
          </td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No users yet</div>';

    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => openUserModal(rows.find((x) => x.id === Number(b.dataset.edit)))));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const u = rows.find((x) => x.id === Number(b.dataset.del));
      if (!confirmBox(`Delete user "${u.username}"? They will no longer be able to log in.`)) return;
      try {
        await api('/api/users/' + u.id, { method: 'DELETE' });
        toast('User deleted', 'ok');
        await render();
      } catch (e) { toast(e.message, 'err'); }
    }));
  };

  const openUserModal = (u) => {
    openModal(u ? 'Edit user' : 'Add user', `
      <div class="field"><label>Username *</label><input type="text" id="u_name" value="${h(u?.username || '')}" autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label>${u ? 'New password (blank = keep current)' : 'Password *'}</label><input type="password" id="u_pass" autocomplete="new-password"></div>
      <div class="field"><label>${u ? 'Confirm new password' : 'Confirm password'}</label><input type="password" id="u_pass2" autocomplete="new-password"></div>
      ${u ? `<label class="switch" style="margin-top:4px"><input type="checkbox" id="u_active" ${u.active ? 'checked' : ''}> Account enabled (can log in)</label>` : ''}
      <div class="hint" style="margin-top:12px">Username minimum 3 characters, password minimum 4 characters.</div>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveUser">${u ? 'Save changes' : 'Add user'}</button>`);

    $('#saveUser').addEventListener('click', async () => {
      try {
        const username = $('#u_name').value.trim();
        const pass = $('#u_pass').value;
        const pass2 = $('#u_pass2').value;
        if (!username) return toast('Username is required', 'err');
        if (pass || !u) {
          if (pass.length < 4) return toast('Password must be at least 4 characters', 'err');
          if (pass !== pass2) return toast('Passwords do not match', 'err');
        }
        if (u) {
          const body = { username };
          if (pass) body.password = pass;
          if ($('#u_active')) body.active = $('#u_active').checked;
          await api('/api/users/' + u.id, { method: 'PUT', body });
        } else {
          await api('/api/users', { method: 'POST', body: { username, password: pass } });
        }
        closeModal();
        await render();
        toast(u ? 'User updated' : 'User added', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  };

  const openPasswordModal = () => {
    openModal('Change my password', `
      <div class="field"><label>Current password</label><input type="password" id="p_old" autocomplete="current-password"></div>
      <div class="row c2">
        <div class="field"><label>New password</label><input type="password" id="p_new" autocomplete="new-password"></div>
        <div class="field"><label>Confirm new password</label><input type="password" id="p_new2" autocomplete="new-password"></div>
      </div>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="savePass">Update password</button>`);

    $('#savePass').addEventListener('click', async () => {
      try {
        const np = $('#p_new').value;
        if (np.length < 4) return toast('New password must be at least 4 characters', 'err');
        if (np !== $('#p_new2').value) return toast('Passwords do not match', 'err');
        await api('/api/auth/change-password', { method: 'POST', body: { old_password: $('#p_old').value, new_password: np } });
        closeModal();
        toast('Password changed', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  };

  view.innerHTML = `
    <div class="toolbar">
      <div class="grow"><span class="hint">Everyone who uses this computer gets their own login. You are signed in as <b>${h(state.user ? state.user.username : '')}</b>.</span></div>
      <button class="btn" id="changeMyPass">Change my password</button>
      <button class="btn primary" id="addUser">+ Add user</button>
    </div>
    <div class="card"><div id="userRows"><div class="empty">Loading\u2026</div></div></div>`;

  $('#addUser').addEventListener('click', () => openUserModal(null));
  $('#changeMyPass').addEventListener('click', openPasswordModal);
  await render();
}

/* =============================== reports =============================== */
async function viewReports(view) {
  let year = '';
  const load = async () => {
    const data = await api('/api/reports' + (year ? '?year=' + year : ''));
    $('#yearSel').innerHTML = `<option value="">All years</option>` +
      data.years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');

    const totalBilled = data.monthly.reduce((s, m) => s + m.billed, 0);
    const totalAdv = data.monthly.reduce((s, m) => s + m.advance, 0);
    const totalDue = data.monthly.reduce((s, m) => s + m.outstanding, 0);

    $('#reportBody').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">Billed</div><div class="v">${money(totalBilled)}</div><div class="d">${data.monthly.length} billing months</div></div>
        <div class="stat g"><div class="k">Advances received</div><div class="v">${money(totalAdv)}</div><div class="d">collected upfront</div></div>
        <div class="stat o"><div class="k">Outstanding</div><div class="v">${money(totalDue)}</div><div class="d">yet to be collected</div></div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-h"><h3>Monthly billing</h3></div>
          <div class="card-b" style="padding-top:6px">
            ${data.monthly.length ? `<table class="grid">
              <thead><tr><th>Month</th><th class="num">Bills</th><th class="num">Entries</th><th class="num">Billed</th><th class="num">Advance</th><th class="num">Outstanding</th></tr></thead>
              <tbody>${data.monthly.map((m) => `<tr>
                <td class="strong">${h(m.ym)}</td><td class="num">${m.bills}</td><td class="num">${m.entries}</td>
                <td class="num">${money(m.billed)}</td><td class="num">${money(m.advance)}</td>
                <td class="num">${money(m.outstanding)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No data</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h3>Customer totals</h3></div>
          <div class="card-b" style="padding-top:6px">
            ${data.customers.length ? `<table class="grid">
              <thead><tr><th>Customer</th><th class="num">Bills</th><th class="num">Billed</th><th class="num">Advance</th><th class="num">Due</th></tr></thead>
              <tbody>${data.customers.map((c) => `<tr>
                <td class="strong">${h(c.name) || '-'}</td><td class="num">${c.bills}</td>
                <td class="num">${money(c.billed)}</td><td class="num">${money(c.advance)}</td>
                <td class="num">${money(c.outstanding)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No data</div>'}
          </div>
        </div>
      </div>

      <div class="two-col" style="margin-top:18px">
        <div class="card">
          <div class="card-h"><h3>Vehicle totals</h3></div>
          <div class="card-b" style="padding-top:6px">
            ${data.vehicles.length ? `<table class="grid">
              <thead><tr><th>Vehicle</th><th class="num">Trips</th><th class="num">Billed</th><th class="num">Advance</th><th class="num">Due</th></tr></thead>
              <tbody>${data.vehicles.map((v) => `<tr>
                <td class="strong mono">${h(v.number) || '-'}</td><td class="num">${v.trips}</td>
                <td class="num">${money(v.billed)}</td><td class="num">${money(v.advance)}</td>
                <td class="num">${money(v.outstanding)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No data</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h3>Unpaid bills</h3></div>
          <div class="card-b" style="padding-top:6px">
            ${data.outstanding.length ? `<table class="grid">
              <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th class="num">Due</th></tr></thead>
              <tbody>${data.outstanding.map((b) => `<tr>
                <td><a href="#/bills/${b.id}">#${h(b.bill_number)}</a></td><td>${fmtDate(b.bill_date)}</td>
                <td>${h(b.customer_name) || '-'}</td><td class="num strong">${money(b.due)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">All clear \u2014 nothing pending</div>'}
          </div>
        </div>
      </div>`;
  };

  view.innerHTML = `
    <div class="toolbar">
      <label style="margin:0">Year</label>
      <select id="yearSel"><option value="">All years</option></select>
      <span class="hint">Figures exclude cancelled bills.</span>
    </div>
    <div id="reportBody"><div class="card"><div class="empty">Loading\u2026</div></div></div>`;

  await load();
  $('#yearSel').addEventListener('change', async (e) => { year = e.target.value; await load(); });
}

/* =============================== settings =============================== */
async function viewSettings(view) {
  await loadGlobals();
  const c = state.company || {};

  view.innerHTML = `
    <div class="two-col">
      <div class="card">
        <div class="card-h"><h3>Company profile</h3></div>
        <div class="card-b">
          <div class="field"><label>Company name *</label><input type="text" id="s_name" value="${h(c.name || '')}"></div>
          <div class="field"><label>Address</label><input type="text" id="s_address" value="${h(c.address || '')}"></div>
          <div class="row c2">
            <div class="field"><label>Phone</label><input type="tel" id="s_phone" value="${h(c.phone || '')}"></div>
            <div class="field"><label>Email</label><input type="email" id="s_email" value="${h(c.email || '')}"></div>
          </div>
          <div class="field"><label>GSTIN (optional)</label><input type="text" id="s_gstin" value="${h(c.gstin || '')}"></div>
          <div class="field"><label>Footer note</label><input type="text" id="s_footer" value="${h(c.footer_note || '')}"></div>
          <div class="field"><label>Default bill format</label>
            <select id="s_layout">
              <option value="portrait" ${c.bill_layout !== 'landscape' ? 'selected' : ''}>Vertical \u00b7 A4 Portrait</option>
              <option value="landscape" ${c.bill_layout === 'landscape' ? 'selected' : ''}>Horizontal \u00b7 A4 Landscape</option>
            </select>
            <div class="hint" style="margin-top:6px">Used for new bills \u2014 each bill can override it in the editor.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h3>Bank details &amp; logo</h3></div>
        <div class="card-b">
          <div class="field"><label>Bank name</label><input type="text" id="s_bank" value="${h(c.bank_name || '')}"></div>
          <div class="row c2">
            <div class="field"><label>A/C number</label><input type="text" id="s_acct" value="${h(c.account_no || '')}"></div>
            <div class="field"><label>IFSC</label><input type="text" id="s_ifsc" value="${h(c.ifsc || '')}"></div>
          </div>
          <div class="field">
            <label>Logo</label>
            <div style="display:flex;gap:12px;align-items:center">
              <img id="logoPreview" src="${c.logo || ''}" alt="" style="width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff;display:${c.logo ? 'block' : 'none'}">
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <label class="btn" style="cursor:pointer">Upload image<input type="file" id="s_logo" accept="image/*" hidden></label>
                ${c.logo ? '<button class="btn danger" id="removeLogo">Remove</button>' : ''}
              </div>
            </div>
            <div class="hint" style="margin-top:6px">Shown on the printed bill and PDF.</div>
          </div>
          <div style="display:flex;gap:9px;margin-top:18px">
            <button class="btn primary" id="saveSettings">Save settings</button>
            <a class="btn" href="#/dashboard">Cancel</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-h"><h3>Preview</h3></div>
      <div class="card-b">
        <div class="preview-wrap"><iframe class="preview-frame" id="settingsPreview" style="height:520px"></iframe></div>
      </div>
    </div>`;

  const readForm = () => ({
    name: $('#s_name').value.trim(),
    address: $('#s_address').value.trim(),
    phone: $('#s_phone').value.trim(),
    email: $('#s_email').value.trim(),
    gstin: $('#s_gstin').value.trim(),
    footer_note: $('#s_footer').value.trim(),
    bill_layout: $('#s_layout').value,
    bank_name: $('#s_bank').value.trim(),
    account_no: $('#s_acct').value.trim(),
    ifsc: $('#s_ifsc').value.trim(),
    logo: $('#logoPreview').style.display === 'none' ? '' : ($('#logoPreview').src || ''),
  });

  let logoData = c.logo || '';
  $('#logoPreview').style.display = logoData ? 'block' : 'none';
  $('#logoPreview').src = logoData;

  $('#s_logo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 600 * 1024) return toast('Please use an image under 600 KB', 'err');
    const r = new FileReader();
    r.onload = () => {
      logoData = r.result;
      $('#logoPreview').src = logoData;
      $('#logoPreview').style.display = 'block';
    };
    r.readAsDataURL(file);
  });

  const rm = $('#removeLogo');
  if (rm) rm.addEventListener('click', () => { logoData = ''; $('#logoPreview').style.display = 'none'; });

  $('#saveSettings').addEventListener('click', async () => {
    try {
      const body = readForm();
      body.logo = logoData;
      if (!body.name) return toast('Company name is required', 'err');
      await api('/api/company', { method: 'PUT', body });
      await loadGlobals();
      toast('Settings saved', 'ok');
      viewSettings(view);
    } catch (e) { toast(e.message, 'err'); }
  });

  const refreshPreview = async () => {
    const sample = {
      bill_number: '000', bill_date: new Date().toISOString().slice(0, 10), billing_month: 'Preview',
      customer_name: 'Sample Customer', customer_address: '', customer_gstin: '',
      gst_enabled: false, gst_rate: 0, gst_type: 'intra', adjustments: 0, adjustment_note: '', notes: '',
      status: 'active',
      layout: $('#s_layout').value,
      items: [{ month: 'August', vehicle_number: 'MH14XX0000', route: 'Sample route', rate: 110000, advance: 0, balance: 110000 }],
    };
    try {
      const html = await api('/api/bills/preview', { method: 'POST', body: sample });
      $('#settingsPreview').srcdoc = html;
    } catch (e) { /* ignore */ }
  };
  $('#s_layout').addEventListener('change', refreshPreview);
  refreshPreview();
}

/* =============================== backup =============================== */
async function viewBackup(view) {
  view.innerHTML = `
    <div class="two-col">
      <div class="card">
        <div class="card-h"><h3>Export backup</h3></div>
        <div class="card-b">
          <p class="hint">Downloads every bill, customer, vehicle, setting and change-history record as a single JSON file. Keep copies somewhere safe.</p>
          <button class="btn primary" id="doExport">Download backup file</button>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Restore from backup</h3></div>
        <div class="card-b">
          <p class="hint"><b style="color:var(--danger)">Warning:</b> restoring replaces ALL current data with the contents of the backup file.</p>
          <label class="btn" style="cursor:pointer;display:inline-block">Choose backup file<input type="file" id="restoreFile" accept="application/json" hidden></label>
          <div class="hint" id="restoreInfo" style="margin-top:10px"></div>
        </div>
      </div>
    </div>`;

  $('#doExport').addEventListener('click', () => download('/api/backup/export', `bill-backup-${new Date().toISOString().slice(0, 10)}.json`));

  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (_) { return toast('That file is not valid JSON', 'err'); }

    $('#restoreInfo').innerHTML = `File: <b>${h(file.name)}</b> \u00b7 ${data.bills ? data.bills.length : 0} bills, ${data.customers ? data.customers.length : 0} customers, ${data.vehicles ? data.vehicles.length : 0} vehicles.`;
    if (!confirmBox('Restore this backup? ALL current data will be replaced.')) return;
    try {
      const r = await api('/api/backup/restore', { method: 'POST', body: data });
      await loadGlobals();
      toast(`Restored ${r.bills} bills, ${r.customers} customers, ${r.vehicles} vehicles`, 'ok');
      $('#billCountBadge').textContent = '';
      location.hash = '#/dashboard';
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* =============================== auth =============================== */
function showLogin() {
  const s = $('#loginScreen');
  if (!s) return;
  s.hidden = false;
  $('.layout').style.display = 'none';
  $('#loginErr').textContent = '';
  $('#loginPass').value = '';
  setTimeout(() => { const u = $('#loginUser'); if (u) u.focus(); }, 60);
}

async function startApp(user) {
  state.user = user || null;
  $('#loginScreen').hidden = true;
  $('.layout').style.display = '';
  $('#whoAmI').textContent = state.user ? state.user.username : '';
  try { await loadGlobals(); } catch (e) { /* ignore */ }
  $('#billCountBadge').textContent = '';
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

function bindAuth() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true;
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value },
      });
      $('#loginPass').value = '';
      await startApp(r.user);
      toast(`Welcome, ${r.user.username}`, 'ok');
    } catch (err) {
      $('#loginErr').textContent = err.message;
      $('#loginPass').select();
    } finally {
      btn.disabled = false;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
    showLogin();
    toast('Signed out', 'ok');
  });
}

/* =============================== boot =============================== */
(async function boot() {
  bindAuth();
  try {
    const me = await api('/api/auth/me');
    await startApp(me.user || me);
  } catch (e) {
    showLogin();
  }
})();
