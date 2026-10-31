import hashlib
import json
import pathlib
import tempfile
import unittest

from stamp_render_web import stamp


class CustomerAssetVersioningTest(unittest.TestCase):
    def fixture(self, root, part=b"deferred code"):
        (root / "index.html").write_text(
            '<script src="flutter_bootstrap.js" async></script>'
        )
        (root / "flutter_bootstrap.js").write_text(
            'defaultPath="main.dart.js";config={"mainJsPath":"main.dart.js"};'
        )
        (root / "main.dart.js").write_text(
            'parts=["main.dart.js_1.part.js","main.dart.js_2.part.js"];'
        )
        (root / "main.dart.js_1.part.js").write_bytes(part)
        (root / "main.dart.js_2.part.js").write_bytes(b"second part")
        (root / "flutter_service_worker.js").write_text("old worker")

    def test_entire_script_chain_is_byte_versioned_and_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            stamp(root, "customer", "a" * 40)
            manifest = json.loads((root / "release.json").read_text())
            bootstrap = manifest["entrypoints"]["bootstrap"]
            main = manifest["entrypoints"]["main"]
            self.assertIn(bootstrap, (root / "index.html").read_text())
            self.assertIn(main, (root / bootstrap).read_text())
            self.assertIn('defaultPath="main.dart.js"', (root / bootstrap).read_text())
            for part in manifest["deferredParts"]:
                self.assertIn(part, (root / main).read_text())
            self.assertEqual(len(manifest["deferredParts"]), 2)
            for name, digest in manifest["sha256"].items():
                self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), digest)
            self.assertFalse((root / "flutter_service_worker.js").exists())
            self.assertTrue((root / "main.dart.js_1.part.js").is_file())

    def test_changed_chunk_changes_its_entire_entry_chain(self):
        results = []
        for part in (b"old", b"new"):
            with tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                self.fixture(root, part)
                stamp(root, "customer", "b" * 40)
                results.append(json.loads((root / "release.json").read_text()))
        self.assertNotEqual(results[0]["entrypoints"], results[1]["entrypoints"])
        self.assertNotEqual(results[0]["deferredParts"][0], results[1]["deferredParts"][0])
        self.assertEqual(results[0]["deferredParts"][1], results[1]["deferredParts"][1])

    def test_missing_part_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            (root / "main.dart.js_2.part.js").unlink()
            with self.assertRaises(FileNotFoundError):
                stamp(root, "customer", "c" * 40)

    def test_admin_url_behavior_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            stamp(root, "admin", "d" * 40)
            self.assertIn("flutter_bootstrap.js?v=" + "d" * 40,
                          (root / "index.html").read_text())
            manifest = json.loads((root / "release.json").read_text())
            self.assertEqual(manifest["deferredParts"], [])
            self.assertEqual(manifest["entrypoints"]["main"], "main.dart.js")


if __name__ == "__main__":
    unittest.main()
