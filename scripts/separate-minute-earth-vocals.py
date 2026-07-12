"""Batch-separate Minute Earth narration from background audio with Demucs.

The source tree is never modified. Output files preserve the relative directory
layout and filenames so they can be passed directly to the existing importer.
The script is resumable: non-empty output files are skipped by default.
"""

from __future__ import annotations

import argparse
import gc
import sys
import time
from pathlib import Path

import torch
from demucs.api import Separator, save_audio


AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}
EXCLUDED_DIRECTORY_NAMES = {"人声分离测试"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Separate narration from Minute Earth background audio.",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--bitrate", type=int, default=192)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def discover_audio_files(source: Path) -> list[Path]:
    files = [
        path
        for path in source.rglob("*")
        if path.is_file()
        and path.suffix.lower() in AUDIO_EXTENSIONS
        and not any(part in EXCLUDED_DIRECTORY_NAMES for part in path.parts)
    ]

    def sort_key(path: Path) -> tuple[int, str]:
        prefix = path.stem.split(".", 1)[0]
        try:
            sequence = int(prefix)
        except ValueError:
            sequence = sys.maxsize
        return sequence, str(path).casefold()

    return sorted(files, key=sort_key)


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        raise SystemExit(f"Source directory does not exist: {source}")
    if output == source or source in output.parents:
        raise SystemExit("Output must be outside the source directory.")

    tracks = discover_audio_files(source)
    if not tracks:
        raise SystemExit(f"No supported audio files found under {source}")
    output.mkdir(parents=True, exist_ok=True)

    pending: list[tuple[Path, Path]] = []
    skipped = 0
    for track in tracks:
        relative = track.relative_to(source).with_suffix(".mp3")
        destination = output / relative
        if destination.is_file() and destination.stat().st_size > 0 and not args.overwrite:
            skipped += 1
        else:
            pending.append((track, destination))

    print(
        f"Found {len(tracks)} tracks; {len(pending)} pending; {skipped} already complete. "
        f"Device={args.device}, model={args.model}",
        flush=True,
    )
    if not pending:
        return 0

    separator = Separator(
        model=args.model,
        device=args.device,
        shifts=1,
        split=True,
        overlap=0.25,
        progress=False,
    )
    started_at = time.monotonic()
    failures: list[tuple[Path, str]] = []

    for index, (track, destination) in enumerate(pending, start=1):
        track_started_at = time.monotonic()
        temporary = destination.with_suffix(".partial.mp3")
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            if temporary.exists():
                temporary.unlink()
            original, stems = separator.separate_audio_file(track)
            narration = stems["vocals"]
            save_audio(
                narration,
                temporary,
                samplerate=separator.samplerate,
                bitrate=args.bitrate,
                preset=2,
                clip="rescale",
            )
            temporary.replace(destination)
            elapsed = time.monotonic() - track_started_at
            completed = skipped + index - len(failures)
            total_elapsed = time.monotonic() - started_at
            rate = index / total_elapsed if total_elapsed else 0
            remaining = (len(pending) - index) / rate if rate else 0
            print(
                f"[{index}/{len(pending)}] OK {track.name} ({elapsed:.1f}s); "
                f"total complete={completed}/{len(tracks)}; ETA={remaining / 60:.1f}m",
                flush=True,
            )
            del original, stems, narration
            if index % 20 == 0:
                gc.collect()
                if args.device.startswith("cuda"):
                    torch.cuda.empty_cache()
        except Exception as error:  # Continue so one damaged source does not stop the batch.
            if temporary.exists():
                temporary.unlink()
            failures.append((track, repr(error)))
            print(f"[{index}/{len(pending)}] FAILED {track}: {error!r}", flush=True)

    print(
        f"Finished: {len(tracks) - len(failures)} complete, {len(failures)} failed. "
        f"Output: {output}",
        flush=True,
    )
    for track, error in failures:
        print(f"FAILED\t{track}\t{error}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
