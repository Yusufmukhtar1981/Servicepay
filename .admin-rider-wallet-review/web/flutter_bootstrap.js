{{flutter_js}}
{{flutter_build_config}}

(async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('flutter-app-cache'))
        .map((key) => caches.delete(key)),
    );
  }

  await _flutter.loader.load();
})();