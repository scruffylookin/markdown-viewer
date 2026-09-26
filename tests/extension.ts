import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXTENSION_FILES } from '../scripts/extension-files';

// Extension APIs used inside evaluate() callbacks (no @types/chrome installed).
declare const chrome: any;

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'site');

/** Dynamic content script id registered by background.js (issue #1 contract). */
export const MD_SITES_ID = 'md-sites';

// Only the extension's own files (shared with the release build). Loading the
// repo root directly fails because Chrome rejects unpacked extensions
// containing names starting with "_" (node_modules/ has those), and copying
// keeps the load hermetic. Entries that don't exist yet are skipped so the
// harness works before a feature lands.
function stageExtension(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdv-ext-'));
  for (const f of EXTENSION_FILES) {
    const src = join(REPO_ROOT, f);
    if (existsSync(src)) cpSync(src, join(dir, f), { recursive: true });
  }
  return dir;
}

/**
 * Unpacked extensions do not get "Allow access to file URLs" by default, and
 * without it the content script never runs on file:// pages. Flip it through
 * chrome.developerPrivate from the chrome://extensions page, then read it back.
 */
async function enableFileAccess(context: BrowserContext, extDir: string): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions');
    const result = await page.evaluate(async (path: string) => {
      const dp = (globalThis as any).chrome?.developerPrivate;
      if (!dp) return { error: 'chrome.developerPrivate unavailable on chrome://extensions' };
      const all: any[] = await dp.getExtensionsInfo();
      const ext = all.find((e) => e.path === path) ?? all.find((e) => e.location === 'UNPACKED');
      if (!ext) return { error: `extension not loaded; saw ${JSON.stringify(all.map((e) => [e.name, e.path]))}` };
      await dp.updateExtensionConfiguration({ extensionId: ext.id, fileAccess: true });
      const after: any = await dp.getExtensionInfo(ext.id);
      return { id: ext.id as string, fileAccess: after.fileAccess?.isActive as boolean };
    }, extDir);
    if ('error' in result) throw new Error(`[harness] ${result.error}`);
    if (!result.fileAccess) throw new Error(`[harness] file access did not turn on for extension ${result.id}`);
    return result.id;
  } finally {
    await page.close();
  }
}

export type RegisteredScript = { id: string; matches?: string[]; js?: string[]; css?: string[]; runAt?: string };

/**
 * One browser profile + one staged copy of the extension. The context can be
 * closed and relaunched on the same profile (browser restart, criterion 11),
 * so always read `session.context` fresh instead of caching it across a
 * relaunch()/grantHost() call.
 */
export class ExtensionSession {
  context!: BrowserContext;
  id!: string;

  constructor(
    readonly extDir: string,
    readonly profileDir: string,
  ) {}

  async launch(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${this.extDir}`, `--load-extension=${this.extDir}`],
    });
    this.id = await enableFileAccess(this.context, this.extDir);
  }

  async close(): Promise<void> {
    await this.context?.close();
  }

  /** Simulates a browser restart: same profile dir, same staged extension dir. */
  async relaunch(): Promise<void> {
    await this.close();
    await this.launch();
  }

  /**
   * Grants an optional host permission without Chrome's permission prompt
   * (which cannot be automated).
   *
   * Mechanism (probed against Chromium for Playwright 1.61):
   * - chrome.developerPrivate.addHostPermission() resolves but has NO effect on
   *   optional_host_permissions (it only re-grants withheld required hosts),
   *   so it is not used.
   * - Leaving the host in `host_permissions` makes it required, and then
   *   chrome.permissions.remove() refuses it ("You cannot remove required
   *   permissions"), which would make criterion 5 untestable. Not used.
   * - Reloading the extension in place (developerPrivate.reload) disables a
   *   --load-extension extension ("unsupportedDeveloperExtension"). Not used.
   * - What works: relaunch with the STAGED manifest temporarily listing the
   *   host under `host_permissions` (Chrome grants it and records it in the
   *   profile), then restore the staged manifest and relaunch again. Chrome
   *   keeps the host active because it is still covered by
   *   optional_host_permissions, so permissions.contains() is true,
   *   dynamically registered scripts inject, and permissions.remove() works
   *   exactly like a user-granted optional host.
   * The repo manifest is never touched. Invalidates pages from the old context.
   */
  async grantHost(pattern: string): Promise<void> {
    const manifestPath = join(this.extDir, 'manifest.json');
    const original = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(original);
    manifest.host_permissions = [...(manifest.host_permissions ?? []), pattern];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    try {
      await this.relaunch();
    } finally {
      writeFileSync(manifestPath, original);
    }
    await this.relaunch();
    if (!(await this.hasHost(pattern))) {
      throw new Error(
        `[harness] grantHost(${pattern}) did not stick after restoring the manifest. ` +
          `Does manifest.json declare optional_host_permissions covering it?`,
      );
    }
  }

  /** The extension's MV3 service worker (background.js). */
  async serviceWorker(timeout = 5_000): Promise<Worker> {
    const prefix = `chrome-extension://${this.id}/`;
    const existing = this.context.serviceWorkers().find((w) => w.url().startsWith(prefix));
    if (existing) return existing;
    try {
      return await this.context.waitForEvent('serviceworker', {
        predicate: (w) => w.url().startsWith(prefix),
        timeout,
      });
    } catch {
      throw new Error(
        `[harness] no service worker for extension ${this.id} within ${timeout}ms. ` +
          `Expected manifest.json "background": {"service_worker": "background.js"}.`,
      );
    }
  }

