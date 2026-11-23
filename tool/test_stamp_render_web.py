import hashlib
import json
import pathlib
import tempfile
import unittest

from stamp_render_web import stamp


class StartupStampTests(unittest.TestCase):
    def test_hashed_preloads_match_verified_executable_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "index.html").write_text(
                '<html><head></head><body><script src="flutter_bootstrap.js" async>'
                '</script></body></html>')
            (root / "main.dart.js").write_text('load("main.dart.js_1.part.js")')
            (root / "main.dart.js_1.part.js").write_text("deferred-feature")
            (root / "flutter_bootstrap.js").write_text(
                'var config={"mainJsPath":"main.dart.js"};')
            stamp(directory, "customer", "a" * 40)
            manifest = json.loads((root / "release.json").read_text())
            html = (root / "index.html").read_text()
            for entry in manifest["entrypoints"].values():
                self.assertIn(f'as="script" href="{entry}"', html.split("</head>")[0])
            self.assertIn("servicepay-cache-cleanup-start", html)
            self.assertIn("Try again", html)
            self.assertNotIn('src="flutter_bootstrap.js"', html)
            for name, expected in manifest["sha256"].items():
                self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), expected)
            self.assertIn(manifest["deferredParts"][0],
                          (root / manifest["entrypoints"]["main"]).read_text())

    def test_missing_deferred_code_fails_the_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "index.html").write_text(
                '<head></head><script src="flutter_bootstrap.js"></script>')
            (root / "main.dart.js").write_text('load("main.dart.js_1.part.js")')
            (root / "flutter_bootstrap.js").write_text('{"mainJsPath":"main.dart.js"}')
            with self.assertRaises(FileNotFoundError):
                stamp(directory, "customer", "a" * 40)
            self.assertFalse((root / "release.json").exists())


if __name__ == "__main__":
    unittest.main()
