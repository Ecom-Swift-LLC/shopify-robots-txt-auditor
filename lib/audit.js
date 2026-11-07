'use strict';

const { canFetch } = require('./robots');

// Paths a normal Shopify store should let crawlers reach.
const MUST_CRAWL = [
  ['/', 'the home page'],
  ['/products/sample-product', 'product pages'],
  ['/collections/all', 'collection pages'],
  ['/collections/sample-collection', 'collection pages'],
  ['/blogs/news/sample-post', 'blog posts'],
  ['/pages/about-us', 'content pages'],
];

// Paths Shopify's default robots.txt disallows for all crawlers.
const SHOULD_BLOCK = [
  ['/admin', 'the admin'],
  ['/cart', 'the cart'],
  ['/checkout', 'checkout'],
  ['/checkouts/abc123', 'checkout sessions'],
  ['/orders/abc123', 'order status pages'],
  ['/account', 'customer accounts'],
];

// Parameter URLs Shopify's default file keeps out of the crawl.
const SHOULD_BLOCK_PARAMS = [
  ['/collections/all?sort_by=price-ascending', 'sort_by collection URLs'],
  ['/search?q=test', 'internal search results'],
];

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
];

const SIZE_LIMIT = 500 * 1024; // Google processes the first 500 KiB

const cap = (r) => r.directive.charAt(0).toUpperCase() + r.directive.slice(1);

function f(severity, id, message, extra) {
  return Object.assign({ severity, id, message }, extra || {});
}

