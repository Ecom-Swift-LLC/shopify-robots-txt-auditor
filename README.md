# shopify-robots-txt-auditor

A zero-dependency CLI that reads your Shopify store's `robots.txt` the way Google does and tells you what it actually blocks: a leftover `Disallow: /`, collections that crawlers cannot reach, a missing or wrong Sitemap line, a cart and checkout that are suddenly crawlable, and typos that silently turn a rule into nothing. It also lints your `robots.txt.liquid` template, and answers the question "can Googlebot fetch this URL, and which line decides it?"

**Not sure your store's SEO and speed basics are covered?** [Run the free audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-robots-txt-auditor) - it checks SEO, speed, CRO and AI-visibility signals on a live store in about a minute.

## Example output

Run against `samples/robots-broken.txt` in this repo, which plants these mistakes on purpose:

```
$ srta check samples/robots-broken.txt

robots.txt check

[ERROR] Line 2: "disallow" appears before any User-agent line, so it applies to no one.
[ERROR] All crawlers (*) cannot fetch collection pages (/collections/all), blocked by line 5: Disallow: /collections/.
[ERROR] All crawlers (*) cannot fetch collection pages (/collections/sample-collection), blocked by line 5: Disallow: /collections/.
[ERROR] Googlebot cannot fetch blog posts (/blogs/news/sample-post), blocked by line 14: Disallow: /blogs/.
[ERROR] Bingbot cannot fetch collection pages (/collections/all), blocked by line 5: Disallow: /collections/.
[ERROR] Bingbot cannot fetch collection pages (/collections/sample-collection), blocked by line 5: Disallow: /collections/.
[ERROR] Line 22: Sitemap "/sitemap.xml" is not an absolute URL. It must include https://.
[WARN ] Line 9: "dissallow" is not a robots.txt directive and is ignored. Did you mean "disallow"?
[WARN ] Line 10: "noindex" is not honoured by Google. To keep a page out of search results use a noindex meta tag or header, not robots.txt.
[WARN ] Line 8: "disallow: products/hidden" does not start with "/" or "*", so it will not match anything.
[WARN ] Crawl-delay of 30s for "Googlebot" will slow indexing on crawlers that honour it (Bing does; Google ignores it).
[WARN ] User-agent "Googlebot" has more than one group (lines 12 and 16). Google merges them; some other crawlers use only the first.
[WARN ] These private paths are crawlable by "*": /admin, /cart, /checkout, /checkouts/abc123, /orders/abc123, /account. Shopify's default file disallows them; if a robots.txt.liquid edit removed those rules, put them back.
[WARN ] Line 23: Sitemap uses http://. Use the https:// URL.
[WARN ] Line 23: Sitemap points at shop-name.myshopify.com. It should use the primary custom domain, or crawlers index the wrong host.
[INFO ] Crawlable by "*": /search?q=test (internal search results). These create near-duplicate URLs and burn crawl budget on larger catalogues. Shopify's default file blocks them.
[INFO ] Blocked: GPTBot. Allowed: OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Applebot-Extended. This is a request, not enforcement, and whether to allow each is a business decision. Blocking shopping assistants also removes you from their answers.

7 error(s), 8 warning(s), 2 info
```

`samples/robots-clean.txt` is a shortened file in the shape of Shopify's default and exits `0`. `samples/robots-staging-leftover.txt` is the most expensive two lines in e-commerce SEO: `User-agent: *` / `Disallow: /`.

Ask what a single rule does to a single URL:

```
$ srta test samples/robots-clean.txt /cart "/collections/all?sort_by=price" /products/trail-backpack --ua Googlebot

BLOCKED  /cart  <- Disallow: /cart (line 6)
BLOCKED  /collections/all?sort_by=price  <- Disallow: /collections/*sort_by* (line 11)
ALLOWED  /products/trail-backpack  (no matching rule)
```

And lint a `templates/robots.txt.liquid` before you save it to your theme:

```
$ srta liquid samples/robots-broken.txt.liquid

[ERROR] Loops over robots.default_groups but never outputs group.user_agent. The rules print without a User-agent line and attach to whichever group came before, or to none.
[ERROR] Literal "Disallow: /" blocks the whole site for whichever user-agent group it falls under.
[WARN ] Neither group.sitemap nor a literal Sitemap: line is output, so the Sitemap line disappears from robots.txt.
[WARN ] Removes the default "Disallow: /checkout" rule. This path is private; confirm you really want it crawlable.

2 error(s), 2 warning(s), 0 info
```

