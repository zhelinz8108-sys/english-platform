#!/usr/bin/env python3
"""Prepare answer-free Codex payloads for authoring, blind review, or adjudication."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from question_bank_common import (
    COLLECTIONS,
    SCHEMA_VERSION,
    SKILL_VERSION,
    bank_by_source,
    bank_sets,
    compact_text,
    exact_simulation_for,
    label_for,
    load_library,
    profile_for,
    read_json,
    source_hash,
    utc_now,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--mode", choices=("author", "review", "adjudicate"), required=True)
    parser.add_argument("--collection", choices=COLLECTIONS)
    parser.add_argument("--id", dest="source_ids", action="append", default=[])
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--existing-bank", type=Path)
    parser.add_argument("--question-bank", type=Path)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def public_question(question: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": question.get("id"),
        "position": question.get("position"),
        "type": question.get("type"),
        "difficulty": question.get("difficulty"),
        "public": question.get("public"),
    }


def base_payload_item(source: dict[str, Any]) -> dict[str, Any]:
    collection = compact_text(source.get("collection"))
    return {
        "sourceId": source["id"],
        "collection": collection,
        "profile": profile_for(collection),
        "sourceHash": source_hash(source),
        "title": source.get("title"),
        "sequence": source.get("sequence"),
        "year": source.get("year"),
        "durationSeconds": source.get("durationSeconds"),
        "transcriptWordCount": source.get("transcriptWordCount"),
        "label": label_for(collection),
        "exactSimulation": exact_simulation_for(collection),
        "transcript": source.get("transcript"),
    }


def select_sources(
    items: list[dict[str, Any]],
    *,
    collection: str | None,
    source_ids: list[str],
    start: int,
) -> list[dict[str, Any]]:
    if start < 0:
        raise SystemExit("--start must be zero or greater")
    selected = [item for item in items if collection is None or item["collection"] == collection]
    if source_ids:
        requested = set(source_ids)
        known = {item["id"] for item in selected}
        missing = sorted(requested - known)
        if missing:
            raise SystemExit(f"Unknown or collection-mismatched source ids: {', '.join(missing)}")
        selected = [item for item in selected if item["id"] in requested]
    return selected[start:]


def prepare_author(args: argparse.Namespace, items: list[dict[str, Any]]) -> dict[str, Any]:
    if args.question_bank:
        raise SystemExit("--question-bank is not used in author mode")
    existing: dict[str, dict[str, Any]] = {}
    if args.existing_bank:
        existing = bank_by_source(read_json(args.existing_bank.resolve()))
    selected = select_sources(
        items,
        collection=args.collection,
        source_ids=args.source_ids,
        start=args.start,
    )
    payload_items: list[dict[str, Any]] = []
    skipped = 0
    skipped_missing_transcript = 0
    for source in selected:
        if not str(source.get("transcript") or "").strip():
            skipped_missing_transcript += 1
            continue
        current_hash = source_hash(source)
        previous = existing.get(source["id"])
        if previous and previous.get("sourceHash") == current_hash and not args.force:
            skipped += 1
            continue
        payload = base_payload_item(source)
        if previous and previous.get("sourceHash") != current_hash:
            payload["previousSourceHash"] = previous.get("sourceHash")
            payload["staleReason"] = "source-changed"
        payload_items.append(payload)
        if args.limit > 0 and len(payload_items) >= args.limit:
            break
    if not payload_items:
        raise SystemExit("No authoring items selected after resume filtering")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "skillVersion": SKILL_VERSION,
        "mode": "author",
        "generatedAt": utc_now(),
        "skippedUnchanged": skipped,
        "skippedMissingTranscript": skipped_missing_transcript,
        "instructions": (
            "Generate exactly four questions per item using the selected Skill and source profile. "
            "Return an author bank; do not change sourceId or sourceHash."
        ),
        "items": payload_items,
    }


def prepare_existing_mode(
    args: argparse.Namespace,
    sources: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if not args.question_bank:
        raise SystemExit(f"--question-bank is required in {args.mode} mode")
    if args.existing_bank:
        raise SystemExit(f"--existing-bank is not used in {args.mode} mode")
    bank = read_json(args.question_bank.resolve())
    candidates = bank_sets(bank)
    if args.collection:
        candidates = [item for item in candidates if item.get("collection") == args.collection]
    if args.source_ids:
        requested = set(args.source_ids)
        known = {compact_text(item.get("sourceId")) for item in candidates}
        missing = sorted(requested - known)
        if missing:
            raise SystemExit(f"Question bank does not contain: {', '.join(missing)}")
        candidates = [item for item in candidates if item.get("sourceId") in requested]
    candidates = candidates[args.start :]
    expected_status = "draft" if args.mode == "review" else "needs_adjudication"
    payload_items: list[dict[str, Any]] = []
    for question_set in candidates:
        if question_set.get("status") != expected_status:
            continue
        source_id = compact_text(question_set.get("sourceId"))
        source = sources.get(source_id)
        if source is None:
            raise SystemExit(f"Question-bank source is missing from library: {source_id}")
        if not str(source.get("transcript") or "").strip():
            raise SystemExit(f"Question-bank source has no transcript: {source_id}")
        current_hash = source_hash(source)
        if question_set.get("sourceHash") != current_hash:
            raise SystemExit(f"Source hash changed for {source_id}; regenerate before review")
        questions = question_set.get("questions")
        if not isinstance(questions, list):
            raise SystemExit(f"Question set has no questions array: {source_id}")
        if args.mode == "adjudicate":
            review = question_set.get("review")
            disagreements = review.get("disagreements") if isinstance(review, dict) else None
            if not isinstance(disagreements, list) or not disagreements:
                raise SystemExit(f"No recorded disagreements for {source_id}")
            wanted = set(disagreements)
            questions = [question for question in questions if question.get("id") in wanted]
        payload = base_payload_item(source)
        payload["questions"] = [public_question(question) for question in questions]
        if args.mode == "adjudicate":
            payload["instructions"] = (
                "Resolve every disputed item independently. Return a complete replacement answer, "
                "evidence, Chinese explanation, and four Chinese option rationales."
            )
        payload_items.append(payload)
        if args.limit > 0 and len(payload_items) >= args.limit:
            break
    if not payload_items:
        raise SystemExit(f"No {expected_status} sets selected")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "skillVersion": SKILL_VERSION,
        "mode": args.mode,
        "generatedAt": utc_now(),
        "instructions": (
            "Answer only from the transcript. Do not infer or request the hidden author answer. "
            "Flag any question without one uniquely defensible option."
        ),
        "items": payload_items,
    }


def main() -> None:
    args = parse_args()
    if args.limit < 0:
        raise SystemExit("--limit must be zero or greater")
    _, items = load_library(args.library.resolve())
    sources = {item["id"]: item for item in items}
    if args.mode == "author":
        payload = prepare_author(args, items)
    else:
        payload = prepare_existing_mode(args, sources)
    write_json(args.output, payload)
    print(
        f"Wrote {len(payload['items'])} {args.mode} item(s) to {args.output.resolve()}",
        flush=True,
    )


if __name__ == "__main__":
    main()
