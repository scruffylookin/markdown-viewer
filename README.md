# Markdown Viewer - Tron Edition

A Chrome extension that renders `.md` files with GitHub-flavored markdown and a dark neon Tron aesthetic. It works on local files and, optionally, on websites you approve.

## Features

- Automatically detects `file:///` URLs ending in `.md`
- Optional rendering of raw markdown on sites you approve (for example `raw.githubusercontent.com`)
- Rendered HTML is sanitized with [DOMPurify](https://github.com/cure53/DOMPurify)
- Full GitHub-flavored markdown (GFM) support via [marked](https://github.com/markedjs/marked)
- Syntax highlighting for code blocks via [highlight.js](https://highlightjs.org/)
- Task list checkboxes
- Tables, blockquotes, images, and horizontal rules
- Dark theme with cyan, teal, and purple neon glow effects
- Subtle animated grid background

## Install

### Quick Install

1. Download the latest `.zip` from [Releases](https://github.com/scruffylookin/markdown-viewer/releases)
2. Unzip it to a folder
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the unzipped folder
6. Enable **Allow access to file URLs** for the extension

### From Source

1. Clone the repo:
   ```bash
   git clone https://github.com/scruffylookin/markdown-viewer.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `markdown-viewer` directory
5. Enable **Allow access to file URLs** for the extension

## Usage

Open any local markdown file in Chrome using a `file:///` URL. The extension will automatically render it.

```
file:///path/to/your/file.md
```

A `test.md` file is included in the repo for quick verification.

### Rendering markdown on websites

The extension can also render raw `.md` files served by websites, such as `raw.githubusercontent.com`, GitLab raw URLs or a self-hosted docs server. It only does this on sites you approve.

1. Open `chrome://extensions/`, find the extension, and click **Details** → **Extension options**.
2. Enter a host (`raw.githubusercontent.com`) or a Chrome match pattern (`https://docs.example.com/notes/*`) and click **Add**. A bare host becomes `https://<host>/*`.
3. Chrome asks for permission to read that site. The site is added only if you allow it.
4. Open any `.md` or `.markdown` URL on that site. Query strings and `#anchors` are fine.

The extension only renders pages that the site serves as plain text or markdown. HTML pages whose address ends in `.md`, like GitHub's normal file view, are left alone. Click **Remove** next to a site to stop rendering there and give back its permission. Revoking the site under **Site access** in `chrome://extensions` removes it too.

## Screenshot

<!-- Add a screenshot here -->

## Tech

| Component | Library |
|-----------|---------|
| Markdown parser | marked 12.0.2 |
| Syntax highlighting | highlight.js 11.9.0 |
| HTML sanitizer | DOMPurify 3.4.16 |
| Theme | Custom dark neon / Tron |

## Development

The extension has no build step. Tests use [Playwright](https://playwright.dev/) with [bun](https://bun.sh/): they load the unpacked extension in Chromium and check the rendered page.

```bash
bun install
bun run test        # unit tests (bun) + extension tests (Playwright)
```
