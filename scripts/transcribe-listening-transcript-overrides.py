#!/usr/bin/env python3
"""Create verified transcript overrides from listening audio with local faster-whisper."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LIBRARY = ROOT / "apps" / "web" / "data" / "listening-library.json"
DEFAULT_OUTPUT = ROOT / "apps" / "web" / "data" / "listening-transcript-overrides.json"
DEFAULT_MINUTE_ROOT = Path(r"D:\留学\托福\听力\Minute Earth_仅讲话")
DEFAULT_BBC_ROOT = Path(r"D:\留学\托福\听力\【BBC】08-23年+bbc+6分钟英语等多个文件")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--minute-earth-root", type=Path, default=DEFAULT_MINUTE_ROOT)
    parser.add_argument("--bbc-root", type=Path, default=DEFAULT_BBC_ROOT)
    parser.add_argument("--id", dest="source_ids", action="append", default=[])
    parser.add_argument("--model", default="Systran/faster-whisper-large-v3")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--update-library", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
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


def audio_path(item: dict[str, Any], minute_root: Path, bbc_root: Path) -> Path:
    collection = str(item.get("collection") or "")
    root = minute_root if collection == "minute-earth" else bbc_root
    resolved_root = root.expanduser().resolve()
    relative = str(item.get("audioPath") or "")
    candidate = resolved_root.joinpath(*relative.split("/")).resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise SystemExit(f"Audio path escaped source root: {candidate}")
    if not candidate.is_file():
        raise SystemExit(f"Audio file is missing: {candidate}")
    return candidate


def compact_segments(segments: Any) -> str:
    parts = [str(segment.text).strip() for segment in segments if str(segment.text).strip()]
    return " ".join(parts).strip()


def main() -> None:
    args = parse_args()
    library = read_json(args.library.resolve())
    items = [item for item in library.get("items", []) if isinstance(item, dict)]
    item_by_id = {str(item.get("id")): item for item in items}
    if args.source_ids:
        missing_ids = sorted(set(args.source_ids) - set(item_by_id))
        if missing_ids:
            raise SystemExit(f"Unknown listening ids: {', '.join(missing_ids)}")
        selected = [item_by_id[source_id] for source_id in args.source_ids]
    else:
        selected = [
            item
            for item in items
            if not str(item.get("transcript") or "").strip()
            or int(item.get("transcriptWordCount") or 0) < 20
        ]
    if not selected:
        print("No transcript overrides are needed", flush=True)
        return
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        local_files_only=True,
    )
    output = read_json(args.output.resolve()) if args.output.is_file() else {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "items": [],
    }
    overrides = {
        str(item.get("id")): item
        for item in output.get("items", [])
        if isinstance(item, dict) and item.get("id")
    }
    for index, item in enumerate(selected, start=1):
        source_id = str(item["id"])
        source_audio = audio_path(
            item,
            args.minute_earth_root,
            args.bbc_root,
        )
        print(f"[{index}/{len(selected)}] Transcribing {source_id}: {source_audio.name}", flush=True)
        initial_prompt = (
            "BBC Learning English. 6 Minute English."
            if item.get("collection") == "bbc-6-minute-english"
            else "MinuteEarth science explanation."
        )
        segments, info = model.transcribe(
            str(source_audio),
            language="en",
            task="transcribe",
            beam_size=5,
            best_of=5,
            temperature=0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 350},
            condition_on_previous_text=True,
            initial_prompt=initial_prompt,
        )
        transcript = compact_segments(segments)
        word_count = len(transcript.split())
        if word_count < 100:
            raise SystemExit(
                f"Transcription for {source_id} is suspiciously short ({word_count} words)"
            )
        overrides[source_id] = {
            "id": source_id,
            "collection": item["collection"],
            "title": item["title"],
            "audioPath": item["audioPath"],
            "language": info.language,
            "languageProbability": round(float(info.language_probability), 6),
            "wordCount": word_count,
            "transcribedAt": datetime.now(timezone.utc).isoformat(),
            "transcript": transcript,
        }
        output["updatedAt"] = datetime.now(timezone.utc).isoformat()
        output["items"] = sorted(overrides.values(), key=lambda value: str(value["id"]))
        write_json(args.output, output)
        if args.update_library:
            item["transcript"] = transcript
            item["transcriptWordCount"] = word_count
            library["generatedAt"] = datetime.now(timezone.utc).isoformat()
            write_json(args.library, library)
        print(f"[{index}/{len(selected)}] {source_id}: {word_count} words", flush=True)


if __name__ == "__main__":
    main()
