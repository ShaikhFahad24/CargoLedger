import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.TEST_PORT || '3123';
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(root, '.test-data');

// fresh throw-away database so tests never touch real records
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT, DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/company');
      // 401 = server is up but the endpoint now requires login
      if (r.ok || r.status === 401) return;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start on port ' + PORT);
}

const suites = ['api.test.mjs', 'ui.test.mjs', 'layout.test.mjs'];
let failed = 0;

try {
  await waitReady();
  for (const s of suites) {
    console.log(`\n=== ${s} ===`);
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join('test', s)], {
        cwd: root,
        env: { ...process.env, BASE_URL: BASE },
        stdio: 'inherit',
      });
      p.on('close', resolve);
    });
    if (code !== 0) { failed++; console.log(`>>> FAILED: ${s}`); }
  }
} catch (e) {
  console.error(e.message);
  failed++;
} finally {
  server.kill();
}

await new Promise((r) => setTimeout(r, 700));
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* may still be locked */ }

console.log(failed ? `\n${failed} test suite(s) failed` : '\nALL TEST SUITES PASSED');
process.exit(failed ? 1 : 0);
