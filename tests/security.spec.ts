import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, REPO_ROOT } from './extension';

const XSS_MD = join(REPO_ROOT, 'tests', 'fixtures', 'xss.md');

// Upper bound on the window.__xss poll. Callers first wait for the page's
// load event (so img error events have had a chance to fire); the DOM-state
// checks carry the main negative assertions, and this poll is a bounded backstop.
const SETTLE_MS = 1_000;

/**
 * Records every dialog (alert/confirm/prompt) raised by any page in the
 * context and dismisses it. Must be called BEFORE navigation so a dialog fired
 * while the content script runs is not missed.
 */
function recordDialogs(context: BrowserContext): string[] {
  const dialogs: string[] = [];
  context.on('page', (p) =>
    p.on('dialog', async (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      await d.dismiss().catch(() => {});
    }),
  );
  return dialogs;
}

/**
 * Reads the main-world flag the payloads set. page.evaluate runs in the page's
 * main world, which is where inline event handlers execute (not the content
 * script's isolated world). Polls up to SETTLE_MS; returns the last value seen.
 */
async function settledXssFlag(page: Page): Promise<unknown> {
  const deadline = Date.now() + SETTLE_MS;
  let value: unknown;
  do {
    value = await page.evaluate(() => (window as any).__xss);
    if (value !== undefined) return value;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return value;
}

// Proves the page actually rendered, so a security assertion that fails
// afterwards is a product failure, not a harness one.
async function expectRendered(page: Page, h1Text: string) {
  await expect(page.locator('article.md-content h1').first()).toHaveText(h1Text);
}

// @permanent issue=#1
test('[@permanent] xss fixture payloads do not execute or survive rendering', async ({ context, openMarkdown }) => {
  const dialogs = recordDialogs(context);

  const page = await openMarkdown(XSS_MD);
  await expectRendered(page, 'XSS Fixture');
  const article = page.locator('article.md-content');
  await page.waitForLoadState('load');

  await expect(article.locator('[onerror], [onload]'), 'inline event-handler attributes survived').toHaveCount(0);
  await expect(article.locator('script'), '<script> element survived into the article').toHaveCount(0);
  await expect(article.locator('a[href^="javascript:" i]'), 'javascript: link survived').toHaveCount(0);

  expect(await settledXssFlag(page), 'an injected handler/script ran in the page main world').toBeUndefined();
  expect(dialogs, `dialogs fired: ${dialogs.join(' | ')}`).toEqual([]);

  // Safe content around the payloads is kept.
  await expect(article.locator('p', { hasText: 'Safe text after payloads' })).toBeVisible();
  await expect(article.locator('a', { hasText: 'ok' })).toHaveAttribute('href', 'https://example.com');
});

// @permanent issue=#1
test('[@permanent] first-heading title lookup does not execute payloads', async ({ context, openMarkdown }) => {
  const dialogs = recordDialogs(context);
  const dir = mkdtempSync(join(tmpdir(), 'mdv-title-xss-'));
  try {
    const file = join(dir, 'title-xss.md');
    writeFileSync(file, '# Title <img src=x onerror="window.__xss=(window.__xss||0)+1">\n\nBody text.\n');

    const page = await openMarkdown(file);
    await expect(page.locator('article.md-content h1').first()).toContainText('Title');
    await page.waitForLoadState('load');

    await expect(page.locator('article.md-content [onerror]'), 'onerror attribute survived in the heading').toHaveCount(0);
    expect(await settledXssFlag(page), 'payload in the first heading ran in the page main world').toBeUndefined();
    expect(dialogs, `dialogs fired: ${dialogs.join(' | ')}`).toEqual([]);

    const title = await page.title();
    expect(title).toContain('Title');
    expect(title).not.toContain('<img');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// @permanent issue=#1
test('[@permanent] malicious filename is shown as text, not parsed as HTML', async ({ context, openMarkdown }) => {
  const dialogs = recordDialogs(context);
  const dir = mkdtempSync(join(tmpdir(), 'mdv-filename-xss-'));
  const name = '<img src=x onerror=alert(1)>.md';
  try {
    const file = join(dir, name);
    writeFileSync(file, '# Filename Test\n');

    const page = await openMarkdown(file);
    await expectRendered(page, 'Filename Test');
    await page.waitForLoadState('load');

    const filename = page.locator('.md-header .md-filename');
    await expect(filename).toHaveCount(1);
    expect(await filename.textContent()).toBe(name);
    await expect(page.locator('.md-header img'), 'filename was parsed into an <img>').toHaveCount(0);
    expect(dialogs, `dialogs fired: ${dialogs.join(' | ')}`).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
