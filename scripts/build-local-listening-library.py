#!/usr/bin/env python3
"""Build the local Minute Earth + BBC listening catalogue used by demo mode."""

from __future__ import annotations

import argparse
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mutagen import File as MutagenFile
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)


AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}
DUPLICATE_SUFFIX = re.compile(r"\s*\(\d+\)$")
DATE_PATTERN = re.compile(r"(?<!\d)(20\d{6}|\d{6})(?!\d)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--minute-earth-root", type=Path, required=True)
    parser.add_argument("--minute-earth-study-content", type=Path, required=True)
    parser.add_argument("--bbc-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    return parser.parse_args()


def canonical_stem(path: Path) -> str:
    return DUPLICATE_SUFFIX.sub("", path.stem).strip()


def preferred_copy(paths: list[Path]) -> Path:
    return sorted(paths, key=lambda path: (bool(DUPLICATE_SUFFIX.search(path.stem)), len(path.name), path.name))[0]


def audio_duration(path: Path) -> int | None:
    try:
        audio = MutagenFile(path)
        if audio is None or audio.info is None:
            return None
        return round(float(audio.info.length))
    except Exception:
        return None


def clean_pdf_text(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    cleaned: list[str] = []
    for line in lines:
        if re.fullmatch(r"Page \d+ of \d+", line, flags=re.IGNORECASE):
            continue
        if re.fullmatch(r"©?\s*bbclearningenglish\.com\s*\d{4}", line, flags=re.IGNORECASE):
            continue
        if line or (cleaned and cleaned[-1]):
            cleaned.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned)).strip()


def extract_pdf(path: Path) -> tuple[str, int]:
    try:
        reader = PdfReader(path)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        cleaned = clean_pdf_text(text)
        return cleaned, len(cleaned.split())
    except Exception:
        return "", 0


def normalized_date_token(value: str) -> str | None:
    match = DATE_PATTERN.search(value)
    if not match:
        return None
    token = match.group(1)
    if len(token) == 8:
        return token
    year = int(token[:2])
    return ("20" if year < 50 else "19") + token


def humanize_title(value: str) -> str:
    value = DUPLICATE_SUFFIX.sub("", value)
    value = re.sub(r"^(?:6minute[_-]?)?\d{6,8}[_ -]*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"(?:中英对照|对白|transcript|worksheet)$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value)
    value = re.sub(r"[_-]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or "BBC 6 Minute English"


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:72] or "episode"


def build_minute_earth(root: Path, study_path: Path) -> list[dict[str, Any]]:
    document = json.loads(study_path.read_text(encoding="utf-8"))
    episodes = document.get("episodes", [])
    audio_candidates: dict[int, list[Path]] = {}
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        match = re.match(r"^(\d{3})", path.name)
        if not match:
            continue
        sequence = int(match.group(1))
        if 1 <= sequence <= 270 and "人声分离测试" not in path.parts:
            audio_candidates.setdefault(sequence, []).append(path)

    items: list[dict[str, Any]] = []
    for episode in episodes:
        sequence = int(episode["sequence"])
        candidates = audio_candidates.get(sequence, [])
        audio_path = preferred_copy(candidates) if candidates else None
        transcript = str(episode.get("transcript", "")).strip()
        items.append(
            {
                "id": f"minute-earth-{sequence:03d}",
                "collection": "minute-earth",
                "sequence": sequence,
                "title": episode.get("title") or f"Minute Earth {sequence:03d}",
                "publishedAt": None,
                "durationSeconds": episode.get("durationSeconds") or (audio_duration(audio_path) if audio_path else None),
                "sizeBytes": audio_path.stat().st_size if audio_path else 0,
                "audioPath": audio_path.relative_to(root).as_posix() if audio_path else None,
                "documentPath": None,
                "transcriptWordCount": episode.get("transcriptWordCount") or len(transcript.split()),
                "transcript": transcript,
                "vocabulary": episode.get("vocabulary", []),
            }
        )
    return items


