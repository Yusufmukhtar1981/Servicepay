"""Stamp the existing native Render web release without credentials or app data."""
import hashlib
import json
import pathlib
import re
import sys


def version_customer_scripts(root):
    main_path = root / "main.dart.js"
    main = main_path.read_text()
    parts = sorted(set(re.findall(r"main\.dart\.js_\d+\.part\.js", main)))
    versioned_parts = []
    for name in parts:
        data = (root / name).read_bytes()
        versioned = name.replace(".part.js", f".{hashlib.sha256(data).hexdigest()}.part.js")
        (root / versioned).write_bytes(data)
        main = main.replace(name, versioned)
        versioned_parts.append(versioned)
    main_path.write_text(main)
    main_name = f"main.{hashlib.sha256(main_path.read_bytes()).hexdigest()}.dart.js"
    (root / main_name).write_bytes(main_path.read_bytes())
    bootstrap_path = root / "flutter_bootstrap.js"
    bootstrap = bootstrap_path.read_text()
    entrypoint = re.compile(r'("mainJsPath"\s*:\s*)"main\.dart\.js"')
    if len(entrypoint.findall(bootstrap)) != 1:
        raise ValueError("Expected exactly one Flutter main entrypoint")
    bootstrap_path.write_text(entrypoint.sub(
        lambda match: match.group(1) + json.dumps(main_name), bootstrap))
    bootstrap_name = f"flutter_bootstrap.{hashlib.sha256(bootstrap_path.read_bytes()).hexdigest()}.js"
    (root / bootstrap_name).write_bytes(bootstrap_path.read_bytes())
    return bootstrap_name, main_name, versioned_parts


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
        re.IGNORECASE)
    if len(loader.findall(html)) != 1:
        raise ValueError("Expected exactly one Flutter bootstrap script")
    bootstrap_name, main_name, deferred_parts = "flutter_bootstrap.js", "main.dart.js", []
    if component == "customer":
        bootstrap_name, main_name, deferred_parts = version_customer_scripts(root)
        preloads = (
            f'<link rel="preload" as="script" href="{main_name}" fetchpriority="high">\n'
            f'<link rel="preload" as="script" href="{bootstrap_name}">\n')
        if html.count("</head>") != 1:
            raise ValueError("Expected one HTML head for deterministic preloading")
        html = html.replace("</head>", preloads + "</head>", 1)
        runtime = pathlib.Path(__file__).with_name("customer_startup.js").read_text()
        config = json.dumps({"bootstrap": bootstrap_name})
        replacement = (
            f"<script>window.SERVICEPAY_BUILD_VERSION={json.dumps(commit)};"
            f"window.SERVICEPAY_COMPONENT={json.dumps(component)};"
            f"window.SERVICEPAY_STARTUP={config};\n{runtime}\n</script>")
    else:
        # Admin isn't released by this Customer-only optimization.
        raise ValueError("Use the unchanged Admin release stamper for Admin builds")
    (root / "index.html").write_text(loader.sub(lambda _: replacement, html))
    worker = root / "flutter_service_worker.js"
    if worker.is_file():
        worker.unlink()
    manifest = {
        "component": component, "commit": commit,
        "entrypoints": {"bootstrap": bootstrap_name, "main": main_name},
        "deferredParts": deferred_parts,
        "sha256": {
            name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in dict.fromkeys([*required, bootstrap_name, main_name, *deferred_parts])
        },
    }
    (root / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    stamp(*sys.argv[1:])