## Features

- **Reads the live file or a saved one.** `srta check your-store.com`, `srta check ./robots.txt`, or pipe it in with `-`. It follows redirects, reports the HTTP status and content type, and notes when your domain redirected to another host.
- **A real matcher, not a text search.** Implements the [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) rules: the most specific user-agent group wins, `*` and `$` patterns work, the longest matching rule wins, and `Allow` beats `Disallow` on a tie. So a `Googlebot` group correctly replaces the `*` group for Googlebot, which is how a block can hide from one crawler and not another.
- **"Can the store be found?" checks.** For `*`, Googlebot and Bingbot it tests the home page, a product, collections, a blog post and a content page, and names the exact line that blocks each.
- **Shopify-shaped checks.** Private paths (`/admin`, `/cart`, `/checkout`, `/orders`, `/account`) left crawlable, `sort_by` and internal-search URLs left crawlable, theme CSS/JS under `/cdn/` blocked, a Sitemap line pointing at `*.myshopify.com` or at the wrong host after a domain change.
- **Syntax problems that fail silently.** Rules before any `User-agent`, misspelt directives (`Dissallow`) with a suggestion, `Noindex:` lines Google ignores, paths that do not start with `/` or `*`, duplicate groups, Allow/Disallow on the same path, non-numeric or very large `Crawl-delay`.
- **File-level problems.** 404, 5xx (Google treats a persistent server error as "disallow everything"), an HTML page served instead of text, and files over Google's 500 KiB processing limit.
- **`robots.txt.liquid` linter.** Unbalanced tags, a loop over `robots.default_groups` that forgets to print `group.user_agent` or `{{ rule }}`, a literal `Disallow: /`, a dropped Sitemap line, and which default rules you removed.
- **AI crawler visibility.** Reports whether GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, CCBot and Applebot-Extended are allowed or blocked. Information only; no judgement on which you should want.
- **CI-friendly.** Exit `0` clean, `1` on errors (or warnings with `--strict`), `2` if the tool could not run. `--json` for machine-readable output.

## Installation

Needs Node 18 or newer. No `npm install` step: there are no dependencies.

```bash
git clone https://github.com/Ecom-Swift-LLC/shopify-robots-txt-auditor.git
cd shopify-robots-txt-auditor
node bin/srta.js --help
```

Optionally `npm link` to get an `srta` command on your path.

## Usage

```bash
# audit a live store (the primary domain, not the .myshopify.com one)
node bin/srta.js check your-store.com

# audit a saved file, or stdin
node bin/srta.js check ./robots.txt
curl -s https://your-store.com/robots.txt | node bin/srta.js check - --host your-store.com

# is this URL crawlable, and by which rule? (exit 1 if any path is blocked)
node bin/srta.js test your-store.com /collections/all "/search?q=shoes" --ua Bingbot

# lint a theme template
node bin/srta.js liquid ./templates/robots.txt.liquid

# CI: fail the build on warnings too
node bin/srta.js check your-store.com --strict --json
```

Quote any path containing `?` or `*`. On Windows with Git Bash, set `MSYS_NO_PATHCONV=1` or Git will rewrite a leading `/` into a Windows path.