// parsed: output of parse(). opts: { host, status, contentType }
function audit(parsed, opts) {
  const o = opts || {};
  const out = [];

  // --- fetch-level problems ------------------------------------------------
  if (o.status === 404 || o.status === 410) {
    out.push(
      f(
        'warn',
        'no-robots-file',
        `robots.txt returned ${o.status}. Crawlers treat that as "everything allowed", and Shopify normally serves a default file, so check this is the primary domain.`
      )
    );
  } else if (o.status >= 500) {
    out.push(
      f(
        'error',
        'robots-server-error',
        `robots.txt returned ${o.status}. Google treats a persistent server error as "disallow everything" until it recovers.`
      )
    );
  }
  if (o.contentType && !/text\/plain/i.test(o.contentType)) {
    out.push(
      f(
        'warn',
        'wrong-content-type',
        `robots.txt was served as "${o.contentType}", not text/plain. A password page or an HTML error page here means crawlers are not reading your rules.`
      )
    );
  }
  if (parsed.bytes > SIZE_LIMIT) {
    out.push(
      f(
        'warn',
        'file-too-large',
        `robots.txt is ${Math.round(parsed.bytes / 1024)} KiB. Google only processes the first 500 KiB, so rules after that point are ignored.`
      )
    );
  }

  // --- syntax --------------------------------------------------------------
  for (const issue of parsed.issues) {
    switch (issue.kind) {
      case 'no-colon':
        out.push(f('warn', 'syntax', `Line ${issue.line} has no colon and is ignored: "${issue.text}".`, { line: issue.line }));
        break;
      case 'unknown-directive':
        out.push(
          f(
            'warn',
            'unknown-directive',
            `Line ${issue.line}: "${issue.directive}" is not a robots.txt directive and is ignored.` +
              (issue.suggestion ? ` Did you mean "${issue.suggestion}"?` : ''),
            { line: issue.line }
          )
        );
        break;
      case 'unsupported-directive':
        out.push(
          f(
            'warn',
            'unsupported-directive',
            `Line ${issue.line}: "${issue.directive}" is not honoured by Google. To keep a page out of search results use a noindex meta tag or header, not robots.txt.`,
            { line: issue.line }
          )
        );
        break;
      case 'orphan-rule':
        out.push(
          f('error', 'orphan-rule', `Line ${issue.line}: "${issue.directive}" appears before any User-agent line, so it applies to no one.`, {
            line: issue.line,
          })
        );
        break;
      case 'bad-crawl-delay':
        out.push(f('warn', 'bad-crawl-delay', `Line ${issue.line}: Crawl-delay is not a number.`, { line: issue.line }));
        break;
      default:
        break;
    }
  }

  if (!parsed.groups.length) {
    out.push(f('info', 'no-groups', 'No User-agent groups found, so no crawler is restricted.'));
    return summarize(out);
  }

  // --- rule hygiene --------------------------------------------------------
  const seenAgents = new Map();
  parsed.groups.forEach((g) => {
    g.agents.forEach((a) => {
      const key = a.toLowerCase();
      if (seenAgents.has(key)) {
        out.push(
          f(
            'warn',
            'duplicate-group',
            `User-agent "${a}" has more than one group (lines ${seenAgents.get(key)} and ${g.line}). Google merges them; some other crawlers use only the first.`,
            { line: g.line }
          )
        );
      } else {
        seenAgents.set(key, g.line);
      }
    });
    const byValue = new Map();
    g.rules.forEach((r) => {
      if (r.value && !/^[/*]/.test(r.value)) {
        out.push(
          f('warn', 'bad-path', `Line ${r.line}: "${r.directive}: ${r.value}" does not start with "/" or "*", so it will not match anything.`, {
            line: r.line,
          })
        );
      }
      const prev = byValue.get(r.value);
      if (prev && prev.directive !== r.directive) {
        out.push(
          f('warn', 'conflicting-rules', `Lines ${prev.line} and ${r.line} both Allow and Disallow "${r.value}". The Allow wins, so the Disallow does nothing.`, {
            line: r.line,
          })
        );
      }
      byValue.set(r.value, r);
    });
    if (g.crawlDelay != null && g.crawlDelay > 10) {
      out.push(
        f(
          'warn',
          'large-crawl-delay',
          `Crawl-delay of ${g.crawlDelay}s for "${g.agents.join(', ')}" will slow indexing on crawlers that honour it (Bing does; Google ignores it).`,
          { line: g.line }
        )
      );
    } else if (g.crawlDelay != null) {
      out.push(
        f(
          'info',
          'crawl-delay',
          `Crawl-delay ${g.crawlDelay} for "${g.agents.join(', ')}". Google ignores this directive; Bing and some others honour it.`,
          { line: g.line }
        )
      );
    }
  });

  // --- can search engines reach the shop? ----------------------------------
  for (const ua of ['*', 'Googlebot', 'Bingbot']) {
    const label = ua === '*' ? 'All crawlers (*)' : ua;
    const home = canFetch(parsed, ua, '/');
    if (!home.allowed) {
      out.push(
        f(
          'error',
          'blocks-everything',
          `${label} cannot fetch the home page (line ${home.rule.line}: ${cap(home.rule)}: ${home.rule.value}). The store is invisible to that crawler. This is the usual leftover from a development or staging setup.`,
          { line: home.rule.line, userAgent: ua }
        )
      );
      continue;
    }
    for (const [p, what] of MUST_CRAWL) {
      if (p === '/') continue;
      const res = canFetch(parsed, ua, p);
      if (!res.allowed) {
        out.push(
          f('error', 'blocks-catalog', `${label} cannot fetch ${what} (${p}), blocked by line ${res.rule.line}: ${cap(res.rule)}: ${res.rule.value}.`, {
            line: res.rule.line,
            userAgent: ua,
          })
        );
      }
    }
  }

  const assetCheck = canFetch(parsed, 'Googlebot', '/cdn/shop/t/1/assets/theme.css');
  if (!assetCheck.allowed) {
    out.push(
      f(
        'warn',
        'blocks-assets',
        `Googlebot cannot fetch theme CSS/JS under /cdn/ (line ${assetCheck.rule.line}). Google renders pages like a browser; blocked assets can make a page look broken to it.`,
        { line: assetCheck.rule.line }
      )
    );
  }

  // --- the things Shopify's default file blocks ----------------------------
  const open = SHOULD_BLOCK.filter(([p]) => canFetch(parsed, '*', p).allowed);
  if (open.length) {
    out.push(
      f(
        'warn',
        'private-paths-crawlable',
        `These private paths are crawlable by "*": ${open.map(([p]) => p).join(', ')}. Shopify's default file disallows them; if a robots.txt.liquid edit removed those rules, put them back.`
      )
    );
  }
  const openParams = SHOULD_BLOCK_PARAMS.filter(([p]) => canFetch(parsed, '*', p).allowed);
  if (openParams.length) {
    out.push(
      f(
        'info',
        'parameter-urls-crawlable',
        `Crawlable by "*": ${openParams.map(([p, w]) => `${p} (${w})`).join('; ')}. These create near-duplicate URLs and burn crawl budget on larger catalogues. Shopify's default file blocks them.`
      )
    );
  }

  // --- sitemap -------------------------------------------------------------
  if (!parsed.sitemaps.length) {
    out.push(
      f(
        'warn',
        'no-sitemap',
        "No Sitemap line. Shopify's default file includes one at /sitemap.xml; without it crawlers rely on links and Search Console submission alone."
      )
    );
  }
  for (const s of parsed.sitemaps) {
    let u = null;
    try {
      u = new URL(s.url);
    } catch (e) {
      out.push(f('error', 'sitemap-not-absolute', `Line ${s.line}: Sitemap "${s.url}" is not an absolute URL. It must include https://.`, { line: s.line }));
      continue;
    }
    if (u.protocol === 'http:') {
      out.push(f('warn', 'sitemap-http', `Line ${s.line}: Sitemap uses http://. Use the https:// URL.`, { line: s.line }));
    }
    if (/\.myshopify\.com$/i.test(u.hostname)) {
      out.push(
        f('warn', 'sitemap-myshopify', `Line ${s.line}: Sitemap points at ${u.hostname}. It should use the primary custom domain, or crawlers index the wrong host.`, {
          line: s.line,
        })
      );
    } else if (o.host && u.hostname.replace(/^www\./, '') !== o.host.replace(/^www\./, '')) {
      out.push(
        f(
          'warn',
          'sitemap-host-mismatch',
          `Line ${s.line}: Sitemap host ${u.hostname} differs from the host this file was served from (${o.host}). Left over from a domain change?`,
          { line: s.line }
        )
      );
    }
  }

  // --- AI crawler access (information only) --------------------------------
  const status = AI_CRAWLERS.map((ua) => ({ ua, allowed: canFetch(parsed, ua, '/').allowed }));
  const blockedAi = status.filter((s) => !s.allowed).map((s) => s.ua);
  const allowedAi = status.filter((s) => s.allowed).map((s) => s.ua);
  out.push(
    f(
      'info',
      'ai-crawlers',
      (blockedAi.length ? `Blocked: ${blockedAi.join(', ')}. ` : '') +
        (allowedAi.length ? `Allowed: ${allowedAi.join(', ')}. ` : '') +
        'This is a request, not enforcement, and whether to allow each is a business decision. Blocking shopping assistants also removes you from their answers.',
      { aiCrawlers: status }
    )
  );

  return summarize(out);
}

function summarize(findings) {
  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const count = (s) => findings.filter((x) => x.severity === s).length;
  return { findings, errors: count('error'), warnings: count('warn'), info: count('info') };
}

module.exports = { audit, MUST_CRAWL, SHOULD_BLOCK, AI_CRAWLERS };
