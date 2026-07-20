#!/usr/bin/env python3
"""Build the local vocabulary library, extracted text, OCR, and cover images."""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import re
from pathlib import Path
from typing import Any, Iterable

import fitz
from PIL import Image


GRE_PRINTED_START_PAGES = [
    1, 13, 25, 37, 49, 61, 72, 84, 96, 109, 120, 131, 141, 154, 166,
    177, 189, 200, 211, 222, 234, 244, 254, 264, 273, 282, 291, 300,
    309, 318, 327, 337, 347, 357, 367, 376, 385, 394, 403, 412, 421,
    430, 439, 448, 456, 465,
]

SECTION_PREFIXES = (
    "语法笔记",
    "核心词表",
    "主题归纳",
    "词根、词缀预习表",
    "词根词缀预习表",
    "场景词",
    "实景对话",
    "Conversation",
    "拓展练习",
)
NOTE_PREFIXES = (
    "◎",
    "搭配",
    "同义",
    "反义",
    "同根",
    "记忆",
    "联想记忆",
    "词根记忆",
    "派生",
    "辨析",
    "参考",
    "提示",
    "园联想",
    "园词根",
    "图联想",
    "图词根",
    "圆联想",
    "圆词根",
)
PART_OF_SPEECH = re.compile(
    r"^(?:interj|prep|pron|conj|adj[il]?|adv|aux|num|vt|vi|ad|n|v|a)"
    r"(?:\s*\.|\s+(?=\S)|(?=[\u3400-\u9fff]))\s*",
    re.IGNORECASE,
)
ASCII_HEADWORD = re.compile(r"^[A-Za-z][A-Za-z'’\- ]{0,62}$")
CJK = re.compile(r"[\u3400-\u9fff]")

_OCR_DOCUMENT: fitz.Document | None = None
_OCR_ENGINE: Any = None
_OCR_SCALE = 0.9


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("source") / "单词书",
        help="Directory containing the three source PDFs.",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("apps/web/data/vocabulary-book-catalog.json"),
        help="Generated catalog JSON path.",
    )
    parser.add_argument(
        "--content",
        type=Path,
        default=Path("apps/web/data/vocabulary-book-content"),
        help="Generated per-unit web-text directory.",
    )
    parser.add_argument(
        "--covers",
        type=Path,
        default=Path("apps/web/public/vocabulary-books/covers"),
        help="Generated cover-image directory.",
    )
    parser.add_argument(
        "--ocr-cache",
        type=Path,
        default=Path("tmp/pdfs/vocabulary-book-ocr/gre-random"),
        help="Resumable GRE page-OCR cache.",
    )
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--ocr-scale", type=float, default=0.9)
    parser.add_argument(
        "--skip-gre-ocr",
        action="store_true",
        help="Build the catalog and text-layer books without running GRE OCR.",
    )
    return parser.parse_args()


def find_sources(source: Path) -> dict[str, Path]:
    by_page_count: dict[int, Path] = {}
    for pdf_path in sorted(source.glob("*.pdf")):
        with fitz.open(pdf_path) as document:
            by_page_count[document.page_count] = pdf_path
    required = {659: "toefl-sentences", 492: "gre-random", 2210: "situational-15000"}
    missing = [page_count for page_count in required if page_count not in by_page_count]
    if missing:
        raise FileNotFoundError(f"Missing expected source PDFs with page counts: {missing}")
    return {book_id: by_page_count[page_count] for page_count, book_id in required.items()}


def render_cover(document: fitz.Document, destination: Path) -> None:
    page = document.load_page(0)
    target_width = 520
    scale = target_width / page.rect.width
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "WEBP", quality=86, method=6)