`samples/robots.txt.liquid` is a template that keeps every Shopify default rule and adds one extra `Disallow`, using the `robots.default_groups` object from [Shopify's documentation](https://shopify.dev/docs/storefronts/themes/seo/robots-txt). It passes `shopify theme check` and `srta liquid` with no findings.

## What it does NOT do

- **It does not render your Liquid.** `srta liquid` reads the template source for known mistakes. It cannot know what Shopify's `robots.default_groups` contains on a given day, so always run `srta check` against the live file after you save a template.
- **It does not know Shopify's exact current default file.** Shopify can change it. The checks use a small, stable set of paths (`/admin`, `/cart`, `/checkout`, `/orders`, `/account`, `sort_by`, search) rather than diffing against a copy that would go stale.
- **It does not tell you whether a page is indexed.** `robots.txt` controls crawling, not indexing. A URL blocked here can still appear in results if other sites link to it, and a noindex tag on a blocked page is never seen. Use Search Console's URL Inspection for indexing status.
- **It does not enforce anything on crawlers.** A robots rule is a request. Well-behaved crawlers follow it; others do not. Do not use it to protect anything private.
- **It does not test every crawler's quirks.** Matching follows RFC 9309 and Google's documented behaviour. Other crawlers vary, for example in how they treat multiple groups for the same agent.
- **It does not crawl your site or check your sitemap's contents.** It only checks that the Sitemap line is present and well formed.

## FAQ

**Why does the report say Googlebot is fine when `*` is blocked?** A crawler uses only the most specific group that names it. A `Googlebot` group replaces the `*` group for Googlebot entirely, so rules you thought applied to everyone may not apply to it. `srta test` shows which rule decided.

**Should I block AI crawlers?** That is a business call. Blocking training crawlers and allowing shopping and search assistants is a common middle position, but blocking a shopping assistant also keeps your products out of its answers. This tool reports status and leaves the decision to you.

**My `robots.txt` is fine but pages still are not indexed.** Then it is probably not robots.txt. Common causes are noindex tags, canonical tags pointing elsewhere, thin duplicate pages, or a store still under a password page. The free audit below checks several of those.

## Run it against your own store

Robots rules are one of several things that decide whether a store gets found. If this turned up errors, the [free store audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-robots-txt-auditor) looks at the rest in the same pass: SEO, page speed, conversion and how AI shopping assistants read your catalogue.

## Related Shopify tools

Also from Ecom Swift LLC:

- [shopify-redirect-manager](https://github.com/Ecom-Swift-LLC/shopify-redirect-manager) manages URL redirects in bulk, the other half of keeping old URLs working.
- [shopify-structured-data-validator](https://github.com/Ecom-Swift-LLC/shopify-structured-data-validator) checks product-page JSON-LD, which decides whether you get price and star ratings in results.
- [shopify-ai-shopping-readiness](https://github.com/Ecom-Swift-LLC/shopify-ai-shopping-readiness) checks how AI shopping surfaces read your store; crawler access is one of its inputs.
- [shopify-theme-performance-auditor](https://github.com/Ecom-Swift-LLC/shopify-theme-performance-auditor) audits theme assets and page weight.
- [shopify-section-schema-validator](https://github.com/Ecom-Swift-LLC/shopify-section-schema-validator) validates `{% schema %}` JSON in theme sections.
- [shopify-seo-checklist](https://github.com/EcomswiftLLC/shopify-seo-checklist) is the written SEO checklist for what a validator cannot see.
- [shopify-store-audit-toolkit](https://github.com/EcomswiftLLC/shopify-store-audit-toolkit) is a wider on-page audit CLI.

## Contributing

Issues and PRs welcome, especially a real `robots.txt` this tool got wrong (a false positive or a miss), with the file attached after removing anything private. Run the suite with `npm test` (plain `node --test`, no test framework dependency) and add a case for any new rule.

## Roadmap

- `--baseline` to snapshot a store's rules and report only what changed on the next run
- A GitHub Action wrapper, matching the one in `shopify-theme-deploy-action`
- Optional check that every `Sitemap:` URL actually responds with XML
- Per-market subfolder and domain checks for stores using Shopify Markets

## License

MIT, Ecom Swift LLC. See [LICENSE](LICENSE).

## Need help?

We build Shopify themes, storefronts and automation for a living. If a check here turned up something you would rather have fixed than DIY, or you want a second pair of eyes on your store generally:

- **Free store audit** (SEO + speed + CRO + AI visibility, one report): [audit.ecomswiftllc.com](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-robots-txt-auditor)
- **More free tools**: [ecomswiftllc.com/free-tools](https://www.ecomswiftllc.com/free-tools)
- **Shopify Partner Directory**: [shopify.com/partners/directory/partner/waowy](https://www.shopify.com/partners/directory/partner/waowy)
- **Website**: [ecomswiftllc.com](https://www.ecomswiftllc.com)

---

Built because we kept finding the same few robots.txt mistakes on store audits: a development-era block that never got removed, or a `robots.txt.liquid` edit that quietly dropped the defaults. Free and complete, no catch.
