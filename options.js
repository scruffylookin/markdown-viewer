'use strict';

const input = document.getElementById('site-input');
const addButton = document.getElementById('add-site');
const errorEl = document.getElementById('site-error');
const noteEl = document.getElementById('site-note');
const list = document.getElementById('site-list');

function setMessage(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

async function readSites() {
  const { sites } = await chrome.storage.sync.get('sites');
  return Array.isArray(sites) ? sites : [];
}

async function render() {
  const sites = await readSites();
  list.replaceChildren(
    ...sites.map((pattern) => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'site-pattern';
      text.textContent = pattern;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-site';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${pattern}`);
      remove.addEventListener('click', () => removeSite(pattern));
      li.append(text, remove);
      return li;
    }),
  );
}

function addSite() {
  setMessage(noteEl, '');
  const result = MdvRules.normalizeSitePattern(input.value);
  if (!result.ok) {
    setMessage(errorEl, result.error);
    return;
  }
  const pattern = result.pattern;
  // No await before this call: permissions.request needs the user gesture.
  chrome.permissions
    .request({ origins: [pattern] })
    .then(async (granted) => {
      if (!granted) {
        setMessage(errorEl, '');
        setMessage(noteEl, 'Permission not granted, so the site was not added.');
        return;
      }
      const sites = await readSites();
      if (!sites.includes(pattern)) await chrome.storage.sync.set({ sites: [...sites, pattern] });
      input.value = '';
      setMessage(errorEl, '');
      await render();
    })
    .catch((err) => setMessage(errorEl, String((err && err.message) || err)));
}

async function removeSite(pattern) {
  setMessage(noteEl, '');
  try {
    await chrome.permissions.remove({ origins: [pattern] });
    const sites = await readSites();
    await chrome.storage.sync.set({ sites: sites.filter((p) => p !== pattern) });
    await render();
  } catch (err) {
    setMessage(errorEl, String((err && err.message) || err));
  }
}

addButton.addEventListener('click', addSite);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSite();
  }
});
document.getElementById('site-form').addEventListener('submit', (e) => e.preventDefault());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'sites' in changes) render();
});

render();