def sentence_sections(document: fitz.Document) -> list[dict[str, Any]]:
    starts: dict[int, int] = {}
    pattern = re.compile(r"^Sentence\s+(\d{2,3})\s*$", re.MULTILINE)
    for page_index in range(10, document.page_count):
        text = document.load_page(page_index).get_text("text")
        for match in pattern.finditer(text):
            sentence_number = int(match.group(1))
            if 1 <= sentence_number <= 100:
                starts.setdefault(sentence_number, page_index + 1)
    if len(starts) != 100:
        missing = [number for number in range(1, 101) if number not in starts]
        raise ValueError(f"Could not locate all TOEFL sentences; missing {missing}")
    return [
        {
            "id": f"sentences-{group_start:03d}",
            "title": f"Sentence {group_start:02d}-{group_start + 9:02d}",
            "page": starts[group_start],
            "items": [
                {
                    "id": f"sentence-{number:03d}",
                    "title": f"Sentence {number:02d}",
                    "page": starts[number],
                }
                for number in range(group_start, group_start + 10)
            ],
        }
        for group_start in range(1, 101, 10)
    ]


def situational_sections(document: fitz.Document) -> list[dict[str, Any]]:
    chapters: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for level, title, page in document.get_toc(simple=True):
        if level == 1 and title.startswith("Chapter"):
            number_match = re.match(r"Chapter\s*(\d+)", title)
            number = int(number_match.group(1)) if number_match else len(chapters) + 1
            current = {
                "id": f"chapter-{number:02d}",
                "title": re.sub(r"^Chapter\s*\d+\s*", "", title).strip(),
                "label": f"Chapter {number}",
                "page": page,
                "items": [],
            }
            chapters.append(current)
        elif level == 2 and current is not None:
            item_match = re.match(r"(\d{2,3})\s+(.+)", title.strip())
            if item_match:
                current["items"].append(
                    {
                        "id": f"scene-{int(item_match.group(1)):03d}",
                        "title": item_match.group(2).strip(),
                        "label": item_match.group(1),
                        "page": page,
                    }
                )
    if len(chapters) != 20 or sum(len(chapter["items"]) for chapter in chapters) != 448:
        raise ValueError("Unexpected chapter structure in the 15000-word source PDF")
    return chapters


def gre_sections() -> list[dict[str, Any]]:
    starts = [printed_page + 17 for printed_page in GRE_PRINTED_START_PAGES]
    return [
        {
            "id": "gre-core" if index < 20 else "gre-extended",
            "title": "核心词汇" if index < 20 else "拓展词汇",
            "page": starts[index],
            "items": [
                {
                    "id": f"word-list-{number:02d}",
                    "title": f"Word List {number:02d}",
                    "page": starts[number - 1],
                }
                for number in (range(1, 21) if index < 20 else range(21, 47))
            ],
        }
        for index in (0, 20)
    ]


def build_book(book_id: str, path: Path, covers: Path) -> dict[str, Any]:
    with fitz.open(path) as document:
        render_cover(document, covers / f"{book_id}.webp")
        common = {
            "id": book_id,
            "sourceFile": path.name,
            "pageCount": document.page_count,
            "cover": f"/vocabulary-books/covers/{book_id}.webp",
            "extractionMethod": "ocr" if book_id == "gre-random" else "text-layer",
        }
        if book_id == "toefl-sentences":
            return {
                **common,
                "title": "100个句子记完7000个托福单词",
                "shortTitle": "托福 100 句词汇",
                "author": "俞敏洪",
                "description": "以 100 个托福典型长句为主线，串联核心词、主题词汇和搭配。",
                "scale": "100 个句子 · 约 7000 个相关词汇",
                "category": "TOEFL",
                "tone": "teal",
                "features": ["核心词表", "主题归纳", "长难句"],
                "sections": sentence_sections(document),
            }
        if book_id == "gre-random":
            return {
                **common,
                "title": "GRE词汇精选 乱序版",
                "shortTitle": "GRE 词汇精选",
                "author": "俞敏洪",
                "description": "按 46 个 Word List 乱序编排 GRE 核心与拓展词汇，包含英文释义、词根和联想记忆。",
                "scale": "46 个 Word List",
                "category": "GRE",
                "tone": "plum",
                "features": ["乱序编排", "英文释义", "词根词缀", "同反义词"],
                "sections": gre_sections(),
            }
        return {
            **common,
            "title": "超实用15000词分类速记",
            "shortTitle": "15000 分类词汇",
            "author": "俞敏洪",
            "description": "围绕生活、学习、职场、社会与学科场景分类，按认知顺序组织常用词、短语与对话。",
            "scale": "20 章 · 448 个场景 · 15000+ 词汇",
            "category": "场景分类",
            "tone": "amber",
            "features": ["场景词汇", "短语搭配", "情景对话", "20 大主题"],
            "sections": situational_sections(document),
        }


