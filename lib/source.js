'use strict';

const fs = require('fs');

// Load robots.txt text from a URL/domain, a file path, or stdin ("-").
// Returns { text, host, status, contentType, origin }.
async function load(input, opts) {
  const o = opts || {};
  if (input === '-') {
    return { text: fs.readFileSync(0, 'utf8'), host: o.host || null, status: 200, contentType: 'text/plain', origin: 'stdin' };
  }
  if (fs.existsSync(input) && fs.statSync(input).isFile()) {
    return { text: fs.readFileSync(input, 'utf8'), host: o.host || null, status: 200, contentType: 'text/plain', origin: input };
  }

  let url = input;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url);
  if (!/\/robots\.txt$/i.test(u.pathname)) u.pathname = '/robots.txt';
  u.search = '';
  u.hash = '';

  const fetchImpl = o.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error('This Node version has no fetch(). Use Node 18 or newer.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 15000);
  try {
    const res = await fetchImpl(u.toString(), {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'shopify-robots-txt-auditor/1.0 (+https://github.com/Ecom-Swift-LLC/shopify-robots-txt-auditor)' },
    });
    const text = await res.text();
    const finalHost = res.url ? new URL(res.url).hostname : u.hostname;
    return {
      text,
      host: finalHost,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      origin: res.url || u.toString(),
      redirectedFrom: finalHost !== u.hostname ? u.hostname : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { load };
