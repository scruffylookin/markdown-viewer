import type { Page } from '@playwright/test';
import { test, expect, type ExtensionSession } from './extension';

// Issue #1: render markdown on user-approved websites. The fixture site is
// tests/fixtures/site served on http://127.0.0.1:<random port> (see the `site`
// fixture); `.md` is served as text/plain, `/page.md` as text/html.
const HOST = 'http://127.0.0.1/*';

async function expectRendered(page: Page, what: string) {
  try {
    await page.locator('article.md-content').waitFor({ state: 'attached', timeout: 10_000 });
  } catch {
    throw new Error(`[not rendered] ${what}: article.md-content never appeared at ${page.url()}`);
  }
  await expect(page.locator('article.md-content h1').first()).toHaveText('Site Fixture');
}

// Chrome shows text/plain as a bare <pre>; the extension must leave it alone.
async function expectRaw(page: Page) {
  // A document_end content script has run by the time 'load' fires, so the
  // negative checks below cannot pass before the extension had its chance.
  await page.waitForLoadState('load');
  await expect(page.locator('body > pre')).toContainText('# Site Fixture');
  await expect(page.locator('article.md-content')).toHaveCount(0);
}

/** Grant 127.0.0.1, store it, and wait for background.js to register md-sites. */
async function approveLocalhost(ext: ExtensionSession) {
  await ext.grantHost(HOST);
  await ext.seedSites([HOST]);
  return ext.waitForRegistration([HOST]);
}

// @permanent issue=#1
test('[@permanent] approved host renders .md with theme, highlighting and filename', async ({ ext, site }) => {
  await approveLocalhost(ext);
  const page = await ext.openUrl(site.url('/test.md'));
  await expectRendered(page, 'approved host /test.md');

  const js = page.locator('article.md-content pre code').filter({ hasText: 'function add(a, b)' });
  await expect(js).toHaveCount(1);
  expect(await js.locator('span[class^="hljs-"]').count(), 'js block has no hljs-* spans').toBeGreaterThan(0);

  await expect(page.locator('.md-container > .md-header .md-filename')).toHaveText('test.md');
  await expect(
    page.locator(`head link[rel="stylesheet"][href="chrome-extension://${ext.id}/styles.css"]`),
  ).toHaveCount(1);
});

// @permanent issue=#1
test('[@permanent] md-sites registration matches seeded pattern, injects content.js and no css', async ({ ext }) => {
  const reg = await approveLocalhost(ext);
  expect(reg, 'md-sites not registered').toBeDefined();
  expect(reg!.id).toBe('md-sites');
  expect(reg!.matches).toEqual([HOST]);
  const js = (reg!.js ?? []).map((p) => p.replace(/^\//, ''));
  expect(js).toContain('content.js');
  expect(js.indexOf('content.js'), 'content.js must load after its dependencies').toBe(js.length - 1);
  // styles.css styles `*` and `body` globally, so it must only arrive via
  // content.js's <link> after the shouldRender gate, never via registration.
  expect(reg!.css ?? []).toEqual([]);
  expect(reg!.runAt).toBe('document_end');
});

// @permanent issue=#1
test('[@permanent] query string and hash still render and filename drops the query', async ({ ext, site }) => {
  await approveLocalhost(ext);
  for (const suffix of ['?foo=bar', '#section']) {
    const page = await ext.openUrl(site.url(`/test.md${suffix}`));
    await expectRendered(page, `/test.md${suffix}`);
    await expect(page.locator('.md-container > .md-header .md-filename')).toHaveText('test.md');
    await page.close();
  }
});

// @permanent issue=#1
test('[@permanent] HTML page at a .md path on an approved host is left untouched', async ({ ext, site }) => {
  await approveLocalhost(ext);
  // Control: the same host does render real markdown, so the no-op below is
  // the content-type gate, not a missing injection.
  await expectRendered(await ext.openUrl(site.url('/test.md')), 'control /test.md');

  const page = await ext.openUrl(site.url('/page.md'));
  await page.waitForLoadState('load');
  await expect(page.locator('#html-title')).toHaveText('Plain HTML Page');
  await expect(page.locator('#keep')).toContainText('must be left alone');
  await expect(page).toHaveTitle('Plain HTML Page');
  await expect(page.locator('article.md-content')).toHaveCount(0);
  await expect(page.locator('.md-container')).toHaveCount(0);
  await expect(page.locator('link[href^="chrome-extension://"]')).toHaveCount(0);

  // page.html is unstyled, so body keeps Chrome's UA defaults. styles.css
  // would zero the margin (`*`) and paint the background (`body`).
  const style = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { margin: cs.marginTop, background: cs.backgroundColor };
  });
  expect(style).toEqual({ margin: '8px', background: 'rgba(0, 0, 0, 0)' });
  const extSheets = await page.evaluate(() =>
    [...document.styleSheets].map((s) => s.href ?? '').filter((h) => h.startsWith('chrome-extension://')),
  );
  expect(extSheets).toEqual([]);
});