def flatten_units(book: dict[str, Any]) -> list[dict[str, Any]]:
    located: list[dict[str, Any]] = []
    for section in book["sections"]:
        for item in section["items"]:
            located.append({**item, "sectionId": section["id"], "sectionTitle": section["title"]})
    for index, item in enumerate(located):
        next_page = located[index + 1]["page"] if index + 1 < len(located) else book["pageCount"] + 1
        item["pageEnd"] = max(item["page"], next_page - 1)
    return located


def clean_line(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u00ad", "").replace("\u200b", " ")).strip()


def text_layer_lines(page: fitz.Page) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    width = max(page.rect.width, 1)
    height = max(page.rect.height, 1)
    for block in page.get_text("dict", sort=True)["blocks"]:
        for line in block.get("lines", []):
            text = clean_line("".join(span["text"] for span in line["spans"]))
            if not text:
                continue
            x0, y0, _, _ = line["bbox"]
            lines.append({"text": text, "x": x0 / width, "y": y0 / height})
    return lines


def init_ocr_worker(pdf_path: str, scale: float, threads: int) -> None:
    global _OCR_DOCUMENT, _OCR_ENGINE, _OCR_SCALE
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    from rapidocr_onnxruntime import RapidOCR

    _OCR_DOCUMENT = fitz.open(pdf_path)
    # RapidOCR defaults every model session to every CPU core. Explicitly limiting
    # each worker prevents four page workers from fighting over the same 16 cores.
    _OCR_ENGINE = RapidOCR(
        intra_op_num_threads=threads,
        inter_op_num_threads=1,
        use_cls=False,
    )
    _OCR_SCALE = scale


def ocr_page(page_number: int) -> tuple[int, list[dict[str, Any]]]:
    import numpy as np

    if _OCR_DOCUMENT is None or _OCR_ENGINE is None:
        raise RuntimeError("OCR worker was not initialized")
    page = _OCR_DOCUMENT.load_page(page_number - 1)
    rect = page.rect
    clip = fitz.Rect(
        rect.x0 + rect.width * 0.035,
        rect.y0 + rect.height * 0.025,
        rect.x1 - rect.width * 0.035,
        rect.y1 - rect.height * 0.085,
    )
    pixmap = page.get_pixmap(matrix=fitz.Matrix(_OCR_SCALE, _OCR_SCALE), clip=clip, alpha=False)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )
    result, _ = _OCR_ENGINE(image, use_cls=False)
    lines: list[dict[str, Any]] = []
    for box, raw_text, score in result or []:
        text = clean_line(raw_text)
        if not text or score < 0.42:
            continue
        x = min(point[0] for point in box) / max(pixmap.width, 1)
        y = min(point[1] for point in box) / max(pixmap.height, 1)
        lines.append({"text": text, "x": round(x, 5), "y": round(y, 5)})
    lines.sort(key=lambda line: (round(line["y"] / 0.012), line["x"], line["y"]))
    return page_number, lines


