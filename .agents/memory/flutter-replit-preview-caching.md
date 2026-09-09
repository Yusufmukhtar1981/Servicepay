---
name: Flutter web cache isolation
description: Prevent stale Flutter service workers from mixing old and new web release assets.
---

Flutter web deployments that replace release assets in place must not rely only on a newly generated service worker stub. The bootstrap should unregister legacy workers and delete Flutter app caches before loading without a service worker when reliable freshness matters more than offline PWA behavior.

**Why:** A previously installed worker can continue serving an older engine shell with newer application assets, producing intermittent washed-out or otherwise inconsistent rendering across browsers.

**How to apply:** For non-PWA Admin deployments, build with PWA caching disabled and keep explicit legacy worker/cache cleanup in the web bootstrap. Verify the generated release bootstrap, not only the source template. SPA fallback servers must strip query strings before checking whether cache-busted assets exist; otherwise valid JavaScript requests can be replaced with `index.html` and fail MIME validation.