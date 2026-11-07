'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('../lib/robots');
const { audit } = require('../lib/audit');
const { lintTemplate } = require('../lib/liquid');

const sample = (name) => fs.readFileSync(path.join(__dirname, '..', 'samples', name), 'utf8');
const ids = (r) => r.findings.map((x) => x.id);
const run = (txt, opts) => audit(parse(txt), opts || {});

test('clean sample has no errors or warnings', () => {
  const r = run(sample('robots-clean.txt'), { host: 'example-store.com', status: 200, contentType: 'text/plain; charset=utf-8' });
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.warnings, 0);
});

test('Disallow: / is reported as an error for *, Googlebot and Bingbot', () => {
  const r = run(sample('robots-staging-leftover.txt'));
  assert.strictEqual(r.findings.filter((x) => x.id === 'blocks-everything').length, 3);
  assert.ok(r.errors >= 3);
});

test('blocked collections are caught, and Allow overrides are respected', () => {
  const r = run('User-agent: *\nDisallow: /collections/\nAllow: /collections/all\nSitemap: https://s.com/sitemap.xml');
  const blocked = r.findings.filter((x) => x.id === 'blocks-catalog').map((x) => x.message);
  assert.ok(blocked.some((m) => m.includes('/collections/sample-collection')));
  assert.ok(!blocked.some((m) => m.includes('(/collections/all)')));
});

test('a Googlebot group can hide a wildcard block from Googlebot but not from other crawlers', () => {
  const r = run('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /');
  const who = r.findings.filter((x) => x.id === 'blocks-everything').map((x) => x.userAgent);
  assert.deepStrictEqual(who.sort(), ['*', 'Bingbot']);
});

test('sitemap problems: missing, relative, http, myshopify, host mismatch', () => {
  assert.ok(ids(run('User-agent: *\nDisallow: /admin')).includes('no-sitemap'));
  assert.ok(ids(run('User-agent: *\nSitemap: /sitemap.xml')).includes('sitemap-not-absolute'));
  assert.ok(ids(run('User-agent: *\nSitemap: http://shop.com/sitemap.xml')).includes('sitemap-http'));
  assert.ok(ids(run('User-agent: *\nSitemap: https://x.myshopify.com/sitemap.xml')).includes('sitemap-myshopify'));
  assert.ok(ids(run('User-agent: *\nSitemap: https://old.com/sitemap.xml', { host: 'new.com' })).includes('sitemap-host-mismatch'));
  assert.ok(!ids(run('User-agent: *\nSitemap: https://www.new.com/sitemap.xml', { host: 'new.com' })).includes('sitemap-host-mismatch'));
});

test('private paths left crawlable are a warning', () => {
  const r = run('User-agent: *\nDisallow: /admin\nSitemap: https://s.com/sitemap.xml');
  const f = r.findings.find((x) => x.id === 'private-paths-crawlable');
  assert.ok(f && f.message.includes('/cart') && !f.message.includes('/admin,'));
});

test('crawl-delay: info when small, warning when large', () => {
  assert.ok(ids(run('User-agent: bingbot\nCrawl-delay: 5')).includes('crawl-delay'));
  assert.ok(ids(run('User-agent: bingbot\nCrawl-delay: 60')).includes('large-crawl-delay'));
});

test('duplicate groups, conflicting rules and bad paths are flagged', () => {
  const r = run('User-agent: a\nDisallow: /x\nAllow: /x\nDisallow: nope\n\nUser-agent: a\nDisallow: /y');
  assert.ok(ids(r).includes('duplicate-group'));
  assert.ok(ids(r).includes('conflicting-rules'));
  assert.ok(ids(r).includes('bad-path'));
});

test('fetch-level problems: 404, 5xx, HTML content type, oversize file', () => {
  assert.ok(ids(run('', { status: 404 })).includes('no-robots-file'));
  assert.ok(ids(run('', { status: 503 })).includes('robots-server-error'));
  assert.ok(ids(run('User-agent: *', { contentType: 'text/html' })).includes('wrong-content-type'));
  assert.ok(ids(run('User-agent: *\n' + '# pad\n'.repeat(90000))).includes('file-too-large'));
});

test('AI crawler status is informational and reflects the file', () => {
  const r = run('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin');
  const f = r.findings.find((x) => x.id === 'ai-crawlers');
  assert.strictEqual(f.severity, 'info');
  assert.strictEqual(f.aiCrawlers.find((a) => a.ua === 'GPTBot').allowed, false);
  assert.strictEqual(f.aiCrawlers.find((a) => a.ua === 'ClaudeBot').allowed, true);
});

test('findings are sorted errors, then warnings, then info', () => {
  const r = run(sample('robots-broken.txt'));
  const order = r.findings.map((x) => ({ error: 0, warn: 1, info: 2 })[x.severity]);
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
});

// --- robots.txt.liquid -------------------------------------------------------

test('liquid: the recommended template is clean', () => {
  const r = lintTemplate(sample('robots.txt.liquid'));
  assert.deepStrictEqual(r.findings, []);
});

test('liquid: broken sample reports missing user-agent output, literal Disallow, protected removal', () => {
  const r = lintTemplate(sample('robots-broken.txt.liquid'));
  assert.ok(ids(r).includes('user-agent-not-output'));
  assert.ok(ids(r).includes('literal-disallow-all'));
  assert.ok(ids(r).includes('removes-default-rule'));
  assert.ok(ids(r).includes('no-sitemap-line'));
});

test('liquid: unbalanced tags are an error', () => {
  const r = lintTemplate('{% for g in robots.default_groups %}{{ g.user_agent }}');
  assert.ok(r.findings.some((x) => x.id === 'unbalanced-tag' && x.message.includes('endfor')));
});

test('liquid: template that ignores robots.default_groups is warned', () => {
  const r = lintTemplate('User-agent: *\nDisallow: /admin\nSitemap: https://s.com/sitemap.xml\n');
  assert.ok(ids(r).includes('no-default-groups'));
  assert.ok(ids(r).includes('static-file'));
});

test('liquid: removing the /policies/ rule is only informational', () => {
  const src = sample('robots.txt.liquid').replace(
    '{{ rule }}',
    "{%- unless rule.directive == 'Disallow' and rule.value == '/policies/' -%}{{ rule }}{%- endunless -%}"
  );
  const r = lintTemplate(src);
  const f = r.findings.find((x) => x.id === 'removes-default-rule');
  assert.strictEqual(f.severity, 'info');
  assert.strictEqual(r.errors, 0);
});

test('liquid: looping rules without printing them is an error', () => {
  const r = lintTemplate('{% for group in robots.default_groups %}{{ group.user_agent }}{% for rule in group.rules %}{% endfor %}{{ group.sitemap }}{% endfor %}');
  assert.ok(ids(r).includes('rules-not-output'));
});