def ensure_gre_ocr(pdf_path: Path, cache: Path, workers: int, scale: float) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    pages = list(range(18, 493))
    missing = [page for page in pages if not (cache / f"page-{page:04d}.json").is_file()]
    if not missing:
        print("GRE OCR cache complete (475/475 pages)", flush=True)
        return
    print(f"GRE OCR: {len(missing)} pages remaining; using {workers} workers", flush=True)
    context = multiprocessing.get_context("spawn")
    completed = len(pages) - len(missing)
    threads_per_worker = max(1, min(8, (os.cpu_count() or 1) // max(1, workers)))
    with context.Pool(
        processes=max(1, workers),
        initializer=init_ocr_worker,
        initargs=(str(pdf_path), scale, threads_per_worker),
    ) as pool:
        for page_number, lines in pool.imap_unordered(ocr_page, missing, chunksize=1):
            destination = cache / f"page-{page_number:04d}.json"
            destination.write_text(
                json.dumps({"page": page_number, "lines": lines}, ensure_ascii=False),
                encoding="utf-8",
            )
            completed += 1
            if completed % 10 == 0 or completed == len(pages):
                print(f"GRE OCR progress: {completed}/{len(pages)} pages", flush=True)


def canonical_headword(value: str) -> str:
    value = value.replace("’", "'").replace("‐", "-").replace("–", "-")
    value = re.sub(r"\s+", " ", value.strip(" .,:;·|"))
    return value.casefold()


def detect_headword(
    line: dict[str, Any], extraction: str, book_id: str
) -> tuple[str, str] | None:
    text = line["text"].strip()
    if not text or text.startswith(("◎", "□", "○", "●")):
        return None
    candidate = ""
    phonetic_match = re.match(
        r"^([A-Za-z][A-Za-z'’\- ]{0,62}?)\s*"
        r"(?=(?:/[^/\n]{1,42}/\s*(?:n|v|vt|vi|adj|adv|ad|a)\s*\.|"
        r"\[[^\]\n]{1,42}\]))",
        text,
        re.IGNORECASE,
    )
    if phonetic_match:
        candidate = phonetic_match.group(1)
    elif book_id == "situational-15000" and CJK.search(text):
        chinese_index = CJK.search(text).start()
        prefix = text[:chinese_index].rstrip(" （(").strip()
        if ASCII_HEADWORD.fullmatch(prefix):
            candidate = prefix
    elif extraction == "ocr" and line.get("x", 1) < 0.23 and ASCII_HEADWORD.fullmatch(text):
        if len(text.split()) <= 4 and not text.lower().startswith(("word list", "wordlist")):
            candidate = text
    candidate = candidate.strip()
    if not candidate or candidate.casefold() in {"step", "conversation"}:
        return None
    normalized = canonical_headword(candidate)
    if not normalized or len(normalized) > 64:
        return None
    return candidate, normalized


def classify_line(
    line: dict[str, Any], extraction: str, book_id: str
) -> dict[str, Any] | None:
    text = line["text"]
    if extraction == "ocr" and line.get("y", 0) > 0.965:
        return None
    if re.match(r"^(?:Sentence\s*\d+|Word\s*List\s*\d+|\d{2,3}\s+\S)", text, re.I):
        return {"type": "title", "text": text}
    if text.startswith(SECTION_PREFIXES) or re.match(r"^Step\s*\d+", text, re.I):
        return {"type": "section", "text": text}
    if re.match(r"^[AB]\s*[:：]", text):
        return {"type": "example", "text": text}
    headword = detect_headword(line, extraction, book_id)
    if headword:
        display, normalized = headword
        return {"type": "entry", "text": text, "headword": display, "normalized": normalized}
    if PART_OF_SPEECH.match(text):
        return {"type": "definition", "text": text}
    if text.startswith(NOTE_PREFIXES):
        return {"type": "note", "text": text}
    if len(text) > 75 and re.search(r"[.!?。！？]", text):
        return {"type": "example", "text": text}
    return {"type": "text", "text": text}


def page_blocks(
    lines: Iterable[dict[str, Any]], extraction: str, book_id: str
) -> list[dict[str, Any]]:
    return [
        block
        for line in lines
        if (block := classify_line(line, extraction, book_id)) is not None
    ]


def raw_unit_pages(
    document: fitz.Document | None,
    book: dict[str, Any],
    unit: dict[str, Any],
    ocr_cache: Path,
) -> list[dict[str, Any]]:
    extraction = book["extractionMethod"]
    pages: list[dict[str, Any]] = []
    for page_number in range(unit["page"], unit["pageEnd"] + 1):
        if extraction == "ocr":
            payload = json.loads((ocr_cache / f"page-{page_number:04d}.json").read_text(encoding="utf-8"))
            lines = payload["lines"]
        else:
            if document is None:
                raise RuntimeError("Text-layer extraction requires an open document")
            lines = text_layer_lines(document.load_page(page_number - 1))
        pages.append(
            {"number": page_number, "blocks": page_blocks(lines, extraction, book["id"])}
        )
    return pages


def deduplicate_pages(
    pages: list[dict[str, Any]], seen: set[str]
) -> tuple[list[dict[str, Any]], int, int]:
    kept_entries = 0
    removed_entries = 0
    skipping_duplicate = False
    output: list[dict[str, Any]] = []
    for page in pages:
        blocks: list[dict[str, Any]] = []
        for block in page["blocks"]:
            if block["type"] == "entry":
                normalized = block.pop("normalized")
                if normalized in seen:
                    removed_entries += 1
                    skipping_duplicate = True
                    continue
                seen.add(normalized)
                kept_entries += 1
                skipping_duplicate = False
                blocks.append(block)
                continue
            if block["type"] in {"title", "section"}:
                skipping_duplicate = False
                blocks.append(block)
            elif not skipping_duplicate:
                blocks.append(block)
        output.append({"number": page["number"], "blocks": blocks})
    return output, kept_entries, removed_entries


def write_book_content(
    book: dict[str, Any],
    source: Path,
    content_root: Path,
    ocr_cache: Path,
    seen: set[str],
) -> tuple[int, int]:
    units = flatten_units(book)
    destination = content_root / book["id"]
    destination.mkdir(parents=True, exist_ok=True)
    document = None if book["extractionMethod"] == "ocr" else fitz.open(source)
    kept_total = 0
    removed_total = 0
    index_units: list[dict[str, Any]] = []
    try:
        for index, unit in enumerate(units, start=1):
            pages = raw_unit_pages(document, book, unit, ocr_cache)
            pages, kept, removed = deduplicate_pages(pages, seen)
            kept_total += kept
            removed_total += removed
            payload = {
                "schemaVersion": 1,
                "bookId": book["id"],
                "unitId": unit["id"],
                "title": unit["title"],
                "sectionId": unit["sectionId"],
                "sectionTitle": unit["sectionTitle"],
                "pageStart": unit["page"],
                "pageEnd": unit["pageEnd"],
                "extractionMethod": book["extractionMethod"],
                "wordEntryCount": kept,
                "duplicateEntryCount": removed,
                "pages": pages,
            }
            (destination / f"{unit['id']}.json").write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            index_units.append(
                {
                    "id": unit["id"],
                    "wordEntryCount": kept,
                    "duplicateEntryCount": removed,
                }
            )
            if index % 50 == 0 or index == len(units):
                print(f"{book['id']}: generated {index}/{len(units)} units", flush=True)
    finally:
        if document is not None:
            document.close()
    (destination / "index.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "bookId": book["id"],
                "wordEntryCount": kept_total,
                "duplicateEntryCount": removed_total,
                "units": index_units,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return kept_total, removed_total


def main() -> None:
    args = parse_args()
    sources = find_sources(args.source.resolve())
    books = [
        build_book("toefl-sentences", sources["toefl-sentences"], args.covers),
        build_book("gre-random", sources["gre-random"], args.covers),
        build_book("situational-15000", sources["situational-15000"], args.covers),
    ]
    if not args.skip_gre_ocr:
        ensure_gre_ocr(
            sources["gre-random"],
            args.ocr_cache,
            max(1, args.workers),
            max(0.7, args.ocr_scale),
        )

    seen: set[str] = set()
    total_kept = 0
    total_removed = 0
    for book in books:
        if book["extractionMethod"] == "ocr" and args.skip_gre_ocr:
            book["contentReady"] = False
            book["wordEntryCount"] = 0
            book["duplicateEntryCount"] = 0
            continue
        kept, removed = write_book_content(
            book, sources[book["id"]], args.content, args.ocr_cache, seen
        )
        book["contentReady"] = True
        book["wordEntryCount"] = kept
        book["duplicateEntryCount"] = removed
        total_kept += kept
        total_removed += removed

    catalog = {
        "schemaVersion": 2,
        "sourceDirectory": str(args.source),
        "summary": {
            "bookCount": len(books),
            "pageCount": sum(book["pageCount"] for book in books),
            "learningUnitCount": sum(
                len(section["items"]) for book in books for section in book["sections"]
            ),
            "uniqueWordEntryCount": total_kept,
            "duplicateEntryCount": total_removed,
        },
        "books": books,
    }
    args.catalog.parent.mkdir(parents=True, exist_ok=True)
    args.catalog.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Built {catalog['summary']['bookCount']} books, "
        f"{catalog['summary']['learningUnitCount']} units, "
        f"{total_kept} unique entries; removed {total_removed} later duplicates",
        flush=True,
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
