#!/usr/bin/env python3
"""Build the AP library catalog and native, selectable document payloads.

The source directory is intentionally kept outside the repository.  This script
deduplicates source files by SHA-256, extracts PDF text and embedded figures,
matches question documents with scoring/answer documents, and writes small
gzip JSON shards that can be uploaded to object storage.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import gzip
import hashlib
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import fitz

_ocr_local = threading.local()


def replace_with_retry(source: Path, destination: Path) -> None:
    last_error: Exception | None = None
    for attempt in range(8):
        try:
            source.replace(destination)
            return
        except PermissionError as error:
            last_error = error
            time.sleep(0.15 * (attempt + 1))
    if last_error:
        raise last_error


SCHEMA_VERSION = 1
SOURCE_DEFAULT = Path(r"D:\留学\AP")
OUTPUT_DEFAULT = Path("output/ap-library")
STORAGE_PREFIX = "tenants/019f8d4f-c7ce-77b8-979a-206f28f8fda4/toefl/listening/ap"


SUBJECTS = {
    "01-AP World History世界历史 【真题至2025】": ("world-history", "AP 世界历史", "历史与社会科学"),
    "2026环境科学": ("environmental-science", "AP 环境科学", "科学"),
    "AP环境科学": ("environmental-science", "AP 环境科学", "科学"),
    "2026物理C电磁学保5分+anxinliuxue333": ("physics-c-electricity-magnetism", "AP 物理 C：电磁学", "科学"),
    "AP 人文地理-【真题】_0116093456": ("human-geography", "AP 人文地理", "历史与社会科学"),
    "AP 生物【真题】至2025": ("biology", "AP 生物", "科学"),
    "ap生物真题至2025": ("biology", "AP 生物", "科学"),
    "AP法语": ("french-language", "AP 法语语言与文化", "语言与文化"),
    "AP宏观经济学 【真题】至2025": ("macroeconomics", "AP 宏观经济学", "历史与社会科学"),
    "AP化学【真题】至2025": ("chemistry", "AP 化学", "科学"),
    "AP计算机（CSP）【历年真题】": ("computer-science-principles", "AP 计算机科学原理", "数学与计算机"),
    "AP计算机原理": ("computer-science-principles", "AP 计算机科学原理", "数学与计算机"),
    "AP计算机科学A": ("computer-science-a", "AP 计算机科学 A", "数学与计算机"),
    "AP美国历史 真题至2025": ("us-history", "AP 美国历史", "历史与社会科学"),
    "AP欧洲历史": ("european-history", "AP 欧洲历史", "历史与社会科学"),
    "ap日本语言与文化": ("japanese-language", "AP 日语语言与文化", "语言与文化"),
    "AP统计【真题至2025】": ("statistics", "AP 统计学", "数学与计算机"),
    "AP微观经济学 【真题】至2025": ("microeconomics", "AP 微观经济学", "历史与社会科学"),
    "AP微积分AB【真题】至2025": ("calculus-ab", "AP 微积分 AB", "数学与计算机"),
    "AP微积分BC【真题】至2025": ("calculus-bc", "AP 微积分 BC", "数学与计算机"),
    "AP物理1 【真题-往年至25】": ("physics-1", "AP 物理 1", "科学"),
    "AP物理2": ("physics-2", "AP 物理 2", "科学"),
    "AP物理C 力【真题】至2025": ("physics-c-mechanics", "AP 物理 C：力学", "科学"),
    "AP心理学【真题】至2025": ("psychology", "AP 心理学", "历史与社会科学"),
    "AP艺术史": ("art-history", "AP 艺术史", "艺术"),
    "AP预备微积分 【真题】往年至2025年": ("precalculus", "AP 预备微积分", "数学与计算机"),
    "AP计算机科学A-99-25年真题": ("computer-science-a", "AP 计算机科学 A", "数学与计算机"),
    "ap中文": ("chinese-language", "AP 中文语言与文化", "语言与文化"),
    "西班牙": ("spanish-language", "AP 西班牙语语言与文化", "语言与文化"),
    "语言与写作历年真题": ("english-language", "AP 英语语言与写作", "语言与文化"),
}

ANSWER_RE = re.compile(
    r"(?:answer|answers|answer.key|scoring.guideline|scoring.comment|sample.response|"
    r"student.response|student.performance|chief.reader|q\s*&\s*a|[_-]qa(?:[_-]|\.)|"
    r"\bsgs?\b|\bscoring\b|mark.scheme|rubric|solutions?|"
    r"评分|答案|解析|答题|范文)",
    re.I,
)
REFERENCE_RE = re.compile(
    r"(?:scoring.statistics|score.distribution|course.description|course.overview|"
    r"syllabus|ced(?:[_-]|\.)|textbook|review.book|教材|讲义|课件|考纲|大纲|词汇|"
    r"知识点|公式|闪卡|复习资料|备考指南)",
    re.I,
)
QUESTION_RE = re.compile(
    r"(?:free.response|\bfrq\b|practice.exam|released.exam|multiple.choice|\bmcq\b|"
    r"question|\bq[1-9]\b|真题|试题|模拟题|练习题|选择题|简答题)",
    re.I,
)
COMBINED_RE = re.compile(r"(?:exam.and.answers|questions?.and.answers?|试题.{0,6}答案|真题.{0,6}解析)", re.I)
YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
SHORT_YEAR_RE = re.compile(r"(?:^|\D)(0[0-9]|1[0-9]|2[0-6])(?:\D|$)")
QUESTION_NUMBER_RE = re.compile(r"(?:^|[_\-\s])q(?:uestion)?[_\-\s]*([1-9])(?:\D|$)", re.I)
QUESTION_START_RE = re.compile(r"^\s*(?:question\s+)?(\d{1,3})[.)]\s+(.*)", re.I)
OPTION_RE = re.compile(r"^\s*[([]?([A-D])[).\]]\s+(.*)", re.I)


def normalized(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def stable_id(value: str, length: int = 20) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def extract_year(parts: Iterable[str]) -> int | None:
    joined = " ".join(parts)
    matches = YEAR_RE.findall(joined)
    if matches:
        years = [int(value) for value in matches if 1950 <= int(value) <= 2029]
        if years:
            return years[-1]
    short = SHORT_YEAR_RE.search(joined)
    if short:
        value = int(short.group(1))
        return 2000 + value
    return None


def classify(path: Path) -> str:
    value = normalized(" ".join(path.parts[-4:]))
    if COMBINED_RE.search(value):
        return "combined"
    if REFERENCE_RE.search(value):
        return "reference"
    if ANSWER_RE.search(value):
        return "answer"
    if QUESTION_RE.search(value):
        return "question"
    # Most files grouped under a year in the AP archive are exam materials.
    return "question" if extract_year(path.parts[-4:]) else "reference"


def clean_title(path: Path) -> str:
    title = path.stem.replace("_", " ").replace("+", " ")
    title = re.sub(r"\s+", " ", title).strip(" -")
    return title or path.name


def pairing_key(item: dict[str, Any]) -> tuple[str, int | None, int | None]:
    qmatch = QUESTION_NUMBER_RE.search(item["relativePath"])
    qnumber = int(qmatch.group(1)) if qmatch else None
    return item["subjectId"], item.get("year"), qnumber


def pairing_score(question: dict[str, Any], answer: dict[str, Any]) -> int:
    if question["subjectId"] != answer["subjectId"]:
        return -10_000
    score = 0
    if question.get("year") and question.get("year") == answer.get("year"):
        score += 80
    q_parent = Path(question["relativePath"]).parent.parts
    a_parent = Path(answer["relativePath"]).parent.parts
    common = 0
    for left, right in zip(q_parent, a_parent):
        if normalized(left) != normalized(right):
            break
        common += 1
    score += common * 8
    qnum = QUESTION_NUMBER_RE.search(question["relativePath"])
    anum = QUESTION_NUMBER_RE.search(answer["relativePath"])
    if qnum and anum and qnum.group(1) == anum.group(1):
        score += 35
    qwords = set(normalized(question["title"]).split()) - {"ap", "frq", "question", "questions"}
    awords = set(normalized(answer["title"]).split()) - {
        "ap", "answer", "answers", "scoring", "guidelines", "sample", "response", "qa"
    }
    score += min(30, len(qwords & awords) * 3)
    return score


def pair_answers(documents: list[dict[str, Any]]) -> None:
    answers_by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in documents:
        if item["documentType"] in {"answer", "combined"}:
            answers_by_subject[item["subjectId"]].append(item)
    for question in documents:
        if question["documentType"] not in {"question", "combined"}:
            continue
        ranked = sorted(
            (
                (pairing_score(question, answer), answer)
                for answer in answers_by_subject[question["subjectId"]]
                if answer["id"] != question["id"]
            ),
            key=lambda entry: (-entry[0], entry[1]["title"]),
        )
        question["answerDocumentIds"] = [answer["id"] for score, answer in ranked[:5] if score >= 72]
        if question["documentType"] == "combined":
            question["hasEmbeddedAnswers"] = True


def extract_questions(lines: list[str]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in lines:
        start = QUESTION_START_RE.match(line)
        if start:
            if current:
                questions.append(current)
            current = {"number": int(start.group(1)), "prompt": start.group(2).strip(), "options": []}
            continue
        if not current:
            continue
        option = OPTION_RE.match(line)
        if option:
            current["options"].append({"label": option.group(1).upper(), "text": option.group(2).strip()})
        elif current["options"]:
            current["options"][-1]["text"] += " " + line.strip()
        else:
            current["prompt"] += " " + line.strip()
    if current:
        questions.append(current)
    return [item for item in questions if len(item["prompt"]) >= 8]


def ocr_sparse_pages(payload: dict[str, Any], source_path: Path) -> bool:
    if payload.get("documentType") == "reference" or payload.get("textStatus") != "scan":
        return False
    sparse = [
        index for index, page in enumerate(payload.get("pages", []))
        if sum(len(block.get("text", "")) for block in page.get("blocks", [])) < 30
    ]
    if not sparse:
        return False
    from rapidocr_onnxruntime import RapidOCR
    if not hasattr(_ocr_local, "engine"):
        _ocr_local.engine = RapidOCR()
    document = fitz.open(source_path)
    changed = False
    try:
        for index in sparse:
            page = document[index]
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            result, _ = _ocr_local.engine(pixmap.tobytes("png"))
            if not result:
                continue
            blocks = []
            lines = []
            for box, text, score in result:
                text = str(text).strip()
                if not text or float(score) < 0.45:
                    continue
                xs = [point[0] / 2 for point in box]
                ys = [point[1] / 2 for point in box]
                blocks.append({
                    "type": "text",
                    "text": text,
                    "bbox": [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)],
                })
                lines.append(text)
            if blocks:
                payload["pages"][index]["blocks"] = blocks
                payload["pages"][index]["questions"] = extract_questions(lines)
                changed = True
    finally:
        document.close()
    if changed:
        payload["textStatus"] = "ocr"
    return changed


def extract_pdf(
    item: dict[str, Any], source_root: Path, output_root: Path, ocr_scans: bool
) -> dict[str, Any]:
    source_path = source_root / item["relativePath"]
    native_path = output_root / "native" / f"{item['sha256']}.json.gz"
    if native_path.exists():
        try:
            with gzip.open(native_path, "rt", encoding="utf-8") as stream:
                cached = json.load(stream)
        except (OSError, EOFError, json.JSONDecodeError):
            cached = None
        if cached is not None:
            if ocr_scans and ocr_sparse_pages(cached, source_path):
                temporary_path = native_path.with_suffix(f".{os.getpid()}.tmp")
                with gzip.open(temporary_path, "wt", encoding="utf-8", compresslevel=6) as stream:
                    json.dump(cached, stream, ensure_ascii=False, separators=(",", ":"))
                replace_with_retry(temporary_path, native_path)
            return {
                "id": item["id"],
                "pageCount": len(cached.get("pages", [])),
                "questionCount": sum(len(page.get("questions", [])) for page in cached.get("pages", [])),
                "nativeStorageKey": f"{STORAGE_PREFIX}/native/{item['sha256']}.json.gz",
                "textStatus": cached.get("textStatus", "native"),
            }

    pages: list[dict[str, Any]] = []
    total_chars = 0
    try:
        document = fitz.open(source_path)
        for index, page in enumerate(document):
            blocks = []
            lines: list[str] = []
            page_dict = page.get_text("dict", sort=True)
            for block in page_dict.get("blocks", []):
                if block.get("type") != 0:
                    continue
                block_lines = []
                for source_line in block.get("lines", []):
                    text = "".join(span.get("text", "") for span in source_line.get("spans", [])).strip()
                    if text:
                        block_lines.append(text)
                        lines.append(text)
                text = "\n".join(block_lines).strip()
                if text:
                    bbox = [round(float(value), 2) for value in block.get("bbox", (0, 0, 0, 0))]
                    blocks.append({"type": "text", "text": text, "bbox": bbox})
                    total_chars += len(text)
            pages.append(
                {
                    "number": index + 1,
                    "width": round(page.rect.width, 2),
                    "height": round(page.rect.height, 2),
                    "blocks": blocks,
                    "questions": extract_questions(lines),
                }
            )
        document.close()
        text_status = "native" if total_chars >= max(40, len(pages) * 20) else "scan"
        payload = {
            "schemaVersion": SCHEMA_VERSION,
            "documentId": item["id"],
            "title": item["title"],
            "documentType": item["documentType"],
            "textStatus": text_status,
            "pages": pages,
        }
        if ocr_scans:
            ocr_sparse_pages(payload, source_path)
        native_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = native_path.with_suffix(f".{os.getpid()}.tmp")
        with gzip.open(temporary_path, "wt", encoding="utf-8", compresslevel=6) as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
        replace_with_retry(temporary_path, native_path)
        return {
            "id": item["id"],
            "pageCount": len(pages),
            "questionCount": sum(len(page["questions"]) for page in pages),
            "nativeStorageKey": f"{STORAGE_PREFIX}/native/{item['sha256']}.json.gz",
            "textStatus": payload["textStatus"],
        }
    except Exception as error:  # keep a complete catalog even when one malformed PDF fails
        return {"id": item["id"], "pageCount": 0, "questionCount": 0, "textStatus": "error", "error": str(error)}


def extract_pdf_job(job: tuple[dict[str, Any], str, str, bool]) -> dict[str, Any]:
    item, source_root, output_root, ocr_scans = job
    try:
        return extract_pdf(item, Path(source_root), Path(output_root), ocr_scans)
    except Exception as error:
        return {"id": item["id"], "ocrError": str(error)}


def write_typescript_catalog(catalog: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
    compressed = base64.b64encode(gzip.compress(encoded.encode("utf-8"), compresslevel=9)).decode("ascii")
    destination.write_text(
        "// Generated by scripts/build-ap-library.py. Do not edit manually.\n"
        "import { gunzipSync } from 'node:zlib';\n"
        "import type { ApCatalog } from './ap-types.js';\n"
        f"const encodedCatalog = '{compressed}';\n"
        "export const apCatalog: ApCatalog = JSON.parse(\n"
        "  gunzipSync(Buffer.from(encodedCatalog, 'base64')).toString('utf8'),\n"
        ") as ApCatalog;\n",
        encoding="utf-8",
    )


def run_ocr_only(source_root: Path, output_root: Path, workers: int) -> dict[str, Any]:
    catalog_path = output_root / "catalog.json"
    if not catalog_path.exists():
        raise SystemExit("Build the AP catalog before running --ocr-only.")
    catalog = json.loads(catalog_path.read_text("utf-8"))
    scan_documents = sorted(
        (
            item for item in catalog["documents"]
            if item.get("textStatus") == "scan" and item.get("documentType") != "reference"
        ),
        key=lambda item: (item.get("pageCount", 0), item["id"]),
    )
    jobs = [(item, str(source_root), str(output_root), True) for item in scan_documents]
    completed = 0
    results: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ProcessPoolExecutor(max_workers=max(1, min(workers, 8))) as executor:
        futures = {executor.submit(extract_pdf_job, job): job[0] for job in jobs}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results[result["id"]] = result
            completed += 1
            if completed % 5 == 0 or completed == len(jobs):
                print(json.dumps({"ocrCompleted": completed, "ocrTotal": len(jobs)}, ensure_ascii=False), flush=True)
    for item in catalog["documents"]:
        result = results.get(item["id"])
        if result and not result.get("ocrError"):
            item.update(result)
        item["originalStorageKey"] = f"{STORAGE_PREFIX}/original/{item['sha256']}{Path(item['relativePath']).suffix.lower()}"
        if item.get("nativeStorageKey"):
            item["nativeStorageKey"] = f"{STORAGE_PREFIX}/native/{item['sha256']}.json.gz"
    for item in catalog["media"]:
        item["originalStorageKey"] = f"{STORAGE_PREFIX}/original/{item['sha256']}{Path(item['relativePath']).suffix.lower()}"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    write_typescript_catalog(catalog, Path("apps/api/src/learning/ap-catalog.generated.ts"))
    return catalog


def build(source_root: Path, output_root: Path, workers: int, extract: bool, ocr_scans: bool) -> dict[str, Any]:
    if not source_root.is_dir():
        raise SystemExit(f"AP source directory not found: {source_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    all_files = sorted(path for path in source_root.rglob("*") if path.is_file())
    hash_cache_path = output_root / "hash-cache.json"
    hash_cache = json.loads(hash_cache_path.read_text("utf-8")) if hash_cache_path.exists() else {}

    def hash_one(path: Path) -> tuple[str, str]:
        relative = path.relative_to(source_root).as_posix()
        stat = path.stat()
        cache_key = f"{relative}|{stat.st_size}|{stat.st_mtime_ns}"
        return relative, hash_cache.get(cache_key) or file_hash(path)

    hashes: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for relative, digest in executor.map(hash_one, all_files):
            hashes[relative] = digest
    new_cache = {}
    for path in all_files:
        relative = path.relative_to(source_root).as_posix()
        stat = path.stat()
        new_cache[f"{relative}|{stat.st_size}|{stat.st_mtime_ns}"] = hashes[relative]
    hash_cache_path.write_text(json.dumps(new_cache, ensure_ascii=False), encoding="utf-8")

    documents: list[dict[str, Any]] = []
    media: list[dict[str, Any]] = []
    unknown_subjects: Counter[str] = Counter()
    for path in all_files:
        relative = path.relative_to(source_root)
        top = relative.parts[0]
        subject = SUBJECTS.get(top)
        if not subject:
            unknown_subjects[top] += 1
            continue
        subject_id, subject_label, category = subject
        digest = hashes[relative.as_posix()]
        suffix = path.suffix.lower()
        base = {
            "id": stable_id(relative.as_posix()),
            "subjectId": subject_id,
            "relativePath": relative.as_posix(),
            "title": clean_title(path),
            "year": extract_year(relative.parts),
            "sizeBytes": path.stat().st_size,
            "sha256": digest,
            "mediaType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "originalStorageKey": f"{STORAGE_PREFIX}/original/{digest}{suffix}",
        }
        if suffix == ".pdf":
            documents.append({**base, "documentType": classify(relative), "answerDocumentIds": []})
        else:
            media.append(base)

    # Avoid presenting exact duplicate PDFs twice while retaining all source paths.
    canonical_by_hash: dict[str, dict[str, Any]] = {}
    deduped_documents: list[dict[str, Any]] = []
    for document in documents:
        canonical = canonical_by_hash.get(document["sha256"])
        if canonical:
            canonical.setdefault("duplicatePaths", []).append(document["relativePath"])
            continue
        canonical_by_hash[document["sha256"]] = document
        deduped_documents.append(document)
    documents = deduped_documents
    pair_answers(documents)

    if extract:
        unique_documents = {item["sha256"]: item for item in documents}.values()
        jobs = [
            (item, str(source_root), str(output_root), ocr_scans)
            for item in unique_documents
        ]
        with concurrent.futures.ProcessPoolExecutor(max_workers=max(1, min(workers, 8))) as executor:
            results = list(executor.map(extract_pdf_job, jobs, chunksize=1))
        result_by_id = {result["id"]: result for result in results}
        for document in documents:
            document.update(result_by_id.get(document["id"], {}))

    subject_rows = []
    subject_ids = sorted({item["subjectId"] for item in documents})
    for subject_id in subject_ids:
        mapping = next(value for value in SUBJECTS.values() if value[0] == subject_id)
        subject_docs = [item for item in documents if item["subjectId"] == subject_id]
        subject_media = [item for item in media if item["subjectId"] == subject_id]
        subject_rows.append(
            {
                "id": subject_id,
                "label": mapping[1],
                "category": mapping[2],
                "questionDocumentCount": sum(item["documentType"] in {"question", "combined"} for item in subject_docs),
                "answerDocumentCount": sum(item["documentType"] == "answer" for item in subject_docs),
                "referenceDocumentCount": sum(item["documentType"] == "reference" for item in subject_docs),
                "mediaCount": len(subject_media),
            }
        )

    catalog = {
        "schemaVersion": SCHEMA_VERSION,
        "source": "AP question bank",
        "subjects": subject_rows,
        "documents": sorted(documents, key=lambda item: (item["subjectId"], -(item.get("year") or 0), item["title"])),
        "media": sorted(media, key=lambda item: (item["subjectId"], item["relativePath"])),
        "summary": {
            "sourceFileCount": len(all_files),
            "uniqueDocumentCount": len(documents),
            "mediaFileCount": len(media),
            "questionDocumentCount": sum(item["documentType"] in {"question", "combined"} for item in documents),
            "answerDocumentCount": sum(item["documentType"] == "answer" for item in documents),
            "referenceDocumentCount": sum(item["documentType"] == "reference" for item in documents),
            "duplicateDocumentCount": sum(len(item.get("duplicatePaths", [])) for item in documents),
            "totalBytes": sum(path.stat().st_size for path in all_files),
        },
    }
    catalog_path = output_root / "catalog.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    write_typescript_catalog(catalog, Path("apps/api/src/learning/ap-catalog.generated.ts"))
    (output_root / "unknown-subjects.json").write_text(
        json.dumps(unknown_subjects, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE_DEFAULT)
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--workers", type=int, default=max(2, min(8, os.cpu_count() or 4)))
    parser.add_argument("--catalog-only", action="store_true")
    parser.add_argument("--ocr-scans", action="store_true")
    parser.add_argument("--ocr-only", action="store_true")
    args = parser.parse_args()
    catalog = (
        run_ocr_only(args.source, args.output, args.workers)
        if args.ocr_only
        else build(args.source, args.output, args.workers, not args.catalog_only, args.ocr_scans)
    )
    print(json.dumps(catalog["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