  async seedSites(patterns: string[]): Promise<void> {
    const sw = await this.serviceWorker();
    await sw.evaluate((sites: string[]) => chrome.storage.sync.set({ sites }), patterns);
  }

  /** chrome.storage.sync `sites` as stored (undefined when never set). */
  async storedSites(): Promise<string[] | undefined> {
    const sw = await this.serviceWorker();
    return sw.evaluate(async () => (await chrome.storage.sync.get('sites')).sites);
  }

  async hasHost(pattern: string): Promise<boolean> {
    const sw = await this.serviceWorker();
    return sw.evaluate((p: string) => chrome.permissions.contains({ origins: [p] }), pattern);
  }

  /** The md-sites registration, or undefined when nothing is registered. */
  async registration(): Promise<RegisteredScript | undefined> {
    const sw = await this.serviceWorker();
    const scripts: RegisteredScript[] = await sw.evaluate(
      (id: string) => chrome.scripting.getRegisteredContentScripts({ ids: [id] }),
      MD_SITES_ID,
    );
    return scripts[0];
  }

  /**
   * Polls until md-sites' matches equal `expectedMatches` (order-insensitive).
   * `[]` means "md-sites is not registered at all". Never a fixed sleep.
   */
  async waitForRegistration(expectedMatches: string[], timeout = 5_000): Promise<RegisteredScript | undefined> {
    const want = [...expectedMatches].sort();
    let last: RegisteredScript | undefined;
    await expect
      .poll(
        async () => {
          last = await this.registration();
          return last ? [...(last.matches ?? [])].sort() : [];
        },
        { timeout, message: `[harness] md-sites registration never reached matches=${JSON.stringify(want)}` },
      )
      .toEqual(want);
    return last;
  }

  async openUrl(url: string): Promise<Page> {
    const page = await this.context.newPage();
    await page.goto(url);
    return page;
  }

  async optionsPage(): Promise<Page> {
    const page = await this.context.newPage();
    try {
      await page.goto(`chrome-extension://${this.id}/options.html`);
    } catch (e) {
      throw new Error(`[harness] could not open options.html: ${(e as Error).message.split('\n')[0]}`);
    }
    return page;
  }
}

export type Site = { origin: string; url: (path: string) => string };

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/plain; charset=utf-8',
  '.markdown': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

// Paths ending in .md that serve an HTML document (criterion 8).
const HTML_AT_MD_PATH: Record<string, string> = { '/page.md': 'page.html' };

function startSiteServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file: string;
    let type: string | undefined;
    if (HTML_AT_MD_PATH[pathname]) {
      file = join(SITE_FIXTURES, HTML_AT_MD_PATH[pathname]);
      type = 'text/html; charset=utf-8';
    } else {
      file = normalize(join(SITE_FIXTURES, pathname));
      type = CONTENT_TYPES[extname(file).toLowerCase()];
    }
    if (!file.startsWith(SITE_FIXTURES + sep) || !type || !existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  /** Opens a file:// .md URL and waits until the extension has rendered it. */
  openMarkdown: (absPath: string) => Promise<Page>;
  /** The extension session: relaunch, grantHost, SW helpers, options page. */
  ext: ExtensionSession;
  /** tests/fixtures/site served on http://127.0.0.1:<random port>. */
  site: Site;
};

export const test = base.extend<Fixtures>({
  ext: async ({}, use) => {
    const session = new ExtensionSession(stageExtension(), mkdtempSync(join(tmpdir(), 'mdv-profile-')));
    try {
      await session.launch();
      await use(session);
    } finally {
      await session.close().catch(() => {});
      rmSync(session.profileDir, { recursive: true, force: true });
      rmSync(session.extDir, { recursive: true, force: true });
    }
  },
  context: async ({ ext }, use) => use(ext.context),
  extensionId: async ({ ext }, use) => use(ext.id),
  openMarkdown: async ({ ext }, use) => {
    await use(async (absPath: string) => {
      const page = await ext.context.newPage();
      await page.goto(pathToFileURL(absPath).href);
      try {
        await page.locator('article.md-content').waitFor({ state: 'attached', timeout: 10_000 });
      } catch {
        throw new Error(
          `[harness] extension never rendered ${absPath}: article.md-content missing. ` +
            `This is a harness/load failure, not a highlighting failure.`,
        );
      }
      return page;
    });
  },
  site: async ({}, use) => {
    const server = await startSiteServer();
    const { port } = server.address() as { port: number };
    const origin = `http://127.0.0.1:${port}`;
    try {
      await use({ origin, url: (path: string) => origin + path });
    } finally {
      // Browser keep-alive sockets would otherwise hold close() open.
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    }
  },
});

export { expect };
