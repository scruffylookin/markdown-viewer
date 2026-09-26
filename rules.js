(() => {
  'use strict';

  // Host part of a match pattern: '*', '*.<domain>' or a literal host, each with an optional port.
  // The wildcard may only be the whole host or a leading '*.' label.
  const HOST_RE = /^(\*|(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*)(:\d{1,5})?$/i;
  // Full pattern: <scheme>://<host><path>, where the path starts with '/'.
  const PATTERN_RE = /^([^:/\s]+):\/\/([^/\s]*)(\/\S*)?$/;
  const SCHEMES = ['http', 'https', '*'];
  const CONTENT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'];

  function fail(error) {
    return { ok: false, error };
  }

  function normalizeSitePattern(input) {
    const value = String(input == null ? '' : input).trim();
    if (!value) return fail('Enter a site, such as raw.githubusercontent.com.');

    if (!value.includes('://')) {
      if (!HOST_RE.test(value)) return fail(`"${value}" is not a valid host name.`);
      return { ok: true, pattern: `https://${value}/*` };
    }

    const match = PATTERN_RE.exec(value);
    if (!match) return fail(`"${value}" is not a valid match pattern.`);
    const [, scheme, host, path] = match;
    if (!SCHEMES.includes(scheme)) return fail('Only http, https and * schemes are supported.');
    if (!HOST_RE.test(host)) return fail(`"${host}" is not a valid host.`);
    if (!path) return fail('The pattern needs a path, such as /*.');
    return { ok: true, pattern: value };
  }

  function shouldRender(loc, doc) {
    const pathname = String(loc.pathname || '').toLowerCase();
    const contentType = String(doc.contentType || '').toLowerCase();
    return (pathname.endsWith('.md') || pathname.endsWith('.markdown')) &&
      CONTENT_TYPES.includes(contentType);
  }

  function filenameFromPath(pathname) {
    const segment = String(pathname || '').split('/').pop();
    try {
      return decodeURIComponent(segment);
    } catch (e) {
      return segment;
    }
  }

  globalThis.MdvRules = { normalizeSitePattern, shouldRender, filenameFromPath };
})();
