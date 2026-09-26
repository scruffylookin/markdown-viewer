(() => {
  if (!MdvRules.shouldRender(location, document)) return;

  const rawText = document.body.innerText || document.body.textContent;

  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: true
  });

  const html = DOMPurify.sanitize(marked.parse(rawText));

  // Replace entire page
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  // Add viewport meta
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1';
  document.head.appendChild(meta);

  // Re-add our stylesheet
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles.css');
  document.head.appendChild(link);

  // Add highlight.js theme
  const hlTheme = document.createElement('link');
  hlTheme.rel = 'stylesheet';
  hlTheme.href = chrome.runtime.getURL('lib/github-dark.min.css');
  document.head.appendChild(hlTheme);

  // Set title from first heading or filename
  const filename = MdvRules.filenameFromPath(location.pathname);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const firstHeading = tempDiv.querySelector('h1, h2');
  document.title = firstHeading ? firstHeading.textContent : filename;

  // Build page structure
  const container = document.createElement('div');
  container.className = 'md-container';

  const header = document.createElement('div');
  header.className = 'md-header';
  const filenameSpan = document.createElement('span');
  filenameSpan.className = 'md-filename';
  filenameSpan.textContent = filename;
  header.appendChild(filenameSpan);

  const content = document.createElement('article');
  content.className = 'md-content markdown-body';
  content.innerHTML = html;

  container.appendChild(header);
  container.appendChild(content);
  document.body.appendChild(container);

  // Syntax-highlight code blocks
  content.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
})();
