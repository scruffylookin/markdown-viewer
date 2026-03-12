# Markdown Viewer - Tron Edition

A Chrome extension that renders local `.md` files with GitHub-flavored markdown and a dark neon Tron aesthetic.

## Features

- Automatically detects `file:///` URLs ending in `.md`
- Full GitHub-flavored markdown (GFM) support via [marked](https://github.com/markedjs/marked)
- Syntax highlighting for code blocks via [highlight.js](https://highlightjs.org/)
- Task list checkboxes
- Tables, blockquotes, images, and horizontal rules
- Dark theme with cyan, teal, and purple neon glow effects
- Subtle animated grid background

## Install

1. Clone the repo:
   ```bash
   git clone https://github.com/scruffylookin/markdown-viewer.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `markdown-viewer` directory
5. Find **Markdown Viewer - Tron Edition** in the extensions list and enable **Allow access to file URLs**

## Usage

Open any local markdown file in Chrome using a `file:///` URL. The extension will automatically render it.

```
file:///path/to/your/file.md
```

A `test.md` file is included in the repo for quick verification.

## Screenshot

<!-- Add a screenshot here -->

## Tech

| Component | Library |
|-----------|---------|
| Markdown parser | marked 12.0.2 |
| Syntax highlighting | highlight.js 11.9.0 |
| Theme | Custom dark neon / Tron |
