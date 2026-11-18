"""Offline release checks for the standalone public extension repository."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path


PACKAGE_FILES = (
    "manifest.json",
    "README.md",
    "PRIVACY.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    "LICENSE",
    "background.mjs",
    "content.js",
    "login-content.js",
    "popup.html",
    "popup.mjs",
    "popup.css",
    "lib/core.mjs",
    "lib/api.mjs",
    "lib/signature.mjs",
    "lib/auto-login.mjs",
    "icons/16.png",
    "icons/32.png",
    "icons/48.png",
    "icons/128.png",
)

PUBLIC_DOCS = {"README.md", "PRIVACY.md", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE"}
SCAN_SUFFIXES = {".js", ".mjs", ".json", ".py", ".yml", ".yaml", ".sh", ".ps1"}
IGNORED_SCAN_PARTS = {"tests", "dist", ".git", "__pycache__"}

JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
ABSOLUTE_PATH_RE = re.compile(r"/(?:Users|home)/[A-Za-z0-9._-]+/")
PASSWORD_RE = re.compile(
    r"(?:password|passwd|smtp_password)\s*[:=]\s*['\"](?!your-|example|fixture|replace|<)[^'\"]{8,}['\"]",
    re.IGNORECASE,
)
TOTP_RE = re.compile(
    r"(?:totp(?:_secret|secret)?|otp[_-]?secret)\s*[:=]\s*['\"]([A-Z2-7]{16,64})['\"]",
    re.IGNORECASE,
)
WEBHOOK_RE = re.compile(
    r"https://(?:open\.feishu\.cn/open-apis/bot/v2/hook|api\.day\.app)/[A-Za-z0-9_-]{16,}",
    re.IGNORECASE,
)


def _runtime_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SCAN_SUFFIXES:
            continue
        relative = path.relative_to(root)
        if any(part in IGNORED_SCAN_PARTS for part in relative.parts):
            continue
        if relative in {Path("manifest.json")} or relative.name not in PUBLIC_DOCS:
            yield path


def scan_source(root: Path) -> list[str]:
    errors: list[str] = []
    for path in _runtime_files(root):
        text = path.read_text(encoding="utf-8", errors="replace")
        relative = path.relative_to(root).as_posix()
        for label, pattern in (
            ("JWT", JWT_RE),
            ("private key", PRIVATE_KEY_RE),
            ("absolute local path", ABSOLUTE_PATH_RE),
            ("password", PASSWORD_RE),
            ("TOTP secret", TOTP_RE),
            ("Webhook/device secret", WEBHOOK_RE),
        ):
            if pattern.search(text):
                errors.append(f"{relative}: possible {label} literal")
    return errors


def _manifest_references(manifest: dict) -> set[str]:
    references: set[str] = set()
    background = manifest.get("background") or {}
    if isinstance(background.get("service_worker"), str):
        references.add(background["service_worker"])
    action = manifest.get("action") or {}
    for value in (action.get("default_popup"),):
        if isinstance(value, str):
            references.add(value)
    for value in (action.get("default_icon") or {}).values():
        if isinstance(value, str):
            references.add(value)
    for value in (manifest.get("icons") or {}).values():
        if isinstance(value, str):
            references.add(value)
    for script in manifest.get("content_scripts") or []:
        references.update(value for value in script.get("js", []) if isinstance(value, str))
        references.update(value for value in script.get("css", []) if isinstance(value, str))
    return references


def validate_manifest(root: Path) -> list[str]:
    errors: list[str] = []
    path = root / "manifest.json"
    if not path.is_file():
        return ["manifest.json is missing"]
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"manifest.json is invalid: {exc}"]
    if manifest.get("manifest_version") != 3:
        errors.append("manifest.json must use Manifest V3")
    if not re.fullmatch(r"\d+\.\d+\.\d+", str(manifest.get("version", ""))):
        errors.append("manifest.json version must use semver")
    if manifest.get("host_permissions") != ["https://www.sports.tsinghua.edu.cn/*"]:
        errors.append("manifest host permissions exceed the documented official sports site")
    if manifest.get("optional_host_permissions") not in ([], ["https://id.tsinghua.edu.cn/*"]):
        errors.append("manifest optional host permissions exceed the documented identity site")
    for reference in _manifest_references(manifest):
        if reference.startswith(("http://", "https://")):
            errors.append(f"manifest references remote executable asset: {reference}")
        elif not (root / reference).is_file():
            errors.append(f"manifest references missing file: {reference}")
    return errors


def validate_archive(archive_path: Path) -> list[str]:
    errors: list[str] = []
    try:
        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())
    except (OSError, zipfile.BadZipFile) as exc:
        return [f"archive is invalid: {exc}"]
    allowed = set(PACKAGE_FILES)
    for name in sorted(names - allowed):
        errors.append(f"archive contains forbidden file: {name}")
    for name in sorted(allowed - names):
        errors.append(f"archive is missing public file: {name}")
    return errors


def check(root: Path, archive: Path | None = None) -> list[str]:
    errors = validate_manifest(root) + scan_source(root)
    for name in PACKAGE_FILES:
        if not (root / name).is_file():
            errors.append(f"public file is missing: {name}")
    if archive:
        errors.extend(validate_archive(archive))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args(argv)
    errors = check(args.root, args.archive)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Release check passed for {args.root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
