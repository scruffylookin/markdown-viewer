import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// rules.js is a classic script (no import/export) that sets globalThis.MdvRules.
// Load it into a fresh vm context, exactly as Chrome would run it.
const RULES_PATH = process.env.MDV_RULES_PATH ?? join(import.meta.dir, '..', '..', 'rules.js');

type NormalizeResult = { ok: true; pattern: string } | { ok: false; error: string };
type Rules = {
  normalizeSitePattern(input: string): NormalizeResult;
  shouldRender(loc: { pathname: string }, doc: { contentType: string }): boolean;
  filenameFromPath(pathname: string): string;
};

let rules: Rules | undefined;
let loadError: unknown;
try {
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(RULES_PATH, 'utf8'), sandbox);
  rules = sandbox.MdvRules as Rules;
  if (!rules) throw new Error(`${RULES_PATH} did not set globalThis.MdvRules`);
} catch (err) {
  loadError = err;
}

// Every test calls R() so a missing/broken rules.js fails each test with a clear message.
function R(): Rules {
  if (!rules) throw new Error(`Could not load rules.js from ${RULES_PATH}: ${String(loadError)}`);
  return rules;
}

describe('normalizeSitePattern', () => {
  const bareHosts: [string, string][] = [
    ['raw.githubusercontent.com', 'https://raw.githubusercontent.com/*'],
    ['  raw.githubusercontent.com  ', 'https://raw.githubusercontent.com/*'],
    ['*.example.com', 'https://*.example.com/*'],
    ['localhost:8080', 'https://localhost:8080/*'],
  ];
  // @permanent issue=#1
  test.each(bareHosts)('[@permanent] bare host %p normalizes to %p', (input, expected) => {
    expect(R().normalizeSitePattern(input)).toEqual({ ok: true, pattern: expected });
  });

  const validPatterns = [
    'https://raw.githubusercontent.com/*',
    'http://127.0.0.1/*',
    '*://example.com/docs/*',
    'https://*.gitlab.com/*',
    'http://localhost:3000/*',
    'https://*/*',
  ];
  // @permanent issue=#1
  test.each(validPatterns)('[@permanent] valid pattern %p is returned unchanged', (input) => {
    expect(R().normalizeSitePattern(input)).toEqual({ ok: true, pattern: input });
  });

  const rejected = [
    'ftp://x/*',
    'file:///*',
    '<all_urls>',
    'not a url',
    'https://example.com',
    'https://',
    '',
    '   ',
    'https://*foo.com/*',
    'https://exa mple.com/*',
  ];
  // @permanent issue=#1
  test.each(rejected)('[@permanent] invalid input %p is rejected with an error', (input) => {
    const result = R().normalizeSitePattern(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('pattern');
  });
});

describe('shouldRender', () => {
  const renders: [string, string][] = [
    ['/a/test.md', 'text/plain'],
    ['/A/README.MD', 'text/plain'],
    ['/x.markdown', 'text/markdown'],
    ['/x.md', 'text/x-markdown'],
    ['/x.md', 'TEXT/PLAIN'],
  ];
  // @permanent issue=#1
  test.each(renders)('[@permanent] renders %p served as %p', (pathname, contentType) => {
    expect(R().shouldRender({ pathname }, { contentType })).toBe(true);
  });

  const skips: [string, string][] = [
    ['/x.md', 'text/html'],
    ['/x.mdx', 'text/plain'],
    ['/foo.md/bar', 'text/plain'],
    ['/x.txt', 'text/plain'],
    ['/', 'text/plain'],
  ];
  // @permanent issue=#1
  test.each(skips)('[@permanent] does not render %p served as %p', (pathname, contentType) => {
    expect(R().shouldRender({ pathname }, { contentType })).toBe(false);
  });

  // @permanent issue=#1
  test('[@permanent] query string and hash do not prevent rendering', () => {
    const loc = new URL('https://h/test.md?foo=bar#section');
    expect(R().shouldRender(loc, { contentType: 'text/plain' })).toBe(true);
  });
});

describe('filenameFromPath', () => {
  // @scaffold issue=#1
  test('[@scaffold] returns the last path segment', () => {
    expect(R().filenameFromPath('/dir/test.md')).toBe('test.md');
  });

  // @scaffold issue=#1
  test('[@scaffold] percent-decodes the segment (as text, not markup)', () => {
    expect(R().filenameFromPath('/dir/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E.md')).toBe(
      '<img src=x onerror=alert(1)>.md',
    );
  });

  // @scaffold issue=#1
  test('[@scaffold] malformed percent-encoding returns the raw segment without throwing', () => {
    let name: string | undefined;
    expect(() => {
      name = R().filenameFromPath('/dir/bad%E0%A4.md');
    }).not.toThrow();
    expect(name).toBe('bad%E0%A4.md');
  });
});
