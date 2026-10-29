'use strict';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n) => {
  const num = Number(n) || 0;
  const neg = num < 0;
  const [i, d] = Math.abs(num).toFixed(2).split('.');
  let out = '';
  if (i.length > 3) {
    const last3 = i.slice(-3);
    const rest = i.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  } else out = i;
  return (neg ? '-₹' : '₹') + out + (d === '00' ? '' : '.' + d);
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}-${m}-${y}` : iso;
};

function itemRows(items) {
  return items
    .map(
      (it, idx) => `
      <tr>
        <td class="c">${idx + 1}</td>
        <td>${esc(it.month) || '-'}</td>
        <td class="mono">${esc(it.vehicle_number) || '-'}</td>
        <td>${esc(it.route) || '-'}</td>
        <td class="num">${money(it.rate)}</td>
        <td class="num">${money(it.advance)}</td>
        <td class="num strong">${money(it.balance)}</td>
      </tr>`
    )
    .join('');
}

function taxRows(bill, t) {
  if (!bill.gst_enabled) return '';
  const gstLabel = bill.gst_type === 'intra' ? 'GST (CGST + SGST)' : 'IGST';
  let rows = '';
  if (bill.gst_type === 'intra') {
    rows += `<tr><td>CGST @ ${(t.gst_rate / 2).toFixed(2)}%</td><td class="num">${money(t.cgst)}</td></tr>`;
    rows += `<tr><td>SGST @ ${(t.gst_rate / 2).toFixed(2)}%</td><td class="num">${money(t.sgst)}</td></tr>`;
  } else {
    rows += `<tr><td>${gstLabel} @ ${t.gst_rate}%</td><td class="num">${money(t.igst)}</td></tr>`;
  }
  if (bill.adjustments) {
    rows += `<tr><td>Adjustments ${bill.adjustment_note ? `<span class="muted">(${esc(bill.adjustment_note)})</span>` : ''}</td><td class="num">${money(bill.adjustments)}</td></tr>`;
  }
  return rows;
}

function noTaxRows(bill, t) {
  if (bill.gst_enabled) return '';
  if (!bill.adjustments) return '';
  return `<tr><td>Adjustments ${bill.adjustment_note ? `<span class="muted">(${esc(bill.adjustment_note)})</span>` : ''}</td><td class="num">${money(bill.adjustments)}</td></tr>`;
}

function billHtml(company, bill) {
  const t = bill.totals;
  const c = company || {};
  const cancelled = bill.status === 'cancelled';
  const landscape = bill.layout === 'landscape';
  const pageSize = landscape ? 'A4 landscape' : 'A4 portrait';
  const pageWidth = landscape ? '273mm' : '186mm';
  const logo = c.logo ? `<img class="logo" src="${esc(c.logo)}" alt="logo">` : '';
  const contactLine = [c.address, c.phone, c.email].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bill ${esc(bill.bill_number)} - ${esc(c.name || '')}</title>
<style>
  @page { size: ${pageSize}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #16202c; font-size: 12.5px; }
  .page { width: 100%; max-width: ${pageWidth}; margin: 0 auto; padding: 0; }
  .topbar { height: 7px; background: linear-gradient(90deg, #0b3d66, #1273b8 55%, #23a06b); border-radius: 3px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding: 16px 0 12px; border-bottom: 2px solid #0b3d66; }
  .brand { display: flex; gap: 14px; align-items: center; }
  .logo { max-width: 66px; max-height: 66px; object-fit: contain; }
  .brand h1 { font-size: 25px; margin: 0; letter-spacing: .6px; color: #0b3d66; }
  .brand .addr { margin-top: 5px; color: #4a5a6a; font-size: 11.5px; line-height: 1.5; }
  .doc { text-align: right; }
  .doc .title { display: inline-block; background: #0b3d66; color: #fff; padding: 6px 14px; border-radius: 4px; font-size: 13px; letter-spacing: 2.5px; font-weight: 600; }
  .doc .meta { margin-top: 9px; font-size: 11.5px; color: #4a5a6a; line-height: 1.7; }
  .doc .meta b { color: #16202c; }
  .cancelled { display:inline-block; margin-top:8px; color:#b3261e; border:2px solid #b3261e; padding:3px 10px; border-radius:4px; font-weight:700; letter-spacing:2px; }
  .cards { display: flex; gap: 14px; margin: 16px 0; }
  .card { flex: 1; background: #f5f8fb; border: 1px solid #dde6ee; border-left: 4px solid #1273b8; border-radius: 5px; padding: 11px 14px; }
  .card h4 { margin: 0 0 7px; font-size: 10px; letter-spacing: 1.6px; color: #1273b8; text-transform: uppercase; }
  .card .big { font-size: 14.5px; font-weight: 700; }
  .card .sub { color: #4a5a6a; font-size: 11.5px; line-height: 1.55; margin-top: 3px; white-space: pre-line; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items th { background: #0b3d66; color: #fff; font-size: 11px; letter-spacing: .8px; text-transform: uppercase; padding: 9px 8px; text-align: left; font-weight: 600; }
  table.items td { padding: 9px 8px; border-bottom: 1px solid #e4ebf2; }
  table.items tbody tr:nth-child(even) { background: #f7fafc; }
  .c { text-align: center; } .num { text-align: right; white-space: nowrap; }
  .strong { font-weight: 600; } .mono { font-family: Consolas, "Courier New", monospace; }
  .muted { color: #7b8a99; font-weight: 400; }
  .bottom { display: flex; gap: 16px; margin-top: 18px; align-items: flex-start; }
  .bank { flex: 1.15; border: 1px dashed #9fb4c7; border-radius: 5px; padding: 12px 14px; background: #fbfcfe; }
  .bank h4 { margin: 0 0 8px; font-size: 10.5px; letter-spacing: 1.6px; color: #0b3d66; text-transform: uppercase; }
  .bank .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
  .bank .row span:first-child { color: #4a5a6a; }
  .bank .row span:last-child { font-weight: 600; font-family: Consolas, "Courier New", monospace; }
  .totals { flex: 1; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 7px 10px; font-size: 12.5px; }
  .totals tr td:first-child { color: #4a5a6a; }
  .totals tr td:last-child { text-align: right; font-weight: 600; }
  .totals .grand td { background: #0b3d66; color: #fff; font-size: 15px; font-weight: 700; padding: 10px; border-radius: 4px; }
  .totals .due td { background: #eaf6f0; color: #0a5c3c; font-weight: 700; }
  .signature { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
  .thanks { font-size: 12px; color: #4a5a6a; }
  .sign { text-align: center; min-width: 210px; }
  .sign .line { border-top: 1.5px solid #16202c; padding-top: 6px; font-weight: 700; letter-spacing: 1.4px; font-size: 12px; }
  .sign .role { color: #7b8a99; font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase; margin-top: 2px; }
  .footer { margin-top: 18px; border-top: 1px solid #e4ebf2; padding-top: 8px; text-align: center; color: #7b8a99; font-size: 10.5px; }
</style>
</head>
<body>
<div class="page">
  <div class="topbar"></div>
  <header>
    <div class="brand">
      ${logo}
      <div>
        <h1>${esc(c.name) || 'COMPANY NAME'}</h1>
        <div class="addr">${contactLine}</div>
      </div>
    </div>
    <div class="doc">
      <div class="title">${bill.gst_enabled ? 'TAX INVOICE' : 'LOGISTICS BILL'}</div>
      <div class="meta">
        Bill No: <b>${esc(bill.bill_number)}</b><br>
        Date: <b>${fmtDate(bill.bill_date)}</b>${bill.billing_month ? `<br>Period: <b>${esc(bill.billing_month)}</b>` : ''}
        ${cancelled ? '<div class="cancelled">CANCELLED</div>' : ''}
      </div>
    </div>
  </header>

  <div class="cards">
    <div class="card">
      <h4>Bill To</h4>
      <div class="big">${esc(bill.customer_name) || 'Walk-in Customer'}</div>
      <div class="sub">${esc(bill.customer_address) || ''}${bill.customer_gstin ? `\nGSTIN: ${esc(bill.customer_gstin)}` : ''}</div>
    </div>
    <div class="card">
      <h4>Summary</h4>
      <div class="big">${bill.items.length} vehicle entr${bill.items.length === 1 ? 'y' : 'ies'}</div>
      <div class="sub">Total ${money(t.total)}${bill.gst_enabled ? ' (incl. GST)' : ''}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="c" style="width:34px">Sr.</th>
        <th style="width:86px">Month</th>
        <th style="width:112px">Vehicle No.</th>
        <th>From / To</th>
        <th class="num" style="width:104px">Rate (₹)</th>
        <th class="num" style="width:104px">Advance (₹)</th>
        <th class="num" style="width:104px">Balance (₹)</th>
      </tr>
    </thead>
    <tbody>${itemRows(bill.items)}</tbody>
  </table>

  <div class="bottom">
    <div class="bank">
      <h4>Payment Details</h4>
      <div class="row"><span>Bank</span><span>${esc(c.bank_name) || '-'}</span></div>
      <div class="row"><span>A/C No.</span><span>${esc(c.account_no) || '-'}</span></div>
      <div class="row"><span>IFSC</span><span>${esc(c.ifsc) || '-'}</span></div>
      ${c.gstin ? `<div class="row"><span>Our GSTIN</span><span>${esc(c.gstin)}</span></div>` : ''}
      <div class="row"><span>Total Advance Received</span><span>${money(t.total_advance)}</span></div>
    </div>
    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td>${money(t.subtotal)}</td></tr>
        ${taxRows(bill, t)}
        ${noTaxRows(bill, t)}
        <tr class="grand"><td>Total Bill Amount</td><td>${money(t.total)}</td></tr>
        <tr><td>Advance Paid</td><td>${money(t.total_advance)}</td></tr>
        <tr class="due"><td>Balance Due</td><td>${money(t.outstanding)}</td></tr>
      </table>
    </div>
  </div>

  <div class="signature">
    <div class="thanks">
      ${bill.notes ? `<div style="margin-bottom:6px">${esc(bill.notes)}</div>` : ''}
      ${esc(c.footer_note) || 'Thank you for your business.'}
    </div>
    <div class="sign">
      <div class="line">${esc(c.name) || 'AUTHORIZED SIGNATORY'}</div>
      <div class="role">Authorized Signature</div>
    </div>
  </div>

  <div class="footer">This is a computer generated bill and does not require a physical signature.</div>
</div>
</body>
</html>`;
}

module.exports = { billHtml, money, esc, fmtDate };
