#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parse, canFetch } = require('../lib/robots');
const { audit } = require('../lib/audit');
const { lintTemplate } = require('../lib/liquid');
const { load } = require('../lib/source');

const HELP = `srta - Shopify robots.txt auditor

Usage:
  srta check <store-url | robots.txt file | ->        audit a live or saved robots.txt
  srta test  <store-url | file | -> <path>... [--ua <crawler>]
                                                      is each path crawlable? shows the deciding rule
  srta liquid <path/to/templates/robots.txt.liquid>   lint a robots.txt.liquid template

Options:
  --json        machine-readable output
  --strict      exit 1 on warnings as well as errors
  --ua <name>   crawler for "test" (default: Googlebot)
  --host <h>    host to compare Sitemap lines against (for local files)
  -h, --help    show this help

Exit codes: 0 clean, 1 errors (or warnings with --strict), 2 the tool could not run.
`;

function parseArgs(argv) {
  const args = { _: [], json: false, strict: false, ua: 'Googlebot', host: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--ua') args.ua = argv[++i];
    else if (a === '--host') args.host = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else args._.push(a);
  }
  return args;
}

function printFindings(title, result) {
  console.log(title + '\n');
  if (!result.findings.length) console.log('No findings.');
  for (const x of result.findings) {
    const tag = x.severity === 'error' ? '[ERROR]' : x.severity === 'warn' ? '[WARN ]' : '[INFO ]';
    console.log(`${tag} ${x.message}`);
  }
  console.log(`\n${result.errors} error(s), ${result.warnings} warning(s), ${result.info} info`);
}

function exitCode(result, strict) {
  if (result.errors > 0) return 1;
  if (strict && result.warnings > 0) return 1;
  return 0;
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (args.help || !cmd) {
    console.log(HELP);
    return args.help ? 0 : 2;
  }

  if (cmd === 'liquid') {
    const file = args._[1];
    if (!file) throw new Error('liquid needs a file path');
    const result = lintTemplate(fs.readFileSync(file, 'utf8'));
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printFindings(`robots.txt.liquid check: ${path.basename(file)}`, result);
    return exitCode(result, args.strict);
  }

  if (cmd === 'check' || cmd === 'test') {
    const input = args._[1];
    if (!input) throw new Error(`${cmd} needs a store URL, a file, or - for stdin`);
    const src = await load(input, { host: args.host });
    const parsed = parse(src.text);

    if (cmd === 'check') {
      const result = audit(parsed, { host: src.host, status: src.status, contentType: src.contentType });
      if (args.json) {
        console.log(JSON.stringify({ source: src.origin, status: src.status, groups: parsed.groups.length, sitemaps: parsed.sitemaps.map((s) => s.url), ...result }, null, 2));
      } else {
        console.log(`Source: ${src.origin} (HTTP ${src.status}, ${parsed.bytes} bytes, ${parsed.groups.length} group(s), ${parsed.sitemaps.length} sitemap(s))`);
        if (src.redirectedFrom) console.log(`Note: ${src.redirectedFrom} redirected to ${src.host}.`);
        console.log('');
        printFindings('robots.txt check', result);
      }
      return exitCode(result, args.strict);
    }

    const paths = args._.slice(2);
    if (!paths.length) throw new Error('test needs at least one path, for example /collections/all');
    const rows = paths.map((p) => {
      const r = canFetch(parsed, args.ua, p);
      return { path: p, userAgent: args.ua, allowed: r.allowed, rule: r.rule ? `${r.rule.directive === 'allow' ? 'Allow' : 'Disallow'}: ${r.rule.value} (line ${r.rule.line})` : null };
    });
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else
      for (const r of rows) {
        console.log(`${r.allowed ? 'ALLOWED' : 'BLOCKED'}  ${r.path}  ${r.rule ? '<- ' + r.rule : '(no matching rule)'}`);
      }
    return rows.some((r) => !r.allowed) ? 1 : 0;
  }

  throw new Error(`unknown command "${cmd}"`);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error('srta: ' + err.message);
    process.exit(2);
  }
);
