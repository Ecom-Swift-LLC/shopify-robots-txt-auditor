'use strict';

// Static checks for a theme's templates/robots.txt.liquid. This does not render
// the template (that needs Shopify's runtime); it reads the source for the
// mistakes that turn a customisation into a store-wide crawl block.

const PAIRS = [
  ['for', 'endfor'],
  ['if', 'endif'],
  ['unless', 'endunless'],
  ['case', 'endcase'],
  ['capture', 'endcapture'],
  ['comment', 'endcomment'],
  ['raw', 'endraw'],
];
const PROTECTED = ['/admin', '/cart', '/checkout', '/checkouts', '/orders', '/account', '/policies/'];

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function lintTemplate(source) {
  const text = String(source).replace(/^﻿/, '');
  const out = [];
  const add = (severity, id, message, line) => out.push(Object.assign({ severity, id, message }, line ? { line } : {}));

  // Tag balance.
  const tagRe = /{%-?\s*(\w+)/g;
  const counts = {};
  let m;
  while ((m = tagRe.exec(text))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  for (const [open, close] of PAIRS) {
    const a = counts[open] || 0;
    const b = counts[close] || 0;
    if (a !== b) {
      add('error', 'unbalanced-tag', `${a} {% ${open} %} but ${b} {% ${close} %}. Shopify will fail to render this template, and a failed render leaves the previous or default file in doubt.`);
    }
  }

  const usesDefaults = /robots\.default_groups/.test(text);
  if (!usesDefaults) {
    add(
      'warn',
      'no-default-groups',
      'The template never reads robots.default_groups, so none of Shopify\'s default rules are output. You are writing every rule yourself; check /admin, /cart, /checkout and the sort_by and search rules are all still there.'
    );
  }

  if (usesDefaults) {
    if (!/{{-?\s*group\.user_agent\b/.test(text)) {
      add(
        'error',
        'user-agent-not-output',
        'Loops over robots.default_groups but never outputs group.user_agent. The rules print without a User-agent line and attach to whichever group came before, or to none.'
      );
    }
    if (/group\.rules/.test(text) && !/{{-?\s*rule\s*-?}}/.test(text)) {
      add('error', 'rules-not-output', 'Loops over group.rules but never outputs {{ rule }}, so every default rule is dropped.');
    } else if (!/group\.rules/.test(text)) {
      add('error', 'rules-not-iterated', 'Reads robots.default_groups but never loops over group.rules, so every default rule is dropped.');
    }
    if (!/group\.sitemap/.test(text) && !/^\s*Sitemap:/im.test(text)) {
      add('warn', 'no-sitemap-line', 'Neither group.sitemap nor a literal Sitemap: line is output, so the Sitemap line disappears from robots.txt.');
    }
  } else if (!/^\s*Sitemap:/im.test(text)) {
    add('warn', 'no-sitemap-line', 'No Sitemap: line in the template.');
  }

  // A literal "Disallow: /" outside Liquid output.
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const bare = ln.trim();
    if (/^Disallow:\s*\/\s*$/i.test(bare)) {
      add('error', 'literal-disallow-all', `Literal "${bare}" blocks the whole site for whichever user-agent group it falls under.`, i + 1);
    }
    if (/{{\s*['"]\s*Disallow:\s*\/\s*['"]\s*}}/i.test(bare)) {
      add('error', 'literal-disallow-all', `"${bare}" outputs a site-wide Disallow.`, i + 1);
    }
  });

  // Removal of default rules.
  const removeRe = /rule\.directive\s*==\s*['"]Disallow['"]\s+and\s+rule\.value\s*==\s*['"]([^'"]+)['"]/gi;
  const removed = [];
  while ((m = removeRe.exec(text))) removed.push({ value: m[1], line: lineOf(text, m.index) });
  for (const r of removed) {
    if (PROTECTED.some((p) => r.value === p || r.value === p + '/')) {
      const note = r.value.startsWith('/policies')
        ? 'Removing the /policies/ disallow is a common, legitimate change.'
        : 'This path is private; confirm you really want it crawlable.';
      add(r.value.startsWith('/policies') ? 'info' : 'warn', 'removes-default-rule', `Removes the default "Disallow: ${r.value}" rule. ${note}`, r.line);
    } else {
      add('info', 'removes-default-rule', `Removes the default "Disallow: ${r.value}" rule.`, r.line);
    }
  }

  // Template runs but is it Liquid at all?
  if (!/{%|{{/.test(text)) {
    add('info', 'static-file', 'The file contains no Liquid. It works as a fixed robots.txt, but it will not pick up changes Shopify makes to the default rules.');
  }

  const order = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity]);
  const count = (s) => out.filter((x) => x.severity === s).length;
  return { findings: out, errors: count('error'), warnings: count('warn'), info: count('info') };
}

module.exports = { lintTemplate };
