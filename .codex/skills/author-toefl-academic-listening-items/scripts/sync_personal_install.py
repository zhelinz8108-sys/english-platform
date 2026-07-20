#!/usr/bin/env python3
"""Safely mirror the canonical project Skill into the personal Codex Skills directory."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import uuid
from pathlib import Path


SKILL_NAME = "author-toefl-academic-listening-items"
IGNORED_PARTS = {"__pycache__"}


def default_destination_root() -> Path:
    codex_home = os.environ.get("CODEX_HOME")
    return Path(codex_home).expanduser() / "skills" if codex_home else Path.home() / ".codex" / "skills"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Canonical Skill directory. Defaults to the directory containing this script.",
    )
    parser.add_argument("--destination-root", type=Path, default=default_destination_root())
    parser.add_argument("--check", action="store_true", help="Compare hashes without copying")
    return parser.parse_args()


def assert_skill_path(path: Path, *, parent: Path | None = None) -> Path:
    resolved = path.expanduser().resolve()
    if resolved.name != SKILL_NAME:
        raise SystemExit(f"Refusing unexpected Skill directory: {resolved}")
    if parent is not None and resolved.parent != parent.resolve():
        raise SystemExit(f"Skill destination escaped destination root: {resolved}")
    return resolved


def included_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in relative.parts):
            continue
        if path.is_symlink():
            raise SystemExit(f"Refusing to sync symbolic link: {path}")
        if path.is_file() and path.suffix != ".pyc":
            files.append(relative)
    return sorted(files, key=lambda value: value.as_posix())


def tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for relative in included_files(root):
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update((root / relative).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def safe_remove(path: Path, destination_root: Path) -> None:
    resolved = path.resolve()
    root = destination_root.resolve()
    if resolved.parent != root or not resolved.name.startswith(f".{SKILL_NAME}."):
        raise SystemExit(f"Refusing recursive removal outside managed temporary paths: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)


def main() -> None:
    args = parse_args()
    source = assert_skill_path(args.source)
    if not (source / "SKILL.md").is_file():
        raise SystemExit(f"Source is not a complete Skill: {source}")
    destination_root = args.destination_root.expanduser().resolve()
    destination = assert_skill_path(destination_root / SKILL_NAME, parent=destination_root)
    source_digest = tree_hash(source)
    if args.check:
        if not destination.is_dir():
            raise SystemExit(f"Personal Skill is not installed: {destination}")
        destination_digest = tree_hash(destination)
        if destination_digest != source_digest:
            raise SystemExit(
                f"Skill copies differ: source={source_digest}, destination={destination_digest}"
            )
        print(f"Skill copies match: {source_digest}")
        return
    destination_root.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    temporary = destination_root / f".{SKILL_NAME}.sync-{token}"
    backup = destination_root / f".{SKILL_NAME}.backup-{token}"
    if temporary.exists() or backup.exists():
        raise SystemExit("Unexpected managed temporary path collision")
    shutil.copytree(
        source,
        temporary,
        symlinks=False,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    copied_digest = tree_hash(temporary)
    if copied_digest != source_digest:
        safe_remove(temporary, destination_root)
        raise SystemExit("Copied Skill failed pre-install hash verification")
    moved_existing = False
    try:
        if destination.exists():
            if not destination.is_dir() or destination.is_symlink():
                raise SystemExit(f"Refusing to replace non-directory destination: {destination}")
            destination.replace(backup)
            moved_existing = True
        temporary.replace(destination)
        if tree_hash(destination) != source_digest:
            raise RuntimeError("Installed Skill failed post-install hash verification")
    except Exception:
        if destination.exists() and destination.is_dir() and not destination.is_symlink():
            failed = destination_root / f".{SKILL_NAME}.failed-{token}"
            destination.replace(failed)
            safe_remove(failed, destination_root)
        if moved_existing and backup.exists():
            backup.replace(destination)
        if temporary.exists():
            safe_remove(temporary, destination_root)
        raise
    if backup.exists():
        safe_remove(backup, destination_root)
    print(f"Installed {SKILL_NAME} to {destination} ({source_digest})", flush=True)


if __name__ == "__main__":
    main()
