#!/usr/bin/env python3
"""Build the complete SAT grammar interactive-practice catalog.

All 985 deduplicated source records are published.  Source-backed answers are
gradable; records whose answer is pending or conflicting remain interactive but
are explicitly excluded from accuracy calculations.  Image questions use the
pipeline's v7 answer-free workbook crops.  Native DOCX/HTML questions are
rendered as structured text in the web app.

Run from the repository root.  Pass ``--source-root`` when the SAT source tree
is not at its default Windows location.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image


DEFAULT_SOURCE_ROOT = Path("D:/BaiduNetdiskDownload/SAT真题")
DEFAULT_OUTPUT_DIR = Path("apps/web/public/content/sat-grammar/questions")
DEFAULT_CATALOG = Path("apps/web/data/sat-grammar-practice.json")
RELIABLE_ANSWER_STATUSES = {"original_answer", "inferred_duplicate"}
ANSWERS = {"A", "B", "C", "D"}

CATEGORY_TO_ENTRY = {
    "主语与谓语之间的标点": "commas-parentheticals",
    "句界与独立分句": "clause-boundaries",
    "插入语与补充成分": "commas-parentheticals",
    "标点选择": "semicolons-colons-dashes",
    "主谓一致": "subject-verb-agreement",
    "代词指代与格": "pronouns",
    "修饰语": "modifiers",
    "动词形式": "verb-forms",
    "动词时态": "tense-voice-mood",
    "句法与语意完整性": "syntax-completeness",
    "平行结构": "parallelism",
    "所有格与撇号": "possessives-apostrophes",
    "比较结构": "comparisons",
}

ANSWER_MARKER = re.compile(
    r"(?:Correct\s+Answer|Answer|答案)\s*[:：]\s*([A-D])",
    re.IGNORECASE,
)
OPTION_MARKER = re.compile(
    r"(?ms)^\s*(?:[-•]\s*)?([A-D])\.\s*(.+?)(?=^\s*(?:[-•]\s*)?[A-D]\.\s|\Z)"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    return parser.parse_args()


def normalize_image(image: Image.Image, max_width: int = 1120) -> Image.Image:
    image = image.convert("RGB")
    if image.width <= max_width:
        return image
    height = round(image.height * max_width / image.width)
    return image.resize((max_width, height), Image.Resampling.LANCZOS)


def workbook_crop(source_root: Path, item: dict[str, Any]) -> Path | None:
    question_asset = str(item.get("question_asset") or "")
    if not question_asset:
        return None
    asset_key = hashlib.sha1(question_asset.encode("utf-8")).hexdigest()[:10]
    crop = (
        source_root
        / "tmp/pdfs/workbook_crops"
        / f"{item['id']}_{asset_key}_question_v7.jpg"
    )
    if not crop.exists():
        raise FileNotFoundError(f"Missing answer-free question crop: {crop}")
    return crop


def compact_text(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\r", "")
    value = re.sub(r"(?m)^\s*[-•]\s?", "", value)
    value = re.sub(r"(?m)^\s*blank\s*$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def native_question_surface(item: dict[str, Any]) -> tuple[str, list[str]]:
    """Extract the first answer-free question from a native DOCX/HTML page."""
    text = str(item.get("ocr_text") or "")
    marker = ANSWER_MARKER.search(text)
    surface = text[: marker.start()] if marker else text
    surface = compact_text(surface)
    matches = list(OPTION_MARKER.finditer(surface))

    if [match.group(1).upper() for match in matches[-4:]] == ["A", "B", "C", "D"]:
        matches = matches[-4:]
        prompt = compact_text(surface[: matches[0].start()])
        options = [compact_text(match.group(2)) for match in matches]
        return prompt, options

    # The native extractors occasionally collapse line breaks.  Keep the safe
    # answer-free surface visible even when four option bodies cannot be split.
    return surface, []


def public_asset_path(item_id: str) -> str:
    return f"/content/sat-grammar/questions/{item_id}.webp"


def is_gradable(item: dict[str, Any]) -> bool:
    return bool(
        item.get("answer_status") in RELIABLE_ANSWER_STATUSES
        and item.get("answer") in ANSWERS
    )


def explanation_for(item: dict[str, Any], gradable: bool) -> str:
    if gradable:
        return str(
            item.get("chinese_explanation")
            or f"正确答案：{item['answer']}。请结合本题所属知识点复盘句子结构与选项差异。"
        )
    if item.get("answer_status") == "conflict_review":
        candidates = "、".join(str(value) for value in item.get("answer_candidates") or [])
        suffix = f"（来源记录为 {candidates}）" if candidates else ""
        return f"源材料中的答案记录存在冲突{suffix}，本次选择只记录、不计入正确率。"
    return "源材料暂未提供可唯一核验的答案。本次选择已记录，不计入正确率。"


def build_record(
    item: dict[str, Any],
    image_size: tuple[int, int] | None,
    question_text: str | None,
    choice_texts: list[str],
) -> dict[str, Any]:
    category = str(item.get("subtopic") or "综合语法")
    chapter_id = CATEGORY_TO_ENTRY.get(category, "syntax-completeness")
    gradable = is_gradable(item)
    answer = item.get("answer") if gradable else None
    return {
        "id": item["id"],
        "chapterId": chapter_id,
        "category": category,
        "officialSkill": item.get("official_skill") or "Form, Structure, and Sense",
        "difficulty": item.get("difficulty") or "Medium",
        "answer": answer,
        "answerStatus": item.get("answer_status") or "pending_verification",
        "answerCandidates": item.get("answer_candidates") or [],
        "gradable": gradable,
        "asset": public_asset_path(item["id"]) if image_size else None,
        "assetWidth": image_size[0] if image_size else None,
        "assetHeight": image_size[1] if image_size else None,
        "questionText": question_text,
        "choiceTexts": choice_texts,
        "explanation": explanation_for(item, gradable),
    }


def main() -> None:
    args = parse_args()
    source_catalog = args.source_root / "output/data/sat_grammar_items.json"
    items: list[dict[str, Any]] = json.loads(source_catalog.read_text(encoding="utf-8"))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    expected_files: set[str] = set()
    records: list[dict[str, Any]] = []

    for item in items:
        source_crop = workbook_crop(args.source_root, item)
        if source_crop:
            destination = args.output_dir / f"{item['id']}.webp"
            expected_files.add(destination.name)
            with Image.open(source_crop) as source_image:
                output_image = normalize_image(source_image)
                output_image.save(destination, "WEBP", quality=82, method=6)
                image_size: tuple[int, int] | None = output_image.size
            question_text = None
            choice_texts: list[str] = []
        else:
            image_size = None
            question_text, choice_texts = native_question_surface(item)
        records.append(build_record(item, image_size, question_text, choice_texts))

    for stale_file in args.output_dir.glob("*.webp"):
        if stale_file.name not in expected_files:
            stale_file.unlink()

    category_counts: dict[str, int] = {}
    chapter_counts: dict[str, int] = {}
    for record in records:
        category_counts[record["category"]] = category_counts.get(record["category"], 0) + 1
        chapter_counts[record["chapterId"]] = chapter_counts.get(record["chapterId"], 0) + 1

    gradable_count = sum(bool(record["gradable"]) for record in records)
    pending_count = sum(
        record["answerStatus"] == "pending_verification" for record in records
    )
    conflict_count = sum(record["answerStatus"] == "conflict_review" for record in records)
    image_count = sum(bool(record["asset"]) for record in records)
    text_count = len(records) - image_count

    payload = {
        "version": "2026-08-02-complete",
        "source": "SAT语法单项训练_全量版.pdf",
        "summary": {
            "sourceItemCount": len(items),
            "interactiveItemCount": len(records),
            "excludedItemCount": len(items) - len(records),
            "gradableItemCount": gradable_count,
            "pendingVerificationCount": pending_count,
            "conflictReviewCount": conflict_count,
            "imageItemCount": image_count,
            "textItemCount": text_count,
            "categoryCounts": dict(sorted(category_counts.items())),
            "chapterCounts": dict(sorted(chapter_counts.items())),
        },
        "items": records,
    }
    args.catalog.parent.mkdir(parents=True, exist_ok=True)
    args.catalog.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Built {len(records)} SAT grammar questions from {len(items)} source records: "
        f"{gradable_count} gradable, {pending_count} pending, {conflict_count} conflict."
    )


if __name__ == "__main__":
    main()
