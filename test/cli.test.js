'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'srta.js');
const S = (n) => path.join(__dirname, '..', 'samples', n);
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input });

test('clean file exits 0', () => {
  const r = run(['check', S('robots-clean.txt')]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 error\(s\), 0 warning\(s\)/);
});

test('broken file exits 1 and lists findings', () => {
  const r = run(['check', S('robots-broken.txt')]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\[ERROR\]/);
});

test('--strict turns warnings into exit 1', () => {
  const src = 'User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /checkouts/\nDisallow: /orders\nDisallow: /account\nDisallow: /search\nDisallow: /collections/*sort_by*\n';
  assert.strictEqual(run(['check', '-'], src).status, 0);
  assert.strictEqual(run(['check', '-', '--strict'], src).status, 1); // no Sitemap line is a warning
});

test('--json output parses and carries the counts', () => {
  const r = run(['check', S('robots-broken.txt'), '--json']);
  const j = JSON.parse(r.stdout);
  assert.ok(j.errors > 0 && Array.isArray(j.findings));
});

test('test command reports the deciding rule and exit code', () => {
  const r = run(['test', S('robots-clean.txt'), '/cart', '/products/a']);
  assert.match(r.stdout, /BLOCKED {2}\/cart {2}<- Disallow: \/cart \(line \d+\)/);
  assert.match(r.stdout, /ALLOWED {2}\/products\/a/);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(run(['test', S('robots-clean.txt'), '/products/a']).status, 0);
});

test('liquid command lints a template', () => {
  assert.strictEqual(run(['liquid', S('robots.txt.liquid')]).status, 0);
  assert.strictEqual(run(['liquid', S('robots-broken.txt.liquid')]).status, 1);
});

test('usage errors exit 2', () => {
  assert.strictEqual(run([]).status, 2);
  assert.strictEqual(run(['check']).status, 2);
  assert.strictEqual(run(['nonsense']).status, 2);
  assert.strictEqual(run(['liquid', S('does-not-exist.liquid')]).status, 2);
});

test('check fetches https-less URLs from a live server and flags a 404', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html>not found</html>');
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const child = spawn(process.execPath, [BIN, 'check', `http://127.0.0.1:${port}/some/page`, '--json']);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const code = await new Promise((resolve) => child.on('close', resolve));
  server.close();
  const j = JSON.parse(out);
  assert.strictEqual(j.status, 404);
  assert.ok(j.findings.some((f) => f.id === 'no-robots-file'));
  assert.ok(j.findings.some((f) => f.id === 'wrong-content-type'));
  assert.strictEqual(code, 0);
});
