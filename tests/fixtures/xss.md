# XSS Fixture

This fixture carries script-injection payloads. None of them may execute or survive rendering.

Image payload: <img src=x onerror="window.__xss=(window.__xss||0)+1">

<script>window.__xss=(window.__xss||0)+100</script>

Markdown javascript link: [click me](javascript:alert(1))

Raw javascript link: <a href="javascript:window.__xss=1">raw link</a>

<svg onload="window.__xss=1"><circle r="5"></circle></svg>

Safe text after payloads

Safe link: [ok](https://example.com)
