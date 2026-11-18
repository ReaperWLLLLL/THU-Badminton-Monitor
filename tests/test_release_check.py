import importlib.util
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_release", ROOT / "scripts" / "check_release.py")
CHECK = None
if SPEC is not None and SPEC.loader is not None:
    try:
        CHECK = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(CHECK)
    except FileNotFoundError:
        CHECK = None


class ReleaseCheckTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(CHECK, "release checker is not implemented yet")
        self.temp = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temp.name) / "extension"
        shutil.copytree(ROOT, self.fixture, ignore=shutil.ignore_patterns("dist", "tests", ".git"))

    def tearDown(self):
        self.temp.cleanup()

    def test_public_source_fixture_is_clean(self):
        self.assertEqual(CHECK.scan_source(self.fixture), [])

    def test_rejects_realistic_credentials_and_jwt(self):
        target = self.fixture / "background.mjs"
        target.write_text(
            target.read_text()
            + '\nconst password = "CorrectHorseBatteryStaple";\n'
            + 'const totpSecret = "JBSWY3DPEHPK3PXP";\n'
            + 'const leakedJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature-value";\n',
            encoding="utf-8",
        )
        errors = CHECK.scan_source(self.fixture)
        self.assertTrue(any("password" in error for error in errors))
        self.assertTrue(any("JWT" in error for error in errors))

    def test_allows_public_placeholders_and_protocol_constants(self):
        (self.fixture / "background.mjs").write_text(
            (self.fixture / "background.mjs").read_text()
            + '\nconst placeholder = "your-webhook";\n'
            + 'const protocolKey = "57325972627c40bd8c77296d39293705";\n',
            encoding="utf-8",
        )
        self.assertEqual(CHECK.scan_source(self.fixture), [])

    def test_rejects_missing_manifest_reference(self):
        (self.fixture / "content.js").unlink()
        errors = CHECK.validate_manifest(self.fixture)
        self.assertTrue(any("content.js" in error for error in errors))

    def test_rejects_files_outside_package_allowlist(self):
        archive = Path(self.temp.name) / "extension.zip"
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"manifest_version": 3}))
            zf.writestr("chrome-extension/config.json", '{"password":"secret"}')
        errors = CHECK.validate_archive(archive)
        self.assertTrue(any("config.json" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
