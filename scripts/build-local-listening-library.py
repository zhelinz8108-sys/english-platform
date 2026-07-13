#!/usr/bin/env python3
"""Build the local Minute Earth + BBC listening catalogue used by demo mode."""

from __future__ import annotations

import argparse
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from docx import Document
from mutagen import File as MutagenFile
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)


AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx"}
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


@lru_cache(maxsize=None)
def extract_document(path: Path) -> tuple[str, int]:
    try:
        if path.suffix.casefold() == ".docx":
            document = Document(path)
            blocks = [paragraph.text for paragraph in document.paragraphs]
            for table in document.tables:
                blocks.extend("\t".join(cell.text for cell in row.cells) for row in table.rows)
            text = "\n".join(blocks)
        else:
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


def date_token_for_path(path: Path) -> str | None:
    """Prefer the episode folder date over legacy dates embedded in media names."""
    return normalized_date_token(path.parent.name) or normalized_date_token(path.stem)


def humanize_title(value: str) -> str:
    value = DUPLICATE_SUFFIX.sub("", value)
    value = re.sub(r"【[^】]*】|\[[^\]]*\]", "", value)
    value = re.sub(r"^(?:6minute[_-]?)?\d{6,8}[_ -]*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"(?:中英对照|对白|transcript|worksheet)$", "", value, flags=re.IGNORECASE)
    value = re.sub(
        r"(?:for[_ -]?web|download|audio|au[_ -]?bb|mp3)$",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value)
    value = re.sub(r"[_-]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or "BBC 6 Minute English"


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:72] or "episode"


TITLE_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "bbc",
    "english",
    "for",
    "is",
    "minute",
    "of",
    "the",
    "to",
}


def title_terms(value: str) -> set[str]:
    cleaned = humanize_title(value).casefold()
    return {
        word
        for word in re.findall(r"[a-z0-9]+", cleaned)
        if word not in TITLE_STOP_WORDS and not word.isdigit()
    }


def title_match_score(audio: Path, pdf: Path, *, inspect_content: bool) -> float:
    audio_source = audio.parent.name if normalized_date_token(audio.parent.name) else canonical_stem(audio)
    expected = title_terms(audio_source)
    if not expected:
        return 0
    filename_terms = title_terms(canonical_stem(pdf))
    score = len(expected & filename_terms) / len(expected)
    if score >= 0.6 or not inspect_content:
        return score
    transcript, _ = extract_document(pdf)
    first_page_terms = set(re.findall(r"[a-z0-9]+", transcript[:2500].casefold()))
    return max(score, len(expected & first_page_terms) / len(expected))


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


def choose_bbc_document(audio: Path, documents: list[Path]) -> Path | None:
    audio_date = date_token_for_path(audio)
    audio_stem = canonical_stem(audio).casefold()
    candidate_classes: dict[Path, int] = {}
    split_scope = (
        audio.parent.parent
        if re.search(r"audio|mp3|音频", audio.parent.name, flags=re.IGNORECASE)
        else None
    )
    for document in documents:
        document_date = date_token_for_path(document)
        # Older BBC packages keep differently named audio and transcript files
        # together in one episode directory. Newer packages split audio and
        # documents into sibling directories, so their release date is the
        # reliable join key.
        if document.parent == audio.parent:
            candidate_classes[document] = 0
        elif audio_date and document_date == audio_date:
            candidate_classes[document] = 1
        elif split_scope is not None and document.parent.parent == split_scope:
            candidate_classes[document] = 2
    if not candidate_classes:
        return None

    filename_scores = {
        path: title_match_score(audio, path, inspect_content=False) for path in candidate_classes
    }
    best_filename_score = max(filename_scores.values(), default=0)
    match_scores = {
        path: (
            filename_scores[path]
            if candidate_classes[path] < 2 or best_filename_score >= 0.6
            else title_match_score(audio, path, inspect_content=True)
        )
        for path in candidate_classes
    }
    candidates = [
        path
        for path, candidate_class in candidate_classes.items()
        if candidate_class < 2 or match_scores[path] >= 0.6
    ]
    if not candidates:
        return None

    def rank(path: Path) -> tuple[int, float, int, int, bool, int, str]:
        name = canonical_stem(path).casefold()
        if name == audio_stem:
            priority = 0
        elif "对白" in path.stem or "transcript" in name:
            priority = 1
        elif "中英对照" in path.stem or "中英文对照" in path.stem:
            priority = 2
        elif "worksheet" in name:
            priority = 4
        else:
            priority = 3
        return (
            candidate_classes[path],
            -match_scores[path],
            priority,
            0 if path.suffix.casefold() == ".pdf" else 1,
            bool(DUPLICATE_SUFFIX.search(path.stem)),
            len(path.name),
            path.name,
        )

    return sorted(candidates, key=rank)[0]


def build_bbc(root: Path, workers: int) -> list[dict[str, Any]]:
    audio_groups: dict[str, list[Path]] = {}
    documents = [
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() in DOCUMENT_EXTENSIONS
    ]
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        relative_parent = path.parent.relative_to(root).as_posix().casefold()
        key = relative_parent + "/" + canonical_stem(path).casefold()
        audio_groups.setdefault(key, []).append(path)

    audios = [preferred_copy(group) for group in audio_groups.values()]
    audios.sort(key=lambda path: (date_token_for_path(path) or "99999999", path.as_posix()))
    pairings = [(audio, choose_bbc_document(audio, documents)) for audio in audios]

    extracted: dict[Path, tuple[str, int]] = {}
    unique_documents = sorted({document for _, document in pairings if document is not None})
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {
            pool.submit(extract_document, document): document for document in unique_documents
        }
        for future in as_completed(futures):
            extracted[futures[future]] = future.result()

    items: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for sequence, (audio, document) in enumerate(pairings, start=1):
        date_token = date_token_for_path(audio)
        raw_title = audio.parent.name if normalized_date_token(audio.parent.name) else canonical_stem(audio)
        title = humanize_title(raw_title)
        base_id = f"bbc-{date_token or sequence:0>8}-{slug(title)}"
        item_id = base_id
        duplicate_index = 2
        while item_id in used_ids:
            item_id = f"{base_id}-{duplicate_index}"
            duplicate_index += 1
        used_ids.add(item_id)
        transcript, transcript_words = (
            extracted.get(document, ("", 0)) if document else ("", 0)
        )
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
                "documentPath": document.relative_to(root).as_posix() if document else None,
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
