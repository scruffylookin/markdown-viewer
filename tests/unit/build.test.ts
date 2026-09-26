import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';
import { buildZip, manifestVersion, REPO_ROOT } from '../../scripts/build-zip';
import { EXTENSION_FILES, RELEASE_EXTRAS } from '../../scripts/extension-files';

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'manifest.json'), 'utf8'));
const optionsHtml = readFileSync(join(REPO_ROOT, 'options.html'), 'utf8');

// Every file the extension loads at runtime, per the manifest and options page.
function referencedFiles(): string[] {
  const refs = new Set<string>();
  for (const cs of manifest.content_scripts ?? []) [...(cs.js ?? []), ...(cs.css ?? [])].forEach((f: string) => refs.add(f));
  if (manifest.background?.service_worker) refs.add(manifest.background.service_worker);
  if (manifest.options_ui?.page) refs.add(manifest.options_ui.page);
  for (const war of manifest.web_accessible_resources ?? []) war.resources.forEach((f: string) => refs.add(f));
  Object.values(manifest.icons ?? {}).forEach((f) => refs.add(f as string));
  for (const m of optionsHtml.matchAll(/(?:src|href)="([^"]+)"/g)) refs.add(m[1]);
  // background.js registers md-sites with its own js list.
  const bg = readFileSync(join(REPO_ROOT, manifest.background.service_worker), 'utf8');
  for (const m of bg.matchAll(/'((?:lib\/)?[\w.-]+\.js)'/g)) refs.add(m[1]);
  return [...refs].sort();
}

const covered = (f: string) => EXTENSION_FILES.some((e) => f === e || f.startsWith(`${e}/`));

describe('release build', () => {
  // @permanent issue=#3
  test('[@permanent] every file the extension loads is in EXTENSION_FILES', () => {
    const missing = referencedFiles().filter((f) => !covered(f));
    expect(missing, 'add these to scripts/extension-files.ts or the zip ships broken').toEqual([]);
  });

  // @permanent issue=#3
  test('[@permanent] zip is named for the manifest version and holds exactly the extension files', () => {
    const out = mkdtempSync(join(tmpdir(), 'mdv-build-'));
    try {
      const zip = buildZip(out);
      expect(basename(zip)).toBe(`markdown-viewer-v${manifestVersion()}.zip`);
      const names = Object.keys(unzipSync(readFileSync(zip))).filter((n) => !n.endsWith('/'));
      expect(names).toContain('manifest.json');
      expect(names).toContain('lib/purify.min.js');
      expect(names).toContain('README.md');
      for (const n of names) {
        expect(covered(n) || RELEASE_EXTRAS.includes(n), `unexpected file in zip: ${n}`).toBe(true);
      }
      const unzippedManifest = JSON.parse(new TextDecoder().decode(unzipSync(readFileSync(zip))['manifest.json']));
      expect(unzippedManifest.version).toBe(manifestVersion());
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
