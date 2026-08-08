#!/usr/bin/env python3
"""Build a sharded Cambridge International AS & A Level question library.

The source directory stays outside the repository. The generated catalog is
small enough to ship with the API, while subject indexes and document payloads
are gzip shards intended for OSS.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import mimetypes
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz

fitz.TOOLS.mupdf_display_errors(False)


SCHEMA_VERSION = 1
SOURCE_DEFAULT = Path(r"D:\留学\Alevel-CIE")
OUTPUT_DEFAULT = Path("output/alevel-library")
GENERATED_DEFAULT = Path("apps/api/src/learning/alevel-catalog.generated.ts")
STORAGE_PREFIX = (
    "tenants/019f8d4f-c7ce-77b8-979a-206f28f8fda4/learning/alevel"
)

OFFICIAL_RE = re.compile(
    r"(?<!\d)(?P<code>\d{4})_(?P<session>[msw])(?P<year>\d{2})_"
    r"(?P<role>[a-z]{2})(?:_(?P<component>\d{1,2}))?(?:\D|$)",
    re.I,
)
YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
QUESTION_LINE_RE = re.compile(r"^\s*(?:question\s+)?(\d{1,3})[.)]?\s+(.*)", re.I)
OPTION_LINE_RE = re.compile(r"^\s*[([]?([A-D])[).\]]\s+(.*)", re.I)

ROLE_TYPES = {
    "qp": "question",
    "ms": "mark_scheme",
    "gt": "grade_threshold",
    "er": "examiner_report",
    "in": "insert",
    "ir": "insert",
    "ci": "confidential_instructions",
    "pm": "prerelease_material",
    "sf": "supporting_file",
    "su": "supporting_file",
    "rp": "supporting_file",
    "qr": "reference",
    "sy": "syllabus",
    "tn": "reference",
    "ab": "reference",
    "sm": "reference",
}

REFERENCE_RE = re.compile(
    r"(?:syllabus|learner.guide|coursebook|textbook|revision.guide|theory|"
    r"scheme.of.work|specimen|command.words|formula.book|data.book)",
    re.I,
)
ANSWER_RE = re.compile(
    r"(?:mark.scheme|answers?|solutions?|\bsolv(?:ed)?\b|\bms\b)", re.I
)
QUESTION_RE = re.compile(
    r"(?:question|past.paper|exam|multiple.choice|\bmult\b|\bstru\b|paper[ _-]?\d|\bqp\b)",
    re.I,
)


def normalized(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str) -> str:
    value = normalized(value)
    value = re.sub(r"\s+", "-", value)
    return value[:90].strip("-") or hashlib.sha256(value.encode()).hexdigest()[:16]


def stable_id(value: str, length: int = 24) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sniff_media_type(path: Path) -> str:
    with path.open("rb") as stream:
        header = stream.read(16)
    if header.startswith(b"%PDF-"):
        return "application/pdf"
    if header.startswith(b"PK\x03\x04"):
        return "application/zip"
    guessed = mimetypes.guess_type(path.name)[0]
    return guessed or "application/octet-stream"


def storage_suffix(media_type: str, path: Path) -> str:
    overrides = {
        "application/pdf": ".pdf",
        "application/zip": ".zip",
        "audio/mpeg": ".mp3",
        "video/mp4": ".mp4",
    }
    return overrides.get(media_type, path.suffix.lower() or ".bin")


def category_for(name: str) -> str:
    value = normalized(name)
    if any(word in value for word in (
        "mathematics", "biology", "chemistry", "physics", "science",
        "environmental", "marine science", "physical science",
    )):
        return "数学与科学"
    if any(word in value for word in (
        "accounting", "business", "economics", "computer", "computing",
        "information technology", "applied ict", "travel and tourism",
    )):
        return "商业、经济与技术"
    if any(word in value for word in (
        "art", "design", "music", "drama", "media", "food", "sport",
        "physical education", "project qualification",
    )):
        return "艺术、设计与职业课程"
    if any(word in value for word in (
        "english", "french", "german", "spanish", "portuguese", "chinese",
        "arabic", "afrika", "hindi", "japanese", "marathi", "tamil",
        "telugu", "urdu", "language", "literature",
    )):
        return "语言与文学"
    return "人文与社会科学"


def subject_label(directory: str) -> str:
    label = re.sub(r"\s+-\s+for first examination.*?(?=\s+-\s+\d{4}$)", "", directory, flags=re.I)
    label = re.sub(r"\s*[- ]+\d{4}(?:\s+and\s+\d{4})?\s*$", "", label, flags=re.I)
    return label.replace("-", " ").strip()


def official_parts(path: Path) -> dict[str, Any]:
    match = OFFICIAL_RE.search(path.stem)
    if not match:
        return {}
    short_year = int(match.group("year"))
    year = 2000 + short_year if short_year <= 30 else 1900 + short_year
    component = match.group("component")
    paper = int(component[0]) if component else None
    variant = int(component[1]) if component and len(component) == 2 else None
    return {
        "syllabusCode": match.group("code"),
        "year": year,
        "session": {"m": "feb-mar", "s": "may-june", "w": "oct-nov"}[
            match.group("session").lower()
        ],
        "role": match.group("role").lower(),
        "component": component,
        "paper": paper,
        "variant": variant,
    }


def infer_level(path: Path, paper: int | None) -> tuple[str | None, str | None]:
    value = normalized(path.stem)
    if re.search(r"(?:^| )a2(?: |$)", value):
        return "A2", "explicit"
    if re.search(r"(?:^| )as(?: |$)", value):
        return "AS", "explicit"
    if paper is not None:
        return ("AS" if paper <= 2 else "A2"), "inferred"
    return None, None


def classify(path: Path, media_type: str, official: dict[str, Any]) -> tuple[str, str]:
    role = official.get("role")
    if role in ROLE_TYPES:
        doc_type = ROLE_TYPES[role]
        return doc_type, "past-paper" if doc_type == "question" else "support"
    if media_type != "application/pdf":
        return "supporting_file", "support"
    name = normalized(path.stem)
    if ANSWER_RE.search(name):
        return "topic_answer", "topic"
    if REFERENCE_RE.search(name) and not QUESTION_RE.search(name):
        return "reference", "support"
    if QUESTION_RE.search(name) or YEAR_RE.search(path.stem):
        return "topic_question", "topic"
    return "reference", "support"


def topic_key(path: Path) -> str:
    value = normalized(path.stem)
    value = re.sub(r"\b(?:answers?|solutions?|solved|mark scheme|ms|qp)\b", " ", value)
    value = re.sub(r"\b(?:19|20)\d{2}\b", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def display_title(item: dict[str, Any]) -> str:
    if item["collectionType"] == "past-paper" and item.get("year"):
        session = {
            "feb-mar": "Feb/Mar",
            "may-june": "May/June",
            "oct-nov": "Oct/Nov",
        }.get(item.get("session"), "")
        paper = f"Paper {item['paper']}" if item.get("paper") else "Question Paper"
        variant = f" Variant {item['variant']}" if item.get("variant") is not None else ""
        return f"{item['year']} {session} {paper}{variant}".strip()
    title = re.sub(r"[_+]+", " ", Path(item["relativePath"]).stem)
    return re.sub(r"\s+", " ", title).strip(" -")


def infer_syllabus_code(path: Path, official: dict[str, Any]) -> str | None:
    if official.get("syllabusCode"):
        return str(official["syllabusCode"])

    def non_year_codes(value: str) -> list[str]:
        return [
            match
            for match in re.findall(r"(?<!\d)(\d{4})(?!\d)", value)
            if not 1900 <= int(match) <= 2099
        ]

    stem_codes = non_year_codes(path.stem)
    if stem_codes:
        return stem_codes[0]
    directory_codes = non_year_codes(path.parts[0]) if path.parts else []
    return directory_codes[0] if directory_codes else None


def scan_file(root: Path, path: Path) -> dict[str, Any] | None:
    relative_path = path.relative_to(root)
    relative = relative_path.as_posix()
    if relative == "_papacambridge_manifest.json":
        return None
    media_type = sniff_media_type(path)
    official = official_parts(path)
    document_type, collection_type = classify(path, media_type, official)
    parent = relative_path.parts[0]
    syllabus_code = infer_syllabus_code(relative_path, official)
    year = official.get("year")
    if year is None:
        years = [int(value) for value in YEAR_RE.findall(path.stem)]
        year = years[-1] if years else None
    level, level_confidence = infer_level(path, official.get("paper"))
    digest = file_hash(path)
    item: dict[str, Any] = {
        "id": stable_id(f"{parent.lower()}::{relative.lower()}"),
        "subjectId": slugify(parent),
        "syllabusCode": syllabus_code,
        "relativePath": relative,
        "title": "",
        "year": year,
        "session": official.get("session"),
        "level": level,
        "levelConfidence": level_confidence,
        "paper": official.get("paper"),
        "variant": official.get("variant"),
        "component": official.get("component"),
        "documentType": document_type,
        "collectionType": collection_type,
        "sizeBytes": path.stat().st_size,
        "sha256": digest,
        "mediaType": media_type,
        "relatedResourceIds": [],
        "duplicatePaths": [],
        "topicKey": topic_key(path) if collection_type == "topic" else None,
    }
    item["title"] = display_title(item)
    return item


def deduplicate(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    duplicates = 0
    for item in items:
        key = (item["subjectId"], item["sha256"], item["documentType"])
        existing = unique.get(key)
        if existing:
            existing["duplicatePaths"].append(item["relativePath"])
            duplicates += 1
            continue
        unique[key] = item
    return list(unique.values()), duplicates


def pair_resources(items: list[dict[str, Any]]) -> None:
    by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        by_subject[item["subjectId"]].append(item)
    for question in items:
        if question["documentType"] not in {"question", "topic_question"}:
            continue
        related: list[dict[str, Any]] = []
        for candidate in by_subject[question["subjectId"]]:
            if candidate["id"] == question["id"] or candidate["documentType"] in {
                "question", "topic_question"
            }:
                continue
            if question["collectionType"] == "past-paper":
                if not (
                    candidate.get("syllabusCode") == question.get("syllabusCode")
                    and candidate.get("year") == question.get("year")
                    and candidate.get("session") == question.get("session")
                ):
                    continue
                if candidate.get("component") and question.get("component"):
                    if candidate["component"] != question["component"]:
                        continue
                related.append(candidate)
            elif (
                candidate["collectionType"] == "topic"
                and candidate.get("topicKey")
                and candidate.get("topicKey") == question.get("topicKey")
            ):
                related.append(candidate)
        priority = {
            "mark_scheme": 0,
            "topic_answer": 0,
            "insert": 1,
            "confidential_instructions": 2,
            "prerelease_material": 3,
            "supporting_file": 4,
            "grade_threshold": 5,
            "examiner_report": 6,
        }
        related.sort(key=lambda value: (priority.get(value["documentType"], 20), value["title"]))
        question["relatedResourceIds"] = [item["id"] for item in related]


def extract_native(path: Path) -> dict[str, Any]:
    document: fitz.Document | None = None
    try:
        document = fitz.open(path)
        pages = []
        question_numbers: set[int] = set()
        extracted_chars = 0
        for page_number, page in enumerate(document, 1):
            blocks = []
            lines: list[str] = []
            for raw in page.get_text("blocks"):
                text = re.sub(r"\s+", " ", raw[4]).strip()
                if not text:
                    continue
                extracted_chars += len(text)
                blocks.append({
                    "type": "text",
                    "text": text,
                    "bbox": [round(float(value), 2) for value in raw[:4]],
                })
                lines.extend(part.strip() for part in raw[4].splitlines() if part.strip())
            questions = []
            current: dict[str, Any] | None = None
            for line in lines:
                qmatch = QUESTION_LINE_RE.match(line)
                if qmatch:
                    number = int(qmatch.group(1))
                    if 0 < number < 200:
                        if current:
                            questions.append(current)
                        current = {"number": number, "prompt": qmatch.group(2), "options": []}
                        question_numbers.add(number)
                        continue
                option = OPTION_LINE_RE.match(line)
                if option and current:
                    current["options"].append({"label": option.group(1), "text": option.group(2)})
                elif current:
                    current["prompt"] = f"{current['prompt']} {line}".strip()
            if current:
                questions.append(current)
            pages.append({
                "number": page_number,
                "width": round(float(page.rect.width), 2),
                "height": round(float(page.rect.height), 2),
                "blocks": blocks,
                "questions": questions,
            })
        status = "native" if extracted_chars >= 80 else "scan"
        return {
            "textStatus": status,
            "pageCount": len(document),
            "questionCount": len(question_numbers),
            "pages": pages if status == "native" else [],
        }
    except Exception as error:
        return {
            "textStatus": "error",
            "pageCount": None,
            "questionCount": 0,
            "pages": [],
            "error": str(error)[:500],
        }
    finally:
        if document is not None:
            document.close()


def write_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=6) as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
    temporary.replace(path)


def public_summary(item: dict[str, Any]) -> dict[str, Any]:
    ignored = {"topicKey", "component", "sourcePath", "_mtimeNs"}
    return {key: value for key, value in item.items() if key not in ignored}


def write_generated(catalog: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(catalog, ensure_ascii=False, indent=2)
    destination.write_text(
        "// Generated by scripts/build-alevel-library.py. Do not edit manually.\n"
        "import type { AlevelCatalog } from './alevel-types.js';\n\n"
        f"export const alevelCatalog = {payload} as const satisfies AlevelCatalog;\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE_DEFAULT)
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--generated", type=Path, default=GENERATED_DEFAULT)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--extract-limit", type=int, default=0)
    parser.add_argument("--extract-offset", type=int, default=0)
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        raise SystemExit(f"A Level source directory not found: {source}")
    paths = sorted(path for path in source.rglob("*") if path.is_file())
    scan_cache_path = output / "scan-cache.json"
    scan_cache: dict[str, dict[str, Any]] = {}
    scan_cache_dirty = False
    try:
        scan_cache = json.loads(scan_cache_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    def cached_scan(path: Path) -> dict[str, Any] | None:
        nonlocal scan_cache_dirty
        relative = path.relative_to(source).as_posix()
        info = path.stat()
        cached = scan_cache.get(relative)
        if (
            cached
            and cached.get("sizeBytes") == info.st_size
            and cached.get("_mtimeNs") == info.st_mtime_ns
        ):
            return cached
        item = scan_file(source, path)
        if item is not None:
            item["_mtimeNs"] = info.st_mtime_ns
        scan_cache_dirty = True
        return item

    print(json.dumps({"phase": "scan", "sourceFiles": len(paths)}, ensure_ascii=False))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        scanned = list(executor.map(cached_scan, paths))
    raw_items = [item for item in scanned if item is not None]
    for item in raw_items:
        relative_path = Path(item["relativePath"])
        syllabus_code = infer_syllabus_code(relative_path, official_parts(relative_path))
        if item.get("syllabusCode") != syllabus_code:
            item["syllabusCode"] = syllabus_code
            scan_cache_dirty = True
    output.mkdir(parents=True, exist_ok=True)
    if scan_cache_dirty:
        scan_cache_path.write_text(
            json.dumps({item["relativePath"]: item for item in raw_items}, ensure_ascii=False),
            encoding="utf-8",
        )
    items, duplicate_count = deduplicate(raw_items)
    pair_resources(items)
    fingerprint = hashlib.sha256(
        "\n".join(
            f"{item['relativePath']}:{item['sha256']}:{item['documentType']}:{item.get('syllabusCode') or ''}"
            for item in sorted(items, key=lambda value: value["relativePath"])
        ).encode("utf-8")
    ).hexdigest()[:12]
    release_version = f"{datetime.now(timezone.utc):%Y%m%d}-{fingerprint}"
    release_prefix = f"{STORAGE_PREFIX}/releases/{release_version}"
    by_id = {item["id"]: item for item in items}
    for item in items:
        suffix = storage_suffix(item["mediaType"], source / Path(item["relativePath"]))
        item["originalStorageKey"] = f"{STORAGE_PREFIX}/originals/{item['sha256']}{suffix}"
        item["metadataStorageKey"] = f"{release_prefix}/documents/{item['id']}.json.gz"
    extractable = {
        "question", "mark_scheme", "topic_question", "topic_answer",
        "grade_threshold", "examiner_report", "insert", "reference",
    }

    def build_payload(item: dict[str, Any]) -> dict[str, Any]:
        source_path = source / Path(item["relativePath"])
        payload_path = output / "documents" / f"{item['id']}.json.gz"
        cached_native: dict[str, Any] | None = None
        cached_document: dict[str, Any] | None = None
        if payload_path.exists() and not args.metadata_only:
            try:
                with gzip.open(payload_path, "rt", encoding="utf-8") as stream:
                    cached_payload = json.load(stream)
                if cached_payload.get("document", {}).get("sha256") == item["sha256"]:
                    cached_native = cached_payload.get("content")
                    cached_document = cached_payload.get("document")
            except (OSError, json.JSONDecodeError):
                pass
        if cached_native is not None:
            native = {
                "textStatus": cached_native.get("textStatus", "error"),
                "pageCount": cached_document.get("pageCount") if cached_document else len(cached_native.get("pages", [])),
                "questionCount": cached_document.get("questionCount") if cached_document else sum(
                    len(page.get("questions", [])) for page in cached_native.get("pages", [])
                ),
                "pages": cached_native.get("pages", []),
            }
            if (
                cached_document
                and cached_document.get("documentType") == item["documentType"]
                and cached_document.get("relatedResourceIds") == item["relatedResourceIds"]
                and cached_document.get("syllabusCode") == item.get("syllabusCode")
            ):
                item.update({
                    "textStatus": native["textStatus"],
                    "pageCount": native.get("pageCount"),
                    "questionCount": native.get("questionCount", 0),
                })
                return item
        elif (
            not args.metadata_only
            and item["mediaType"] == "application/pdf"
            and item["documentType"] in extractable
        ):
            native = extract_native(source_path)
        else:
            native = {"textStatus": "scan", "pageCount": None, "questionCount": 0, "pages": []}
        item.update({
            "textStatus": native["textStatus"],
            "pageCount": native.get("pageCount"),
            "questionCount": native.get("questionCount", 0),
        })
        related = [public_summary(by_id[value]) for value in item["relatedResourceIds"]]
        payload = {
            "schemaVersion": SCHEMA_VERSION,
            "document": public_summary(item),
            "content": {
                "documentId": item["id"],
                "title": item["title"],
                "textStatus": native["textStatus"],
                "pages": native.get("pages", []),
            },
            "relatedDocuments": related,
        }
        if not args.metadata_only:
            write_gzip_json(payload_path, payload)
        return item

    print(json.dumps({"phase": "extract", "uniqueFiles": len(items)}, ensure_ascii=False))
    if args.extract_limit:
        pending = [
            item for item in items
            if not (output / "documents" / f"{item['id']}.json.gz").exists()
        ]
        selected = pending[args.extract_offset : args.extract_offset + args.extract_limit]
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            for index, _item in enumerate(executor.map(build_payload, selected), 1):
                if index % 250 == 0 or index == len(selected):
                    print(json.dumps({
                        "phase": "extract-batch",
                        "completed": index,
                        "batch": len(selected),
                        "remaining": len(pending) - index,
                    }))
        print(json.dumps({
            "status": "partial",
            "processed": len(selected),
            "remaining": len(pending) - len(selected),
            "offset": args.extract_offset,
        }))
        return
    built_items: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        for index, item in enumerate(executor.map(build_payload, items), 1):
            built_items.append(item)
            if index % 500 == 0 or index == len(items):
                print(json.dumps({"phase": "extract", "completed": index, "total": len(items)}))
    items = built_items
    subjects = []
    for directory in sorted(path for path in source.iterdir() if path.is_dir()):
        subject_id = slugify(directory.name)
        subject_items = [item for item in items if item["subjectId"] == subject_id]
        if not subject_items:
            continue
        codes = sorted({item["syllabusCode"] for item in subject_items if item.get("syllabusCode")})
        years = sorted({item["year"] for item in subject_items if item.get("year")})
        counts = Counter(item["documentType"] for item in subject_items)
        subject = {
            "id": subject_id,
            "label": subject_label(directory.name),
            "category": category_for(directory.name),
            "syllabusCodes": codes,
            "years": years,
            "questionDocumentCount": counts["question"],
            "topicDocumentCount": counts["topic_question"],
            "markSchemeCount": counts["mark_scheme"] + counts["topic_answer"],
            "resourceCount": len(subject_items) - counts["question"] - counts["topic_question"],
            "indexStorageKey": f"{release_prefix}/subjects/{subject_id}.json.gz",
        }
        subjects.append(subject)
        subject_payload = {
            "schemaVersion": SCHEMA_VERSION,
            "subject": subject,
            "documents": [public_summary(item) for item in subject_items],
        }
        if not args.metadata_only:
            write_gzip_json(output / "subjects" / f"{subject_id}.json.gz", subject_payload)
    counts = Counter(item["documentType"] for item in items)
    catalog = {
        "schemaVersion": SCHEMA_VERSION,
        "releaseVersion": release_version,
        "storagePrefix": release_prefix,
        "source": str(source),
        "subjects": subjects,
        "summary": {
            "sourceFileCount": len(paths),
            "indexedFileCount": len(raw_items),
            "uniqueResourceCount": len(items),
            "duplicateResourceCount": duplicate_count,
            "questionDocumentCount": counts["question"],
            "topicDocumentCount": counts["topic_question"],
            "markSchemeCount": counts["mark_scheme"] + counts["topic_answer"],
            "totalBytes": sum(item["sizeBytes"] for item in items),
        },
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = {
        "releaseVersion": release_version,
        "documentTypes": counts,
        "textStatuses": Counter(item.get("textStatus") for item in items),
        "unpairedQuestionCount": sum(
            1 for item in items
            if item["documentType"] in {"question", "topic_question"}
            and not item["relatedResourceIds"]
        ),
        "subjects": len(subjects),
        "years": sorted({item["year"] for item in items if item.get("year")}),
    }
    (output / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=dict), encoding="utf-8"
    )
    upload_entries = []
    originals: dict[str, dict[str, Any]] = {}
    for item in items:
        originals.setdefault(
            item["originalStorageKey"],
            {
                "kind": "original",
                "key": item["originalStorageKey"],
                "relativePath": item["relativePath"],
                "sizeBytes": item["sizeBytes"],
                "sha256": item["sha256"],
                "mediaType": item["mediaType"],
            },
        )
    upload_entries.extend(originals.values())
    if not args.metadata_only:
        for item in items:
            upload_entries.append({
                "kind": "generated",
                "key": item["metadataStorageKey"],
                "relativePath": f"documents/{item['id']}.json.gz",
                "mediaType": "application/gzip",
            })
        for subject in subjects:
            upload_entries.append({
                "kind": "generated",
                "key": subject["indexStorageKey"],
                "relativePath": f"subjects/{subject['id']}.json.gz",
                "mediaType": "application/gzip",
            })
    (output / "upload-manifest.json").write_text(
        json.dumps({"releaseVersion": release_version, "entries": upload_entries}, ensure_ascii=False),
        encoding="utf-8",
    )
    write_generated(catalog, args.generated)
    print(json.dumps({"status": "complete", **catalog["summary"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
