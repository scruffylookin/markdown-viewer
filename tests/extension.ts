import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Only the extension's own files. Loading the repo root directly fails because
// Chrome rejects unpacked extensions containing names starting with "_"
// (node_modules/ has those), and copying keeps the load hermetic.
const EXTENSION_FILES = ['manifest.json', 'content.js', 'styles.css', 'lib', 'icon48.png', 'icon128.png'];

function stageExtension(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdv-ext-'));
  for (const f of EXTENSION_FILES) cpSync(join(REPO_ROOT, f), join(dir, f), { recursive: true });
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

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  /** Opens a file:// .md URL and waits until the extension has rendered it. */
  openMarkdown: (absPath: string) => Promise<Page>;
};

export const test = base.extend<Fixtures & { _ext: { context: BrowserContext; id: string } }>({
  _ext: async ({}, use) => {
    const extDir = stageExtension();
    const profileDir = mkdtempSync(join(tmpdir(), 'mdv-profile-'));
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    });
    try {
      const id = await enableFileAccess(context, extDir);
      await use({ context, id });
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  },
  context: async ({ _ext }, use) => use(_ext.context),
  extensionId: async ({ _ext }, use) => use(_ext.id),
  openMarkdown: async ({ context }, use) => {
    await use(async (absPath: string) => {
      const page = await context.newPage();
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
});

export { expect };
