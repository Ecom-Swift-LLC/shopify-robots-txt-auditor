'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parse, canFetch, patternToRegExp } = require('../lib/robots');

test('parse: groups, consecutive user-agents share a group, sitemaps collected', () => {
  const p = parse('User-agent: a\nUser-agent: b\nDisallow: /x\n\nUser-agent: *\nAllow: /\nSitemap: https://s.com/sitemap.xml\n');
  assert.strictEqual(p.groups.length, 2);
  assert.deepStrictEqual(p.groups[0].agents, ['a', 'b']);
  assert.strictEqual(p.groups[0].rules[0].value, '/x');
  assert.strictEqual(p.sitemaps.length, 1);
});

test('parse: comments, BOM, CRLF and case-insensitive directive names', () => {
  const p = parse('﻿USER-AGENT: *\r\nDISALLOW: /a # trailing comment\r\n');
  assert.strictEqual(p.groups.length, 1);
  assert.strictEqual(p.groups[0].rules[0].value, '/a');
});

test('parse: orphan rules, typos, unsupported directives and missing colons are reported', () => {
  const p = parse('Disallow: /early\nUser-agent: *\nDissallow: /x\nNoindex: /y\njunk line\nCrawl-delay: abc\n');
  const kinds = p.issues.map((i) => i.kind).sort();
  assert.deepStrictEqual(kinds, ['bad-crawl-delay', 'no-colon', 'orphan-rule', 'unknown-directive', 'unsupported-directive']);
  assert.strictEqual(p.issues.find((i) => i.kind === 'unknown-directive').suggestion, 'disallow');
});

test('canFetch: empty file and no matching group allow everything', () => {
  assert.strictEqual(canFetch(parse(''), 'Googlebot', '/anything').allowed, true);
  assert.strictEqual(canFetch(parse('User-agent: Bingbot\nDisallow: /'), 'Googlebot', '/').allowed, true);
});

test('canFetch: Disallow / blocks everything for the wildcard group', () => {
  const r = canFetch(parse('User-agent: *\nDisallow: /'), 'Googlebot', '/products/a');
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.rule.line, 2);
});

test('canFetch: an empty Disallow allows everything', () => {
  assert.strictEqual(canFetch(parse('User-agent: *\nDisallow:'), 'x', '/a').allowed, true);
});

test('canFetch: longest match wins, Allow wins ties', () => {
  const p = parse('User-agent: *\nDisallow: /collections/\nAllow: /collections/best-sellers\nDisallow: /same\nAllow: /same');
  assert.strictEqual(canFetch(p, 'x', '/collections/other').allowed, false);
  assert.strictEqual(canFetch(p, 'x', '/collections/best-sellers').allowed, true);
  assert.strictEqual(canFetch(p, 'x', '/same').allowed, true);
});

test('canFetch: a specific user-agent group replaces the wildcard group', () => {
  const p = parse('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private');
  assert.strictEqual(canFetch(p, 'Googlebot/2.1', '/products/a').allowed, true);
  assert.strictEqual(canFetch(p, 'Googlebot', '/private/x').allowed, false);
  assert.strictEqual(canFetch(p, 'Bingbot', '/products/a').allowed, false);
});

test('canFetch: matching is case-insensitive for the agent, case-sensitive for paths', () => {
  const p = parse('User-agent: gptbot\nDisallow: /Secret');
  assert.strictEqual(canFetch(p, 'GPTBot', '/Secret').allowed, false);
  assert.strictEqual(canFetch(p, 'GPTBot', '/secret').allowed, true);
});

test('patterns: * wildcard and $ anchor', () => {
  assert.ok(patternToRegExp('/collections/*sort_by*').test('/collections/all?sort_by=price'));
  assert.ok(!patternToRegExp('/collections/*sort_by*').test('/collections/all'));
  assert.ok(patternToRegExp('/*.pdf$').test('/files/a.pdf'));
  assert.ok(!patternToRegExp('/*.pdf$').test('/files/a.pdf?x=1'));
  assert.ok(patternToRegExp('/a.b').test('/a.b'));
  assert.ok(!patternToRegExp('/a.b').test('/aXb'));
});

test('canFetch: matches against the query string', () => {
  const p = parse('User-agent: *\nDisallow: /*?q=*');
  assert.strictEqual(canFetch(p, 'x', '/search?q=shoes').allowed, false);
  assert.strictEqual(canFetch(p, 'x', '/search').allowed, true);
});
