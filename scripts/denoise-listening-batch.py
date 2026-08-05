"""Create speech-focused derivatives for one batch of listening-library audio.

The source tree is read-only. Each output keeps the storage format expected by
the catalog so the uploaded replacement remains compatible with existing
players. A JSON manifest is written only after every selected track passes
duration and non-empty-file validation.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

import imageio_ffmpeg
import mutagen
import torch
from demucs.api import Separator, save_audio


MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".wav": "audio/wav",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Separate narration from music and sustained background audio.",
    )
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--start-sequence", type=int, default=1)
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--version", default="speech-clean-v1")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--bitrate", type=int, default=128)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def detected_duration(path: Path) -> float | None:
    try:
        audio = mutagen.File(path)
        length = getattr(getattr(audio, "info", None), "length", None)
        return float(length) if length else None
    except Exception:
        return None


def storage_extension(audio_path: str) -> str:
    suffix = Path(audio_path).suffix.lower()
    return suffix if suffix in MEDIA_TYPES else ".mp3"


def save_derivative(
    narration: torch.Tensor,
    destination: Path,
    separator: Separator,
    bitrate: int,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.stem}.partial{destination.suffix}")
    temporary.unlink(missing_ok=True)

    if destination.suffix.lower() == ".mp3":
        wave_path = destination.with_name(f"{destination.stem}.partial.wav")
        wave_path.unlink(missing_ok=True)
        try:
            save_audio(
                narration,
                wave_path,
                samplerate=separator.samplerate,
                clip="rescale",
            )
            subprocess.run(
                [
                    imageio_ffmpeg.get_ffmpeg_exe(),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(wave_path),
                    "-vn",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    f"{bitrate}k",
                    str(temporary),
                ],
                check=True,
            )
        finally:
            wave_path.unlink(missing_ok=True)
    elif destination.suffix.lower() == ".wav":
        save_audio(
            narration,
            temporary,
            samplerate=separator.samplerate,
            clip="rescale",
        )
    elif destination.suffix.lower() == ".mp4":
        wave_path = destination.with_name(f"{destination.stem}.partial.wav")
        wave_path.unlink(missing_ok=True)
        try:
            save_audio(
                narration,
                wave_path,
                samplerate=separator.samplerate,
                clip="rescale",
            )
            subprocess.run(
                [
                    imageio_ffmpeg.get_ffmpeg_exe(),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(wave_path),
                    "-vn",
                    "-c:a",
                    "aac",
                    "-b:a",
                    f"{bitrate}k",
                    "-movflags",
                    "+faststart",
                    str(temporary),
                ],
                check=True,
            )
        finally:
            wave_path.unlink(missing_ok=True)
    else:  # pragma: no cover - guarded by storage_extension
        raise ValueError(f"Unsupported derivative extension: {destination.suffix}")

    if not temporary.is_file() or temporary.stat().st_size < 4096:
        raise RuntimeError(f"Encoded derivative is empty or too small: {temporary}")
    os.replace(temporary, destination)


def separation_input(source: Path, destination: Path) -> tuple[Path, bool]:
    """Return a WAV input Demucs can decode across inconsistent containers."""
    if source.suffix.lower() == ".wav":
        return source, False
    wave_path = destination.with_name(f"{destination.stem}.source.wav")
    wave_path.unlink(missing_ok=True)
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-acodec",
            "pcm_s16le",
            str(wave_path),
        ],
        check=True,
    )
    return wave_path, True


def main() -> int:
    args = parse_args()
    library_path = args.library.resolve()
    source_root = args.source_root.resolve()
    output_root = args.output.resolve()
    manifest_path = args.manifest.resolve()

    if not library_path.is_file():
        raise SystemExit(f"Library does not exist: {library_path}")
    if not source_root.is_dir():
        raise SystemExit(f"Source root does not exist: {source_root}")
    if args.start_sequence < 1 or args.limit < 1:
        raise SystemExit("--start-sequence and --limit must both be positive.")

    library = json.loads(library_path.read_text(encoding="utf-8"))
    candidates = sorted(
        (
            item
            for item in library.get("items", [])
            if item.get("collection") == args.collection
            and int(item.get("sequence", 0)) >= args.start_sequence
        ),
        key=lambda item: int(item["sequence"]),
    )[: args.limit]

    output_root.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    if not candidates:
        manifest_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "version": args.version,
                    "collection": args.collection,
                    "entries": [],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"No items remain in {args.collection} from sequence {args.start_sequence}.")
        return 0

    print(
        f"Preparing {len(candidates)} {args.collection} tracks from sequence "
        f"{candidates[0]['sequence']} on {args.device} with {args.model}.",
        flush=True,
    )
    separator = Separator(
        model=args.model,
        device=args.device,
        shifts=1,
        split=True,
        overlap=0.25,
        progress=False,
    )
    started_at = time.monotonic()
    entries: list[dict[str, object]] = []

    for index, item in enumerate(candidates, start=1):
        sequence = int(item["sequence"])
        source = source_root.joinpath(*str(item["audioPath"]).split("/")).resolve()
        if not source.is_file():
            raise FileNotFoundError(f"Catalog audio is missing: {source}")
        extension = storage_extension(str(item["audioPath"]))
        destination = output_root / args.collection / f"{sequence:04d}{extension}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        track_started_at = time.monotonic()

        if not (destination.is_file() and destination.stat().st_size > 4096 and not args.overwrite):
            input_path, remove_input = separation_input(source, destination)
            try:
                original, stems = separator.separate_audio_file(input_path)
                narration = stems["vocals"]
                save_derivative(narration, destination, separator, args.bitrate)
                del original, stems, narration
            finally:
                if remove_input:
                    input_path.unlink(missing_ok=True)

        source_duration = detected_duration(source) or float(item.get("durationSeconds") or 0)
        output_duration = detected_duration(destination)
        if not output_duration:
            destination.unlink(missing_ok=True)
            raise RuntimeError(f"Could not read derivative duration: {destination}")
        tolerance = max(3.0, source_duration * 0.03)
        if source_duration and abs(output_duration - source_duration) > tolerance:
            destination.unlink(missing_ok=True)
            raise RuntimeError(
                f"Duration mismatch for {item['id']}: source={source_duration:.2f}s, "
                f"output={output_duration:.2f}s"
            )

        output_size = destination.stat().st_size
        entries.append(
            {
                "id": item["id"],
                "collection": args.collection,
                "sequence": sequence,
                "sourcePath": str(source),
                "sourceSizeBytes": source.stat().st_size,
                "sourceSha256": sha256_file(source),
                "processedPath": str(destination),
                "processedSizeBytes": output_size,
                "processedSha256": sha256_file(destination),
                "durationSeconds": round(output_duration, 3),
                "extension": extension,
                "mediaType": MEDIA_TYPES[extension],
                "model": args.model,
                "bitrateKbps": args.bitrate if extension != ".wav" else None,
            }
        )
        elapsed = time.monotonic() - track_started_at
        total_elapsed = time.monotonic() - started_at
        remaining = total_elapsed / index * (len(candidates) - index)
        print(
            f"[{index}/{len(candidates)}] {item['id']} OK in {elapsed:.1f}s; "
            f"batch ETA {remaining / 60:.1f}m",
            flush=True,
        )
        if index % 6 == 0:
            gc.collect()
            if args.device.startswith("cuda"):
                torch.cuda.empty_cache()

    manifest = {
        "schemaVersion": 1,
        "version": args.version,
        "collection": args.collection,
        "model": args.model,
        "bitrateKbps": args.bitrate,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entries": entries,
    }
    temporary_manifest = manifest_path.with_suffix(f"{manifest_path.suffix}.partial")
    temporary_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary_manifest, manifest_path)
    print(f"Manifest ready: {manifest_path} ({len(entries)} entries).", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
