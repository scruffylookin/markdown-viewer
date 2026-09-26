import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, REPO_ROOT } from './extension';

const TEST_MD = join(REPO_ROOT, 'test.md');
const FIXTURE_MD = join(REPO_ROOT, 'tests', 'fixtures', 'highlight.md');

// Proves the page actually rendered, so a highlighting assertion that fails
// afterwards is a product failure, not a harness one.
async function expectRendered(page: Page, h1Text: string) {
  await expect(page.locator('article.md-content h1').first()).toHaveText(h1Text);
}

function codeBlockContaining(page: Page, text: string) {
  return page.locator('article.md-content pre code').filter({ hasText: text });
}

// @permanent issue=#2
test('[@permanent] test.md code blocks contain hljs token spans', async ({ openMarkdown }) => {
  const page = await openMarkdown(TEST_MD);
  await expectRendered(page, 'Markdown Viewer Test');

  const blocks = page.locator('article.md-content pre code');
  const count = await blocks.count();
  expect(count, 'test.md should render its fenced code blocks').toBeGreaterThanOrEqual(2);

  for (let i = 0; i < count; i++) {
    const block = blocks.nth(i);
    const spans = await block.locator('span[class^="hljs-"]').count();
    expect(spans, `code block #${i} (${await block.getAttribute('class')}) has no hljs-* token spans`).toBeGreaterThan(0);
  }
});

// @permanent issue=#2
test('[@permanent] fixture js block is highlighted as js', async ({ openMarkdown }) => {
  const page = await openMarkdown(FIXTURE_MD);
  await expectRendered(page, 'Highlight Fixture');

  const js = codeBlockContaining(page, 'function add(a, b)');
  await expect(js).toHaveCount(1);
  await expect(js).toHaveClass(/(^|\s)language-js(\s|$)/);
  await expect(js).toHaveClass(/(^|\s)hljs(\s|$)/);
  await expect(js.locator('.hljs-keyword').first()).toBeAttached();
  const keywords = await js.locator('.hljs-keyword').allTextContents();
  expect(keywords).toEqual(expect.arrayContaining(['function', 'const', 'return']));
});

// @permanent issue=#2
test('[@permanent] fixture block without a language is auto-detected and highlighted', async ({ openMarkdown }) => {
  const page = await openMarkdown(FIXTURE_MD);
  await expectRendered(page, 'Highlight Fixture');

  const plain = codeBlockContaining(page, 'def fibonacci(n):');
  await expect(plain).toHaveCount(1);
  expect(await plain.locator('span[class^="hljs-"]').count(), 'no-language block has no hljs-* spans').toBeGreaterThan(0);
});

// @permanent issue=#2
test('[@permanent] fixture unknown-language block renders as plain code without errors', async ({ context, openMarkdown }) => {
  // Collect errors from the moment the page exists, before the content script runs.
  const errors: string[] = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));

  const page = await openMarkdown(FIXTURE_MD);
  await expectRendered(page, 'Highlight Fixture');

  const unknown = codeBlockContaining(page, 'this is not a real language');
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toHaveText(
    'this is not a real language <tag> & stuff\nsecond line stays intact\n',
  );
  await expect(page.locator('article.md-content h2', { hasText: 'After Unknown Language' })).toBeVisible();
  expect(errors, `page threw: ${errors.join(' | ')}`).toEqual([]);
});

// @permanent issue=#2
test('[@permanent] fixture non-code markdown renders as before', async ({ openMarkdown }) => {
  const page = await openMarkdown(FIXTURE_MD);
  const article = page.locator('article.md-content');

  await expect(article.locator('h1')).toHaveText('Highlight Fixture');
  await expect(page.locator('.md-container > .md-header .md-filename')).toHaveText('highlight.md');

  // GFM table
  const table = article.locator('table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('thead th')).toHaveText(['Name', 'Value']);
  await expect(table.locator('tbody tr').nth(0).locator('td')).toHaveText(['alpha', '1']);
  await expect(table.locator('tbody tr').nth(1).locator('td')).toHaveText(['beta', '2']);

  // Task list: current behaviour is marked's GFM output, i.e. a disabled
  // <input type=checkbox> as the first child of a plain <li>. (content.js's
  // "[ ] " rewrite never matches because marked already consumed the marker.)
  const boxes = article.locator('li > input[type="checkbox"]');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(boxes.nth(0)).toBeDisabled();
  await expect(boxes.nth(1)).toBeDisabled();
  await expect(article.locator('li', { hasText: 'Done item' }).locator('input[type="checkbox"]')).toBeChecked();
  await expect(article.locator('li', { hasText: 'Todo item' }).locator('input[type="checkbox"]')).not.toBeChecked();

  // Inline code stays a bare <code> outside any <pre>.
  const inline = article.locator('p > code');
  await expect(inline).toHaveText('inlineToken()');
  expect(await inline.evaluate((el) => el.closest('pre') === null)).toBe(true);
});
