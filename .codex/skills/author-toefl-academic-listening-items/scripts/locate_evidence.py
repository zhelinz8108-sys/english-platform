#!/usr/bin/env python3
"""Locate exact evidence quotes and report Python character offsets for one transcript."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from question_bank_common import load_library, transcript_region


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--quote", action="append", required=True)
    return parser.parse_args()


def all_offsets(transcript: str, quote: str) -> list[int]:
    offsets: list[int] = []
    start = 0
    while True:
        found = transcript.find(quote, start)
        if found < 0:
            return offsets
        offsets.append(found)
        start = found + 1


def main() -> None:
    args = parse_args()
    _, items = load_library(args.library.resolve())
    source = next((item for item in items if item["id"] == args.source_id), None)
    if source is None:
        raise SystemExit(f"Unknown source id: {args.source_id}")
    transcript = str(source.get("transcript") or "")
    results = []
    for quote in args.quote:
        offsets = all_offsets(transcript, quote)
        if len(offsets) != 1:
            raise SystemExit(
                f"Evidence quote must occur exactly once; found {len(offsets)} occurrence(s): {quote!r}"
            )
        start = offsets[0]
        results.append(
            {
                "start": start,
                "end": start + len(quote),
                "quote": quote,
                "region": transcript_region(start, len(transcript)),
            }
        )
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
