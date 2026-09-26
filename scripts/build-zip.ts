// Builds the distributable: dist/markdown-viewer-v<manifest version>.zip,
// containing the extension files plus README.md at the zip root, ready for
// "Load unpacked" after unzipping. Run with `bun run build`.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import { EXTENSION_FILES, RELEASE_EXTRAS } from './extension-files';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function manifestVersion(root = REPO_ROOT): string {
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
}

function addEntry(entries: Zippable, root: string, path: string) {
  const abs = join(root, path);
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs).sort()) addEntry(entries, root, join(path, name));
  } else {
    entries[relative(root, abs).split('\\').join('/')] = readFileSync(abs);
  }
}

export function buildZip(outDir = join(REPO_ROOT, 'dist'), root = REPO_ROOT): string {
  const missing = [...EXTENSION_FILES, ...RELEASE_EXTRAS].filter((f) => !existsSync(join(root, f)));
  if (missing.length) throw new Error(`build: missing files: ${missing.join(', ')}`);

  const entries: Zippable = {};
  for (const f of [...EXTENSION_FILES, ...RELEASE_EXTRAS]) addEntry(entries, root, f);

  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `markdown-viewer-v${manifestVersion(root)}.zip`);
  writeFileSync(out, zipSync(entries, { level: 9 }));
  return out;
}

if (import.meta.main) {
  const out = buildZip();
  console.log(`built ${relative(REPO_ROOT, out)} (${statSync(out).size} bytes)`);
}
