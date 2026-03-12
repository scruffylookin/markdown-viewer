(() => {
  const url = window.location.href;
  if (!url.startsWith('file:///') || !url.endsWith('.md')) return;

  const rawText = document.body.innerText || document.body.textContent;

  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    }
  });

  const html = marked.parse(rawText);

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
  const filename = decodeURIComponent(url.split('/').pop());
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const firstHeading = tempDiv.querySelector('h1, h2');
  document.title = firstHeading ? firstHeading.textContent : filename;

  // Build page structure
  const container = document.createElement('div');
  container.className = 'md-container';

  const header = document.createElement('div');
  header.className = 'md-header';
  header.innerHTML = `<span class="md-filename">${filename}</span>`;

  const content = document.createElement('article');
  content.className = 'md-content markdown-body';
  content.innerHTML = html;

  container.appendChild(header);
  container.appendChild(content);
  document.body.appendChild(container);

  // Add checkbox interactivity for task lists
  content.querySelectorAll('li').forEach(li => {
    const text = li.innerHTML;
    if (text.startsWith('[ ] ')) {
      li.innerHTML = '<input type="checkbox" disabled> ' + text.slice(4);
      li.classList.add('task-list-item');
    } else if (text.startsWith('[x] ') || text.startsWith('[X] ')) {
      li.innerHTML = '<input type="checkbox" checked disabled> ' + text.slice(4);
      li.classList.add('task-list-item');
    }
  });
})();
