// Registers the md-sites content script for the user-approved sites stored in
// chrome.storage.sync `sites`, limited to the hosts the extension still holds
// permission for. Pure logic lives in rules.js; this file only syncs state.
'use strict';

const SCRIPT_ID = 'md-sites';
const SCRIPT_JS = [
  'lib/marked.min.js',
  'lib/highlight.min.js',
  'lib/purify.min.js',
  'rules.js',
  'content.js',
];

async function syncRegistrationNow() {
  const { sites } = await chrome.storage.sync.get('sites');
  const stored = Array.isArray(sites) ? sites : [];

  const kept = [];
  for (const pattern of stored) {
    if (await chrome.permissions.contains({ origins: [pattern] })) kept.push(pattern);
  }

  // Write only on a real change, so the storage.onChanged resync settles.
  if (Array.isArray(sites) && kept.length !== stored.length) {
    await chrome.storage.sync.set({ sites: kept });
  }

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }

  // No css: styles.css styles `*` and `body` globally, so content.js adds it
  // only after its shouldRender gate passes.
  if (kept.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: kept,
        js: SCRIPT_JS,
        runAt: 'document_end',
        persistAcrossSessions: true,
      },
    ]);
  }
}

// Serialize resyncs so overlapping events can't race register/unregister.
let chain = Promise.resolve();
function syncRegistration() {
  chain = chain
    .then(syncRegistrationNow)
    .catch((err) => console.error('[markdown-viewer] site registration failed:', err));
  return chain;
}

async function dropRevokedOrigins(origins) {
  const { sites } = await chrome.storage.sync.get('sites');
  if (!Array.isArray(sites) || !origins || !origins.length) return;
  const next = sites.filter((p) => !origins.includes(p));
  if (next.length !== sites.length) await chrome.storage.sync.set({ sites: next });
}

// MV3: listeners must be registered synchronously at top level.
chrome.runtime.onInstalled.addListener(() => syncRegistration());
chrome.runtime.onStartup.addListener(() => syncRegistration());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'sites' in changes) syncRegistration();
});
chrome.permissions.onRemoved.addListener((removed) => {
  dropRevokedOrigins(removed && removed.origins)
    .catch((err) => console.error('[markdown-viewer] pruning revoked sites failed:', err))
    .finally(() => syncRegistration());
});
