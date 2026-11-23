(function () {
  "use strict";
  const config = window.SERVICEPAY_STARTUP;
  let ready = false;
  const mark = name => {
    try { performance.mark(name); } catch (_) {}
  };
  function failure() {
    if (ready) return;
    const shell = document.getElementById("servicepay-public-shell");
    const session = document.getElementById("servicepay-session-shell");
    if (!session) return;
    if (shell) shell.style.display = "none";
    session.style.display = "block";
    const message = session.querySelector("p");
    if (message) message.textContent =
      "ServicePay is taking longer to load. Check your connection and try again. Your account is still protected.";
    if (!session.querySelector("button")) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        retry.disabled = true;
        window.location.reload();
      });
      session.appendChild(retry);
    }
  }
  window.servicepayStartupFailure = failure;
  const loadingTimer = setTimeout(failure, 45000);
  window.addEventListener("flutter-first-frame", () => {
    ready = true;
    clearTimeout(loadingTimer);
    mark("servicepay-first-frame");
  }, { once: true });
  async function cleanupLegacyFlutter() {
    mark("servicepay-cache-cleanup-start");
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.filter(registration => {
          const worker = registration.active || registration.waiting || registration.installing;
          // Keep Firebase/push and any other non-Flutter service workers.
          return worker && new URL(worker.scriptURL).pathname.endsWith("/flutter_service_worker.js");
        }).map(registration => registration.unregister()));
      }
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith("flutter-"))
          .map(name => caches.delete(name)));
      }
    } catch (_) {
      // Cleanup is optional; all application JS has content-addressed URLs.
      mark("servicepay-cache-cleanup-failed");
    } finally {
      mark("servicepay-cache-cleanup-finished");
    }
  }
  (async () => {
    // Preload links already download the exact hashed scripts while legacy
    // cleanup runs. A stuck browser cache API cannot prevent startup forever.
    let timer;
    await Promise.race([
      cleanupLegacyFlutter(),
      new Promise(resolve => { timer = setTimeout(resolve, 500); })
    ]);
    clearTimeout(timer);
    const script = document.createElement("script");
    script.src = config.bootstrap;
    script.async = true;
    script.onerror = failure;
    mark("servicepay-bootstrap-injected");
    document.body.appendChild(script);
  })().catch(failure);
})();
