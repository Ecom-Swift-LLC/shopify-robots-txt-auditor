'use strict';

// Parser and matcher for robots.txt, following RFC 9309 (the Robots Exclusion
// Protocol) with the two widely supported extensions: `*` and `$` in paths.

const KNOWN = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay']);
const COMMON_TYPOS = {
  useragent: 'user-agent',
  'user agent': 'user-agent',
  dissallow: 'disallow',
  dissalow: 'disallow',
  disalow: 'disallow',
  disallaw: 'disallow',
  alow: 'allow',
  sitemaps: 'sitemap',
  'site-map': 'sitemap',
  crawldelay: 'crawl-delay',
};
// Directives some crawlers understand but Google and Bing do not (or no longer) honour.
const IGNORED_BY_GOOGLE = new Set(['noindex', 'nofollow', 'host', 'clean-param', 'request-rate', 'visit-time']);

function parse(text) {
  const out = { groups: [], sitemaps: [], issues: [], bytes: Buffer.byteLength(String(text), 'utf8') };
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  let current = null;
  let lastWasAgent = false;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const noComment = raw.replace(/#.*$/, '').trim();
    if (!noComment) return;
    const idx = noComment.indexOf(':');
    if (idx === -1) {
      out.issues.push({ line: lineNo, kind: 'no-colon', text: raw.trim() });
      return;
    }
    const name = noComment.slice(0, idx).trim().toLowerCase();
    const value = noComment.slice(idx + 1).trim();

    if (!KNOWN.has(name)) {
      out.issues.push({
        line: lineNo,
        kind: IGNORED_BY_GOOGLE.has(name) ? 'unsupported-directive' : 'unknown-directive',
        directive: name,
        suggestion: COMMON_TYPOS[name] || null,
        text: raw.trim(),
      });
      return;
    }

    if (name === 'sitemap') {
      out.sitemaps.push({ url: value, line: lineNo });
      return;
    }

    if (name === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null, line: lineNo };
        out.groups.push(current);
      }
      current.agents.push(value);
      lastWasAgent = true;
      return;
    }

    lastWasAgent = false;
    if (!current) {
      out.issues.push({ line: lineNo, kind: 'orphan-rule', directive: name, text: raw.trim() });
      return;
    }
    if (name === 'crawl-delay') {
      const n = Number(value);
      if (Number.isNaN(n)) out.issues.push({ line: lineNo, kind: 'bad-crawl-delay', text: raw.trim() });
      else current.crawlDelay = n;
      return;
    }
    current.rules.push({ directive: name, value, line: lineNo });
  });

  return out;
}

// Turn a robots path pattern into a RegExp. `*` matches any run of characters,
// a trailing `$` anchors the end. Everything else is literal.
function patternToRegExp(pattern) {
  let anchored = false;
  let p = pattern;
  if (p.endsWith('$')) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const body = p
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

// Pick the group(s) that apply to a crawler. The most specific matching
// user-agent token wins; `*` is the fallback; no match means everything allowed.
function groupsFor(parsed, userAgent) {
  const ua = String(userAgent).toLowerCase();
  let best = -1;
  let matched = [];
  for (const g of parsed.groups) {
    for (const agent of g.agents) {
      const a = agent.toLowerCase();
      if (a === '*') continue;
      if (a && ua.includes(a)) {
        if (a.length > best) {
          best = a.length;
          matched = [g];
        } else if (a.length === best && !matched.includes(g)) {
          matched.push(g);
        }
      }
    }
  }
  if (matched.length) return matched;
  return parsed.groups.filter((g) => g.agents.some((a) => a === '*'));
}

// Is `pathAndQuery` (for example "/collections/all?sort_by=price") fetchable?
// Longest matching rule wins; on a tie, Allow wins (RFC 9309 section 2.2.2).
function canFetch(parsed, userAgent, pathAndQuery) {
  const groups = groupsFor(parsed, userAgent);
  const target = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
  let winner = null;
  for (const g of groups) {
    for (const rule of g.rules) {
      if (rule.value === '') continue; // "Disallow:" with no value allows everything
      if (!patternToRegExp(rule.value).test(target)) continue;
      const len = rule.value.length;
      if (
        !winner ||
        len > winner.value.length ||
        (len === winner.value.length && rule.directive === 'allow' && winner.directive !== 'allow')
      ) {
        winner = rule;
      }
    }
  }
  return {
    allowed: !winner || winner.directive === 'allow',
    rule: winner,
    matchedGroups: groups.length,
  };
}

module.exports = { parse, canFetch, groupsFor, patternToRegExp };
