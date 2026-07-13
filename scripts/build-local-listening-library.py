#!/usr/bin/env python3
"""Build the local Minute Earth + BBC listening catalogue used by demo mode."""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from docx import Document
from mutagen import File as MutagenFile
from pypdf import PdfReader

try:
    import eng_to_ipa as english_ipa
except ImportError:  # IPA is helpful but catalogue generation can continue without it.
    english_ipa = None

logging.getLogger("pypdf").setLevel(logging.ERROR)


AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx"}
DUPLICATE_SUFFIX = re.compile(r"\s*\(\d+\)$")
DATE_PATTERN = re.compile(r"(?<!\d)(20\d{6}|\d{6})(?!\d)")
WORD_PATTERN = re.compile(r"\b[A-Za-z][A-Za-z'-]{3,}\b")
TERM_PATTERN = re.compile(
    r"^(?:[A-Za-z(][A-Za-z'()/-]*)(?: [A-Za-z(][A-Za-z'()/-]*){0,7}$"
)
VOCABULARY_MARKER = re.compile(r"(?im)^\s*VOCABULARY\s*$")
VOCABULARY_STOP_WORDS = {
    "about",
    "after",
    "again",
    "also",
    "another",
    "because",
    "before",
    "being",
    "between",
    "could",
    "didn't",
    "doesn't",
    "during",
    "english",
    "every",
    "first",
    "going",
    "great",
    "hello",
    "little",
    "maybe",
    "minute",
    "people",
    "programme",
    "question",
    "really",
    "right",
    "should",
    "something",
    "that's",
    "their",
    "there",
    "these",
    "thing",
    "think",
    "those",
    "through",
    "today",
    "using",
    "very",
    "we're",
    "we've",
    "well",
    "what's",
    "where",
    "which",
    "while",
    "would",
    "you're",
}


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


@lru_cache(maxsize=None)
def extract_document_layout(path: Path) -> str:
    try:
        if path.suffix.casefold() == ".docx":
            document = Document(path)
            return "\n\n".join(
                paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()
            )
        reader = PdfReader(path)
        pages: list[str] = []
        for page in reader.pages[-2:]:
            try:
                pages.append(page.extract_text(extraction_mode="layout") or "")
            except Exception:
                pages.append(page.extract_text() or "")
        return "\n".join(pages)
    except Exception:
        return ""


@lru_cache(maxsize=None)
def american_ipa(term: str) -> str:
    if english_ipa is None:
        return ""
    try:
        value = english_ipa.convert(term).strip()
        if not value or "*" in value:
            return ""
        return f"/{value}/"
    except Exception:
        return ""


def valid_vocabulary_term(value: str) -> bool:
    normalized = " ".join(value.split()).strip(" -")
    return (
        1 <= len(normalized) <= 80
        and bool(re.search(r"[A-Za-z]", normalized))
        and bool(TERM_PATTERN.fullmatch(normalized))
        and not re.search(r"^(?:bbc|minute english|page)$", normalized, flags=re.IGNORECASE)
    )


def extract_official_vocabulary(path: Path) -> list[dict[str, str]]:
    text = extract_document_layout(path)
    markers = list(VOCABULARY_MARKER.finditer(text))
    if not markers:
        return []
    segment = text[markers[-1].end() :]
    segment = re.split(
        r"(?im)^\s*(?:6 Minute English|bbclearningenglish\.com)", segment, maxsplit=1
    )[0]
    vocabulary: list[dict[str, str]] = []
    seen: set[str] = set()
    for block in re.split(r"\n\s*\n+", segment):
        lines = [" ".join(line.split()) for line in block.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        term = lines[0].strip(" -")
        definition = " ".join(lines[1:]).strip()
        key = term.casefold()
        if (
            key in seen
            or not valid_vocabulary_term(term)
            or len(definition.split()) < 2
            or len(definition) > 600
        ):
            continue
        seen.add(key)
        vocabulary.append(
            {"word": term, "ipa": american_ipa(term), "definition": definition}
        )
    return vocabulary[:15]


def context_sentence(transcript: str, word: str) -> str:
    pattern = re.compile(rf"\b{re.escape(word)}\b", flags=re.IGNORECASE)
    for candidate in re.split(r"\n+|(?<=[.!?])\s+", transcript):
        sentence = " ".join(candidate.split())
        if (
            pattern.search(sentence)
            and 35 <= len(sentence) <= 240
            and "http" not in sentence.casefold()
            and "bbclearningenglish.com" not in sentence.casefold()
        ):
            return sentence
    return ""


def add_context_vocabulary(items: list[dict[str, Any]]) -> None:
    transcripts = [str(item.get("transcript") or "") for item in items]
    document_frequency: Counter[str] = Counter()
    for transcript in transcripts:
        words = {
            match.group(0).casefold()
            for match in WORD_PATTERN.finditer(transcript)
            if match.group(0)[0].islower()
        }
        document_frequency.update(words)
    document_count = max(1, len([transcript for transcript in transcripts if transcript]))

    for item, transcript in zip(items, transcripts, strict=True):
        if item["vocabulary"] or not transcript:
            continue
        term_frequency: Counter[str] = Counter()
        for match in WORD_PATTERN.finditer(transcript):
            original = match.group(0)
            word = original.casefold().strip("'-")
            if (
                not original[0].islower()
                or word in VOCABULARY_STOP_WORDS
                or len(word) < 5
            ):
                continue
            term_frequency[word] += 1

        ranked: list[tuple[float, str]] = []
        for word, frequency in term_frequency.items():
            inverse_document_frequency = math.log(
                (document_count + 1) / (document_frequency[word] + 1)
            )
            score = inverse_document_frequency * (1 + math.log(frequency)) + min(len(word), 14) / 20
            ranked.append((score, word))
        ranked.sort(key=lambda entry: (-entry[0], entry[1]))

        vocabulary: list[dict[str, str]] = []
        for _, word in ranked[:80]:
            ipa = american_ipa(word)
            if english_ipa is not None and not ipa:
                continue
            sentence = context_sentence(transcript, word)
            if not sentence:
                continue
            vocabulary.append(
                {
                    "word": word,
                    "ipa": ipa,
                    "definition": f"原文语境：{sentence}",
                }
            )
            if len(vocabulary) == 10:
                break
        item["vocabulary"] = vocabulary


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
        elif "对白" in path.stem or "transcrip" in name:
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
                "vocabulary": extract_official_vocabulary(document) if document else [],
            }
        )
    add_context_vocabulary(items)
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
                "description": "2008-2026 年 BBC 六分钟英语，含音频、原版对话稿和重点词汇。",
                "count": len(bbc_items),
            },
        ],
        "items": minute_items + bbc_items,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    paired_bbc = sum(1 for item in bbc_items if item["documentPath"] and item["transcript"])
    vocabulary_bbc = sum(1 for item in bbc_items if item["vocabulary"])
    print(f"Minute Earth: {len(minute_items)} items")
    print(f"BBC: {len(bbc_items)} unique audio items, {paired_bbc} transcripts extracted")
    print(f"BBC vocabulary: {vocabulary_bbc} items")
    print(f"Output: {args.output} ({args.output.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
