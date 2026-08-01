#!/usr/bin/env python3
"""Build the CommonLit × TOEFL/SAT overlap as a derived vocabulary book."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Iterable


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
WEB_DATA_ROOT = REPOSITORY_ROOT / "apps" / "web" / "data"
CATALOG_PATH = WEB_DATA_ROOT / "vocabulary-book-catalog.json"
CONTENT_ROOT = WEB_DATA_ROOT / "vocabulary-book-content"
COMMONLIT_ROOT = WEB_DATA_ROOT / "commonlit-reading-vocabulary"

BOOK_ID = "high-frequency"
SOURCE_BOOK_IDS = ("toefl-sentences", "gre-random")
WORDS_PER_UNIT = 100
WORDS_PER_SECTION = 1_000
WORDS_PER_PAGE = 25
DETAIL_BLOCK_TYPES = {"definition", "note", "text"}


def normalize_headword(value: str) -> str:
    normalized = (
        value.replace("’", "'")
        .replace("‐", "-")
        .replace("–", "-")
        .strip(" .,:;·|")
        .casefold()
    )
    return re.sub(r"\s+", " ", normalized)


def content_files(book_id: str) -> Iterable[Path]:
    return sorted(
        path
        for path in (CONTENT_ROOT / book_id).glob("*.json")
        if path.name != "index.json"
    )


def load_book_headwords(book_id: str) -> set[str]:
    headwords: set[str] = set()
    for path in content_files(book_id):
        document = json.loads(path.read_text(encoding="utf-8"))
        for page in document.get("pages") or []:
            for block in page.get("blocks") or []:
                if block.get("type") != "entry" or not block.get("headword"):
                    continue
                headwords.add(normalize_headword(str(block["headword"])))
    return headwords


def normalize_note_text(value: str) -> str:
    text = re.sub(r"^[图园圆圈回口固困囵囫□■●◎]+", "", value.strip())
    memory = re.match(r"^(?:(?:词根|联想|词源)记忆|记忆)[：:]?\s*(.*)$", text)
    if memory:
        return f"记忆 {memory.group(1).strip()}"
    derived = re.match(r"^派生[：:]?\s*(.*)$", text)
    if derived:
        return f"同根 {derived.group(1).strip()}"
    return text


def source_detail_blocks() -> dict[str, list[dict[str, str]]]:
    """Reuse source-book word notes, never sentences, translations, or provenance."""
    details_by_headword: dict[str, list[dict[str, str]]] = {}
    for book_id in SOURCE_BOOK_IDS:
        for path in content_files(book_id):
            document = json.loads(path.read_text(encoding="utf-8"))
            for page in document.get("pages") or []:
                blocks = page.get("blocks") or []
                for index, block in enumerate(blocks):
                    if block.get("type") != "entry" or not block.get("headword"):
                        continue
                    headword = normalize_headword(str(block["headword"]))
                    if not headword or headword in details_by_headword:
                        continue
                    candidates: list[dict[str, str]] = []
                    for candidate in blocks[index + 1 :]:
                        block_type = str(candidate.get("type") or "")
                        text = str(candidate.get("text") or "").strip()
                        if block_type not in DETAIL_BLOCK_TYPES or not text:
                            break
                        if block_type == "text" and re.search(r"[：:]\s*$", text):
                            break
                        if book_id == "gre-random" and block_type != "note":
                            continue
                        if block_type == "note":
                            text = normalize_note_text(text)
                        candidates.append({"type": block_type, "text": text})
                    if candidates:
                        details_by_headword[headword] = candidates
    return details_by_headword


def load_commonlit_overlap(exam_headwords: set[str]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    for grade in range(3, 13):
        path = COMMONLIT_ROOT / f"grade-{grade:02d}.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        for article in document.get("articles") or []:
            for raw_entry in article.get("vocabulary") or []:
                entry = {key: str(value or "") for key, value in raw_entry.items()}
                normalized = normalize_headword(entry["word"])
                if (
                    not normalized
                    or normalized not in exam_headwords
                    or normalized in seen
                ):
                    continue
                seen.add(normalized)
                entries.append(entry)
    return entries


def entry_blocks(
    entry: dict[str, str],
    details_by_headword: dict[str, list[dict[str, str]]],
) -> list[dict[str, str]]:
    ipa = entry.get("ipa", "").strip()
    definition = entry.get("definition", "").strip()
    blocks = [
        {
            "type": "entry",
            "text": " ".join(
                value for value in (entry["word"], ipa, definition) if value
            ),
            "headword": entry["word"],
        }
    ]
    blocks.extend(details_by_headword.get(normalize_headword(entry["word"]), []))
    return blocks


def build_units(
    entries: list[dict[str, str]],
    details_by_headword: dict[str, list[dict[str, str]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    sections: list[dict[str, Any]] = []
    unit_documents: list[dict[str, Any]] = []
    next_page = 1

    for section_start in range(0, len(entries), WORDS_PER_SECTION):
        section_entries = entries[section_start : section_start + WORDS_PER_SECTION]
        section_word_start = section_start + 1
        section_word_end = section_start + len(section_entries)
        section_id = f"range-{section_word_start:04d}-{section_word_end:04d}"
        section_title = f"高频词汇 {section_word_start:04d}–{section_word_end:04d}"
        items: list[dict[str, Any]] = []
        section_page = next_page
        for unit_start in range(section_start, section_word_end, WORDS_PER_UNIT):
            unit_entries = entries[unit_start : unit_start + WORDS_PER_UNIT]
            unit_index = unit_start // WORDS_PER_UNIT + 1
            unit_id = f"word-list-{unit_index:03d}"
            word_start = unit_start + 1
            word_end = unit_start + len(unit_entries)
            title = f"高频词汇 {word_start:04d}–{word_end:04d}"
            page_count = math.ceil(len(unit_entries) / WORDS_PER_PAGE)
            page_start = next_page
            page_end = next_page + page_count - 1
            items.append(
                {
                    "id": unit_id,
                    "title": title,
                    "label": f"{len(unit_entries)} 词",
                    "page": page_start,
                }
            )

            pages: list[dict[str, Any]] = []
            for page_offset, page_entry_start in enumerate(
                range(0, len(unit_entries), WORDS_PER_PAGE)
            ):
                page_entries = unit_entries[
                    page_entry_start : page_entry_start + WORDS_PER_PAGE
                ]
                blocks: list[dict[str, str]] = []
                for entry in page_entries:
                    blocks.extend(entry_blocks(entry, details_by_headword))
                pages.append({"number": page_start + page_offset, "blocks": blocks})

            unit_documents.append(
                {
                    "schemaVersion": 1,
                    "bookId": BOOK_ID,
                    "unitId": unit_id,
                    "title": title,
                    "sectionId": section_id,
                    "sectionTitle": section_title,
                    "pageStart": page_start,
                    "pageEnd": page_end,
                    "extractionMethod": "text-layer",
                    "wordEntryCount": len(unit_entries),
                    "duplicateEntryCount": 0,
                    "pages": pages,
                }
            )
            next_page = page_end + 1

        sections.append(
            {
                "id": section_id,
                "title": section_title,
                "label": f"{len(section_entries):,} 词",
                "page": section_page,
                "items": items,
            }
        )

    return sections, unit_documents, next_page - 1


def write_book_content(unit_documents: list[dict[str, Any]]) -> None:
    destination = CONTENT_ROOT / BOOK_ID
    destination.mkdir(parents=True, exist_ok=True)
    expected_files = {f"{unit['unitId']}.json" for unit in unit_documents}
    for stale_path in destination.glob("*.json"):
        if stale_path.name != "index.json" and stale_path.name not in expected_files:
            stale_path.unlink()

    units: list[dict[str, Any]] = []
    for unit in unit_documents:
        (destination / f"{unit['unitId']}.json").write_text(
            json.dumps(unit, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        units.append(
            {
                "id": unit["unitId"],
                "wordEntryCount": unit["wordEntryCount"],
                "duplicateEntryCount": 0,
            }
        )

    index = {
        "schemaVersion": 1,
        "bookId": BOOK_ID,
        "wordEntryCount": sum(unit["wordEntryCount"] for unit in unit_documents),
        "duplicateEntryCount": 0,
        "units": units,
    }
    (destination / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def update_catalog(
    sections: list[dict[str, Any]],
    page_count: int,
    word_count: int,
) -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    base_books = [book for book in catalog["books"] if book["id"] != BOOK_ID]
    source_position = max(
        index for index, book in enumerate(base_books) if book["id"] in SOURCE_BOOK_IDS
    )
    derived_book = {
        "id": BOOK_ID,
        "sourceFile": "高频词汇",
        "pageCount": page_count,
        "cover": "",
        "extractionMethod": "text-layer",
        "title": "高频词汇",
        "shortTitle": "高频词汇",
        "author": "Aurelis English",
        "description": "按连续词序整理、每 100 词一组，并保留原词书词汇扩展信息的高频词表。",
        "scale": (
            f"{word_count:,} 个高频重合词汇 · "
            f"{sum(len(section['items']) for section in sections)} 个词组"
        ),
        "category": "高频",
        "tone": "teal",
        "features": ["美式发音", "音标与释义", "词汇扩展", "每 100 词一组"],
        "sections": sections,
        "contentReady": True,
        "wordEntryCount": word_count,
        "duplicateEntryCount": 0,
    }
    books = [
        *base_books[: source_position + 1],
        derived_book,
        *base_books[source_position + 1 :],
    ]

    unique_headwords: set[str] = set()
    for book in base_books:
        unique_headwords.update(load_book_headwords(book["id"]))
    catalog["summary"] = {
        "bookCount": len(books),
        "pageCount": sum(int(book["pageCount"]) for book in books),
        "learningUnitCount": sum(
            len(section["items"]) for book in books for section in book["sections"]
        ),
        "uniqueWordEntryCount": len(unique_headwords),
        "duplicateEntryCount": sum(
            int(book["duplicateEntryCount"]) for book in base_books
        ),
    }
    catalog["books"] = books
    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_high_frequency_book() -> None:
    exam_headwords: set[str] = set()
    for book_id in SOURCE_BOOK_IDS:
        exam_headwords.update(load_book_headwords(book_id))
    entries = load_commonlit_overlap(exam_headwords)
    details_by_headword = source_detail_blocks()
    sections, unit_documents, page_count = build_units(entries, details_by_headword)
    word_count = len(entries)
    if word_count != 6_734:
        raise RuntimeError(
            f"Expected 6,734 CommonLit overlap entries, found {word_count:,}"
        )
    write_book_content(unit_documents)
    update_catalog(sections, page_count, word_count)
    print(
        f"Built 高频词汇: {word_count:,} words, "
        f"{len(unit_documents)} units, {page_count} pages, "
        f"{sum(normalize_headword(entry['word']) in details_by_headword for entry in entries):,} "
        "entries with source-book details."
    )


if __name__ == "__main__":
    build_high_frequency_book()