// @permanent issue=#1
test('[@permanent] markdown from an approved host is sanitized before rendering', async ({ ext, site }) => {
  await approveLocalhost(ext);
  const page = await ext.openUrl(site.url('/xss.md'));
  try {
    await page.locator('article.md-content').waitFor({ state: 'attached', timeout: 10_000 });
  } catch {
    throw new Error(`[not rendered] /xss.md: article.md-content never appeared at ${page.url()}`);
  }
  const article = page.locator('article.md-content');
  await expect(article.locator('h1')).toHaveText('XSS Fixture');
  await expect(article).toContainText('After the payloads.');
  await expect(article.locator('[onerror]')).toHaveCount(0);
  await expect(article.locator('a[href^="javascript:" i]')).toHaveCount(0);
  await expect(article.locator('script')).toHaveCount(0);
  // Image error events settle before 'load', so an unsanitized onerror would have fired.
  await page.waitForLoadState('load');
  // page.evaluate runs in the main world, where an onerror/script payload would land.
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

// @permanent issue=#1
test('[@permanent] unapproved host is not rendered', async ({ ext, site }) => {
  // Precondition via the service worker: nothing stored, nothing registered.
  expect(await ext.storedSites()).toBeUndefined();
  expect(await ext.registration()).toBeUndefined();
  expect(await ext.hasHost(HOST)).toBe(false);

  const page = await ext.openUrl(site.url('/test.md'));
  await expectRaw(page);
});

// @permanent issue=#1
test('[@permanent] stored pattern without host permission is pruned and never registered', async ({ ext, site }) => {
  expect(await ext.hasHost(HOST)).toBe(false);
  await ext.seedSites([HOST]);

  await expect
    .poll(() => ext.storedSites(), { message: 'background.js should prune a pattern it holds no permission for' })
    .toEqual([]);
  expect(await ext.registration()).toBeUndefined();
  await expectRaw(await ext.openUrl(site.url('/test.md')));
});

// @permanent issue=#1
test('[@permanent] removing a site in options revokes permission and stops rendering', async ({ ext, site }) => {
  await approveLocalhost(ext);
  await expectRendered(await ext.openUrl(site.url('/test.md')), 'before removal');

  const options = await ext.optionsPage();
  const items = options.locator('#site-list li');
  await expect(items).toHaveCount(1);
  await expect(items.locator('.site-pattern')).toHaveText(HOST);

  await items.locator('button.remove-site').click();
  await expect(items).toHaveCount(0);
  await expect.poll(async () => (await ext.storedSites()) ?? []).toEqual([]);
  await expect.poll(() => ext.hasHost(HOST), { message: 'host permission should be revoked' }).toBe(false);
  await ext.waitForRegistration([]);

  await expectRaw(await ext.openUrl(site.url('/test.md')));
});

// @scaffold issue=#1
test('[@scaffold] options page rejects invalid patterns and stores nothing', async ({ ext }) => {
  const options = await ext.optionsPage();
  const error = options.locator('#site-error');
  for (const bad of ['ftp://x/*', 'not a url']) {
    await options.locator('#site-input').fill(bad);
    await options.locator('#add-site').click();
    await expect(error, `no error shown for ${JSON.stringify(bad)}`).toBeVisible();
    await expect(error).not.toHaveText(/^\s*$/);
    expect((await ext.storedSites()) ?? [], `stored something for ${JSON.stringify(bad)}`).toEqual([]);
    await expect(options.locator('#site-list li')).toHaveCount(0);
  }
});

// @permanent issue=#1
test('[@permanent] approved sites survive a browser restart', async ({ ext, site }) => {
  await approveLocalhost(ext);
  await expectRendered(await ext.openUrl(site.url('/test.md')), 'before restart');

  await ext.relaunch();
  expect(await ext.storedSites()).toEqual([HOST]);
  await ext.waitForRegistration([HOST]);
  await expectRendered(await ext.openUrl(site.url('/test.md')), 'after restart');
});
