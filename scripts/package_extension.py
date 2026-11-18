"""Build the public Chrome extension archive from an explicit file allowlist."""

from __future__ import annotations

import zipfile
from pathlib import Path

from check_release import PACKAGE_FILES, check, validate_archive


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "dist" / "autobook-chrome-extension.zip"


def main() -> int:
    errors = check(ROOT)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in PACKAGE_FILES:
            archive.write(ROOT / name, name)

    archive_errors = validate_archive(ARCHIVE)
    if archive_errors:
        for error in archive_errors:
            print(f"ERROR: {error}")
        return 1
    print(ARCHIVE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
