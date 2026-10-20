"""Stamp a compiled web release; never read credentials or application data."""
import hashlib
import json
import pathlib
import re
import sys


def stamp(directory, component, commit):
    if component not in {"customer", "admin"} or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("A component and exact Git commit are required")
    root = pathlib.Path(directory)
    required = ("index.html", "main.dart.js", "flutter_bootstrap.js")
    if not all((root / name).is_file() for name in required):
        raise ValueError("Incomplete Flutter web build")
    html = (root / "index.html").read_text()
    loader = re.compile(
        r"""<script\b[^>]*\bsrc=["']flutter_bootstrap\.js(?:\?[^"']*)?["'][^>]*>\s*</script>""",
        re.IGNORECASE,
    )
    if len(loader.findall(html)) != 1:
        raise ValueError("Expected exactly one Flutter bootstrap script")
    replacement = """
<script>
window.SERVICEPAY_BUILD_VERSION = __COMMIT_JSON__;
window.SERVICEPAY_COMPONENT = __COMPONENT_JSON__;
(async function () {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith("flutter-"))
        .map(name => caches.delete(name)));
    }
  } catch (error) {
    console.warn("ServicePay legacy cache cleanup failed", error);
  }
  const script = document.createElement("script");
  script.src = "flutter_bootstrap.js?v=" + window.SERVICEPAY_BUILD_VERSION;
  script.async = true;
  document.body.appendChild(script);
})();
</script>
""".replace("__COMMIT_JSON__", json.dumps(commit)).replace("__COMPONENT_JSON__", json.dumps(component))
    (root / "index.html").write_text(loader.sub(lambda _: replacement, html))
    worker = root / "flutter_service_worker.js"
    if worker.is_file():
        worker.unlink()
    manifest = {
        "component": component,
        "commit": commit,
        "sha256": {
            name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in required
        },
    }
    (root / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    stamp(*sys.argv[1:])