def choose_bbc_pdf(audio: Path, pdfs: list[Path]) -> Path | None:
    audio_date = normalized_date_token(audio.stem + " " + audio.parent.name)
    audio_stem = canonical_stem(audio).casefold()
    candidates: list[Path] = []
    for pdf in pdfs:
        pdf_stem = canonical_stem(pdf).casefold()
        pdf_date = normalized_date_token(pdf.stem + " " + pdf.parent.name)
        if pdf.parent == audio.parent and pdf_stem == audio_stem:
            candidates.append(pdf)
        elif audio_date and pdf_date == audio_date:
            candidates.append(pdf)
    if not candidates:
        return None

    def rank(path: Path) -> tuple[int, bool, int, str]:
        name = canonical_stem(path).casefold()
        if name == audio_stem:
            priority = 0
        elif "对白" in path.stem or "transcript" in name:
            priority = 1
        elif "中英对照" in path.stem:
            priority = 2
        else:
            priority = 3
        return priority, bool(DUPLICATE_SUFFIX.search(path.stem)), len(path.name), path.name

    return sorted(candidates, key=rank)[0]


def build_bbc(root: Path, workers: int) -> list[dict[str, Any]]:
    audio_groups: dict[str, list[Path]] = {}
    pdfs = [path for path in root.rglob("*.pdf") if path.is_file()]
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        relative_parent = path.parent.relative_to(root).as_posix().casefold()
        key = relative_parent + "/" + canonical_stem(path).casefold()
        audio_groups.setdefault(key, []).append(path)

    audios = [preferred_copy(group) for group in audio_groups.values()]
    audios.sort(key=lambda path: (normalized_date_token(path.stem + " " + path.parent.name) or "99999999", path.as_posix()))
    pairings = [(audio, choose_bbc_pdf(audio, pdfs)) for audio in audios]

    extracted: dict[Path, tuple[str, int]] = {}
    unique_pdfs = sorted({pdf for _, pdf in pairings if pdf is not None})
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(extract_pdf, pdf): pdf for pdf in unique_pdfs}
        for future in as_completed(futures):
            extracted[futures[future]] = future.result()

    items: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for sequence, (audio, pdf) in enumerate(pairings, start=1):
        date_token = normalized_date_token(audio.stem + " " + audio.parent.name)
        raw_title = audio.parent.name if normalized_date_token(audio.parent.name) else canonical_stem(audio)
        title = humanize_title(raw_title)
        base_id = f"bbc-{date_token or sequence:0>8}-{slug(title)}"
        item_id = base_id
        duplicate_index = 2
        while item_id in used_ids:
            item_id = f"{base_id}-{duplicate_index}"
            duplicate_index += 1
        used_ids.add(item_id)
        transcript, transcript_words = extracted.get(pdf, ("", 0)) if pdf else ("", 0)
        items.append(
            {
                "id": item_id,
                "collection": "bbc-6-minute-english",
                "sequence": sequence,
                "title": title,
                "publishedAt": date_token,
                "durationSeconds": audio_duration(audio),
                "sizeBytes": audio.stat().st_size,
                "audioPath": audio.relative_to(root).as_posix(),
                "documentPath": pdf.relative_to(root).as_posix() if pdf else None,
                "transcriptWordCount": transcript_words,
                "transcript": transcript,
                "vocabulary": [],
            }
        )
    return items


def main() -> None:
    args = parse_args()
    minute_items = build_minute_earth(args.minute_earth_root.resolve(), args.minute_earth_study_content.resolve())
    bbc_items = build_bbc(args.bbc_root.resolve(), args.workers)
    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "collections": [
            {
                "id": "minute-earth",
                "label": "Minute Earth",
                "description": "科学与地球主题短篇，含音频、英文原文和 TOEFL/SAT 词汇。",
                "count": len(minute_items),
            },
            {
                "id": "bbc-6-minute-english",
                "label": "BBC 6 Minute English",
                "description": "2008-2026 年 BBC 六分钟英语，含音频和原版 PDF 对话稿。",
                "count": len(bbc_items),
            },
        ],
        "items": minute_items + bbc_items,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    paired_bbc = sum(1 for item in bbc_items if item["documentPath"] and item["transcript"])
    print(f"Minute Earth: {len(minute_items)} items")
    print(f"BBC: {len(bbc_items)} unique audio items, {paired_bbc} transcripts extracted")
    print(f"Output: {args.output} ({args.output.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
