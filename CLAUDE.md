# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that renders `.md` files as GitHub-flavored markdown with a dark neon "Tron" theme: local files (`file:///…/*.md`) always, and raw markdown on websites the user approves in the options page. The extension itself is plain JavaScript and CSS with no build step. Third-party libraries are vendored as minified files in `lib/`. The only tooling is the test harness, which uses bun and Playwright.

## Commands

```bash
bun install                                  # test dependencies only; the extension needs none
bun run test                                 # bun unit tests, then the full Playwright suite (about 30s)
bun run test:unit                            # rules.js unit tests only
bunx playwright test -g "js block"           # run a single test by name
bunx playwright test tests/highlighting.spec.ts
```

`@playwright/test` is pinned so its bundled Chromium matches the browser installed in `~/.cache/ms-playwright`. If you bump it, run `bunx playwright install chromium`.

There is no CI yet (#3), so run `bun run test` before opening a PR.

## Running it by hand

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select this directory.
2. On the extension's Details page, turn on **Allow access to file URLs**. Without it, nothing renders.
3. Open `file:///<repo path>/test.md`. It exercises headings, code blocks, tables and task lists.
4. To try a website, open the extension's **Options**, add `raw.githubusercontent.com`, accept the permission prompt, and open `https://raw.githubusercontent.com/scruffylookin/markdown-viewer/main/test.md`.

After editing any file, click the reload icon on the extension card, then reload the `.md` tab.

Releases are published as a `.zip` of the extension files on the GitHub Releases page (see README).

## Architecture

The runtime is a content script plus a small service worker and an options page. The pieces that span files:

- **Two content-script registrations, one script list.** `manifest.json` statically matches `file:///*` with `include_globs: file:///*.md`. `background.js` registers a dynamic script with id `md-sites` whose `matches` are the approved sites. Both inject `lib/marked.min.js`, `lib/highlight.min.js`, `lib/purify.min.js`, `rules.js` and then `content.js`. `content.js` uses those globals, so the order matters. If you change it, change it in both places.
- **`rules.js` holds the pure logic.** It's a classic script that sets `globalThis.MdvRules` (`normalizeSitePattern`, `shouldRender`, `filenameFromPath`) and has no Chrome API calls. The content script, the options page and the bun unit tests (loaded via `node:vm`) all share it.
- **`content.js` decides for itself whether to render.** It returns early unless `MdvRules.shouldRender(location, document)` is true: the pathname ends in `.md`/`.markdown`, and `document.contentType` is `text/plain`, `text/markdown` or `text/x-markdown`. That check keeps it off HTML pages that happen to have a `.md` path, such as GitHub blob views.
- **The script replaces the page.** Chrome shows a plain-text `.md` in a `<pre>`. The script reads `document.body.innerText`, runs it through `marked.parse` and then `DOMPurify.sanitize`, clears `<head>` and `<body>`, and rebuilds the page as `.md-container` > `.md-header` (filename via `textContent`) + `article.md-content.markdown-body`. It then runs `hljs.highlightElement` over each `pre code`.
- **Sanitize before any `innerHTML`.** Website content is untrusted. All HTML assigned to `innerHTML`, including the detached div used to find the title, must be the sanitized string. A detached element still fires `<img onerror>`.
- **Highlighting happens after rendering, not inside marked.** marked v8+ removed the `highlight` option and ignores it without an error. Don't reintroduce it; that's what #2 fixed.
- **Site approval lives in `background.js` and `options.js`.** The options page validates the input with `normalizeSitePattern` and calls `chrome.permissions.request` synchronously in the click handler, since it needs the user gesture. It stores the pattern in `chrome.storage.sync` `sites` only on a grant. `background.js` re-registers `md-sites` from `sites` on install, startup, `storage.onChanged` and `permissions.onRemoved`, keeping only the patterns `permissions.contains` still grants and pruning the rest from storage.
- **`md-sites` injects JS only, never CSS.** `styles.css` styles `*` and `body` globally, so it must not land on non-markdown pages of an approved host. The static `file://` entry still lists `css` because every page it matches is rendered.
- **Stylesheets are added with `<link>` after the page is cleared.** `content.js` adds `styles.css` and `lib/github-dark.min.css` through `chrome.runtime.getURL`. That's why both are in `web_accessible_resources`, which matches `<all_urls>`. When adding a stylesheet, add it there as well.
- **The theme lives in `styles.css`.** Colors and glows are CSS variables on `:root` (`--accent-cyan`, `--accent-teal`, `--accent-purple`, …). Markdown element styles are scoped under `.markdown-body`, and the page chrome uses `.md-*` classes. `options.css` restates the few variables it needs instead of linking `styles.css`.

## Test harness

`tests/extension.ts` is a Playwright fixture. It copies only the extension's own files (`EXTENSION_FILES`: manifest, js, html, css, `lib/`, icons) into a temp directory. Add new extension files to that list. It copies them because Chrome won't load the repo root with `node_modules/` in it. It launches a persistent Chromium context with `--load-extension` and turns on file-URL access through `chrome.developerPrivate` on `chrome://extensions`. Tests call `openMarkdown(path)`, which waits for `article.md-content`, so a harness failure shows as a `[harness]` error rather than a failed assertion. The `ext` fixture (`ExtensionSession`) drives site tests: `site` serves `tests/fixtures/site/` on `http://127.0.0.1:<port>`, and `grantHost(pattern)` grants an optional host without the prompt by relaunching once with the pattern in the *staged* manifest's `host_permissions` and then restoring it. `developerPrivate.addHostPermission` doesn't work for optional hosts. `seedSites`, `waitForRegistration`, `relaunch` and `optionsPage` cover the rest. Fixtures live in `tests/fixtures/`. Unit tests live in `tests/unit/` and must be run as `bun test ./tests/unit`, because a bare `bun test` also picks up the Playwright `*.spec.ts` files. Tests are tagged `// @permanent issue=#N` plus a `[@permanent]` name prefix.

## Known issues

- **The themed task-list checkbox styles never apply.** marked v12 emits `<input type="checkbox" disabled>` inside a plain `<li>`, so `.task-list-item` is never added and those rules in `styles.css` are unused. The old rewrite that tried to add it was dead code and was removed in #1.
- **The permission prompt can't be automated.** Adding a site and denying the prompt are checked by hand. The harness grants hosts through the staged manifest instead.
