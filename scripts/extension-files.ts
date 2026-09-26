// The files that make up the extension, relative to the repo root. The test
// harness stages exactly these into a temp dir to load the unpacked extension,
// and the release build zips exactly these, so a file missing here fails the
// tests instead of shipping a broken zip. Directories are copied recursively.
export const EXTENSION_FILES = [
  'manifest.json',
  'content.js',
  'rules.js',
  'background.js',
  'options.html',
  'options.js',
  'options.css',
  'styles.css',
  'lib',
  'icon48.png',
  'icon128.png',
];

// Shipped in the zip alongside the extension, but not needed to load it.
export const RELEASE_EXTRAS = ['README.md'];
