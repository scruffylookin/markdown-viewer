# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that renders local `.md` files (`file:///…/*.md`) as GitHub-flavored markdown with a dark neon "Tron" theme. The extension itself is plain JavaScript and CSS with no build step. Third-party libraries are vendored as minified files in `lib/`. The only tooling is the test harness, which uses bun and Playwright.

## Commands

```bash
bun install                                  # test dependencies only; the extension needs none
bun run test                                 # full Playwright suite, headless (about 5s)
bunx playwright test -g "js block"           # run a single test by name
bunx playwright test tests/highlighting.spec.ts
```

`@playwright/test` is pinned so its bundled Chromium matches the browser installed in `~/.cache/ms-playwright`. If you bump it, run `bunx playwright install chromium`.

There is no CI yet (#3), so run `bun run test` before opening a PR.

## Running it by hand

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select this directory.
2. On the extension's Details page, turn on **Allow access to file URLs**. Without it, nothing renders.
3. Open `file:///<repo path>/test.md`. It exercises headings, code blocks, tables and task lists.

After editing any file, click the reload icon on the extension card, then reload the `.md` tab.

Releases are published as a `.zip` of the extension files on the GitHub Releases page (see README).

## Architecture

The whole runtime is one content script. The pieces that span files:

- **`manifest.json` decides where the script runs.** A single static `content_scripts` entry matches `file:///*` with `include_globs: file:///*.md`, and injects `lib/marked.min.js`, `lib/highlight.min.js` and then `content.js`, in that order. `content.js` uses the `marked` and `hljs` globals, so the order matters.
- **`content.js` checks again.** Line 3 returns early unless the URL starts with `file:///` and ends with `.md`. To widen where the extension runs, change both the manifest match and this check.
- **The script replaces the page.** Chrome shows a local `.md` file as plain text in a `<pre>`. The script reads `document.body.innerText`, runs it through `marked.parse`, clears `<head>` and `<body>`, rebuilds the page as `.md-container` > `.md-header` (filename) + `article.md-content.markdown-body`, and then runs `hljs.highlightElement` over each `pre code`.
- **Highlighting happens after rendering, not inside marked.** marked v8+ removed the `highlight` option and ignores it without an error. Don't reintroduce it; that's what #2 fixed.
- **Stylesheets are injected twice.** The manifest's `css` injects `styles.css`, but clearing `<head>` means the script also adds `<link>` tags for `styles.css` and `lib/github-dark.min.css` through `chrome.runtime.getURL`. That's why both are listed in `web_accessible_resources`. When adding a stylesheet, add it there as well.
- **The theme lives in `styles.css`.** Colors and glows are CSS variables on `:root` (`--accent-cyan`, `--accent-teal`, `--accent-purple`, …). Markdown element styles are scoped under `.markdown-body`, and the page chrome uses `.md-*` classes.

## Test harness

`tests/extension.ts` is a Playwright fixture. It copies only the extension's own files (manifest, js, css, `lib/`, icons) into a temp directory, because Chrome won't load the repo root with `node_modules/` in it. It launches a persistent Chromium context with `--load-extension` and turns on file-URL access through `chrome.developerPrivate` on `chrome://extensions`. Tests call `openMarkdown(path)`, which waits for `article.md-content`, so a harness failure shows as a `[harness]` error rather than a failed assertion. Fixtures live in `tests/fixtures/`. Tests are tagged `// @permanent issue=#N` plus a `[@permanent]` name prefix.

## Known issues

- **Output isn't sanitized.** The `marked` output and the URL-derived filename both go into `innerHTML` without cleaning. That's tolerable only because the script runs on the user's own local files. Anything that extends rendering to websites must sanitize first (for example with DOMPurify) and set the filename with `textContent` (see #1).
- **The task-list rewrite in `content.js` is dead code.** marked v12 already emits `<input type="checkbox" disabled>` inside the `<li>`, so the `[ ] ` / `[x] ` prefix check never matches, `.task-list-item` is never added, and the themed checkbox styles in `styles.css` never apply.
