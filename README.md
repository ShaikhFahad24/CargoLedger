<<<<<<< HEAD
# Speedcold Bill Manager

Local, offline web application for creating, editing, searching, printing and downloading
logistics bills as professional A4 PDFs. Built with Node.js + Express + SQLite (no external
database server required).

## Run it

```bash
npm install     # first time only
npm start       # then open http://localhost:3000
```

All data is stored in `data/speedcold.db` on this computer. Nothing is sent anywhere.

## Login

The app opens on a login screen. The default account is:

```
username: fahad
password: aafiya
```

Passwords are stored salted + hashed (scrypt), never as plain text. After signing in you can
create any number of additional accounts under **Users** — rename them, reset their password,
disable them or delete them. Everyone can also change their own password from the Users screen.
You cannot delete or disable your own account, and at least one active user must always remain.
Sessions last 7 days (cookie-based); **Logout** ends one immediately.

## What it does

| Module | Functions |
|---|---|
| Login & users | Password login, add / rename / disable / delete users, change own password, 7-day sessions |
| Company settings | Edit company name, address, phone, email, logo, bank details, GSTIN, footer note, **default bill format** |
| Customers | Add, edit, delete, search customer profiles |
| Vehicles | Save vehicle number, type, driver and default rate (auto-fills bill rows) |
| Bill creation | Editable bill number, date, period, customer, unlimited vehicle rows |
| Bill format | Per-bill **vertical (A4 portrait)** or **horizontal (A4 landscape)** — used for print and PDF; default set in Company Settings |
| Automatic calculation | Balance = Rate − Advance; subtotal, adjustment, GST and total recalculate live |
| PDF generation | Live A4 preview, print, and real PDF download (uses installed Google Chrome) |
| Bill history | Search by bill number, customer, month, date, route or vehicle number |
| Editing & cancellation | Edit saved bills, mark cancelled / restore, full change history (audit log) |
| Reports | Monthly billing, customer totals, vehicle totals, advances, outstanding dues |
| Backup | Export everything to one JSON file, restore it later |

### Calculations

- `Balance = Rate − Advance` per row
- `Subtotal = sum of row rates`
- `Total = Subtotal + Adjustment + GST (optional)`
- `Balance due = Total − sum of advances`

GST is **optional per bill** (enable the toggle in the bill editor, choose CGST+SGST or IGST).

## Screens

- **Dashboard** – totals, monthly chart, recent bills, pending dues
- **Bills** – list with search/filters, open, edit, print, download PDF, cancel
- **Customers / Vehicles** – master data used while creating bills
- **Reports** – monthly, per-customer, per-vehicle and unpaid-bill summaries
- **Company Settings** – everything printed on the bill (pre-filled with SPEEDCOLD LOGISTIC details) + default bill format
- **Users** – create, rename, disable and delete login accounts, change your own password
- **Backup & Restore** – export / import all records as JSON

## Tests

```bash
npm test              # runs all three suites against an isolated throw-away database
npm run test:api      # API, calculations, audit log, PDF, backup/restore
npm run test:ui       # full browser flows (create, edit, cancel, search, deep links)
npm run test:layout   # responsive layout + A4 single-page fit checks
```

`npm test` starts its own server on port 3123 with a temporary database (`.test-data/`),
so it never modifies your real records. The individual `test:*` scripts expect a server
already running on `http://localhost:3000`.

## Files

```
server.js          REST API + auth/session middleware + static hosting + PDF rendering (Chrome via puppeteer-core)
db.js              SQLite schema, migrations, auth helpers, seed data (default user, SPEEDCOLD profile, bill 646), helpers
billTemplate.js    A4 bill HTML template (portrait/landscape, modern professional layout)
public/            SPA: index.html (incl. login screen), styles.css, app.js
data/              SQLite database (created on first run, git-ignored)
test/              automated test suites
```

## Notes

- PDF export uses the Google Chrome installed at the default location; override with the
  `CHROME_PATH` environment variable if yours is elsewhere.
- Port can be changed with `PORT=8080 npm start`.
- Deleting `data/` resets everything and re-seeds the SPEEDCOLD profile, sample bill 646 **and the default `fahad` user**.
- Every `/api/*` route except `/api/auth/login` requires a valid session (session cookie `sid`,
  or an `Authorization: Bearer <token>` header for scripts).
=======
# CargoLedger
A modern Transport Billing Management System designed to simplify transport operations, manage billing records, generate invoices, track payments, and maintain accurate financial transactions through an organized and user-friendly platform.
>>>>>>> 85eb0720593f4890caf5884106c4d0d5b13a70ce
