---
name: GitHub Pages clean URLs
description: Records how to serve an exact slashless compliance URL from the customer GitHub Pages site.
---

For an exact slashless public URL on the ServicePay GitHub Pages site, publish a root HTML file such as `privacy-policy.html`. Do not use a same-named directory with `index.html` when the URL must itself return HTTP 200.

**Why:** GitHub Pages serves a directory path with an HTTP 301 redirect to a trailing slash, while its clean-URL handling serves the matching root HTML file directly with HTTP 200.

**How to apply:** Use a root HTML artifact for public compliance URLs that external reviewers validate literally, then test without `curl -L` to ensure there is no hidden redirect.