#!/usr/bin/env python3
"""Shared helpers for TOEFL Academic Listening question-bank tools."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
SKILL_VERSION = "1.0.0"
COLLECTIONS = ("minute-earth", "bbc-6-minute-english")
OPTION_IDS = ("a", "b", "c", "d")
QUESTION_TYPES = (
    "main_idea",
    "detail",
    "rhetorical_purpose",
    "inference",
    "organization",
    "prediction",
)
HIGHER_ORDER_TYPES = {
    "rhetorical_purpose",
    "inference",
    "organization",
    "prediction",
}
DIFFICULTY_LEVELS = ("low", "medium", "high")
STATUSES = ("draft", "reviewed", "needs_adjudication", "adjudicated", "approved")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalized_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", compact_text(value).casefold()).strip()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"Missing JSON file: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid JSON in {path}: {error}") from error
    if not isinstance(value, dict):
        raise SystemExit(f"JSON root must be an object: {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def canonical_source(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "sourceId": compact_text(item.get("id")),
        "collection": compact_text(item.get("collection")),
        "title": compact_text(item.get("title")),
        "durationSeconds": item.get("durationSeconds"),
        "transcript": str(item.get("transcript") or ""),
    }


def source_hash(item: dict[str, Any]) -> str:
    payload = json.dumps(
        canonical_source(item),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_library(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    document = read_json(path)
    items = document.get("items")
    if not isinstance(items, list):
        raise SystemExit(f"Listening library has no items array: {path}")
    seen: set[str] = set()
    clean_items: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise SystemExit("Every listening-library item must be an object")
        source_id = compact_text(item.get("id"))
        collection = compact_text(item.get("collection"))
        if not source_id or source_id in seen:
            raise SystemExit(f"Missing or duplicate listening source id: {source_id!r}")
        if collection not in COLLECTIONS:
            raise SystemExit(f"Unsupported collection for {source_id}: {collection}")
        seen.add(source_id)
        clean_items.append(item)
    clean_items.sort(key=lambda item: (COLLECTIONS.index(item["collection"]), item.get("sequence", 0)))
    return document, clean_items


def profile_for(collection: str) -> str:
    if collection == "minute-earth":
        return "minute-earth-academic-talk"
    if collection == "bbc-6-minute-english":
        return "bbc-full-academic-discussion"
    raise ValueError(f"Unsupported collection: {collection}")


def label_for(collection: str) -> str:
    return (
        "TOEFL Academic Listening Practice"
        if collection == "minute-earth"
        else "TOEFL-style Academic Listening Practice"
    )


def exact_simulation_for(collection: str) -> bool:
    return collection == "minute-earth"


def transcript_region(start: int, transcript_length: int) -> str:
    if transcript_length <= 0:
        return "unknown"
    ratio = start / transcript_length
    if ratio < 1 / 3:
        return "beginning"
    if ratio < 2 / 3:
        return "middle"
    return "end"


def bank_sets(document: dict[str, Any]) -> list[dict[str, Any]]:
    sets = document.get("sets")
    if not isinstance(sets, list):
        raise SystemExit("Question bank must contain a sets array")
    if not all(isinstance(item, dict) for item in sets):
        raise SystemExit("Every question-bank set must be an object")
    return sets


def bank_by_source(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for question_set in bank_sets(document):
        source_id = compact_text(question_set.get("sourceId"))
        if not source_id or source_id in result:
            raise SystemExit(f"Missing or duplicate question-bank sourceId: {source_id!r}")
        result[source_id] = question_set
    return result
