#!/usr/bin/env python3
"""Build the SAT grammar interactive-practice catalog and safe question images.

The source item catalog mixes complete question screenshots, answer-only crops,
and unverified records.  This builder deliberately keeps only questions that:

1. have a source-backed answer;
2. contain a complete four-choice question surface; and
3. can be cropped without exposing the source answer or rationale.

Run from the repository root.  Pass ``--source-root`` when the SAT source tree
is not at its default Windows location.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image


DEFAULT_SOURCE_ROOT = Path("D:/BaiduNetdiskDownload/SAT真题")
DEFAULT_OUTPUT_DIR = Path("apps/web/public/content/sat-grammar/questions")
DEFAULT_CATALOG = Path("apps/web/data/sat-grammar-practice.json")
RELIABLE_ANSWER_STATUSES = {"original_answer", "inferred_duplicate"}

# Visual QA found these source crops to be incomplete, ambiguous (two questions
# in one crop), or already marked with the correct answer.  Keep the exclusions
# explicit so rebuilding the catalog cannot silently reintroduce answer leaks.
KNOWN_INVALID_ITEM_IDS = {
    "G0108",  # two questions in one crop
    "G0155",  # choices C-D only
    "G0172",  # correct option pre-highlighted
    "G0199",  # choices only; prompt missing
    "G0223",  # correct option pre-highlighted
    "G0273",  # choices C-D only
    "G0373",  # tail of a previous question
    "G0375",  # choices C-D only
    "G0756",  # beginning of the prompt is missing
    "G0920",  # choice D only
    "G0921",  # choices C-D only
    "G0922",  # choices C-D only
    "G0981",  # choices C-D only
}

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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    return parser.parse_args()


def line_y(line: dict[str, Any]) -> int | None:
    values = [
        word.get("y")
        for word in line.get("words", [])
        if isinstance(word.get("y"), (int, float))
    ]
    return int(min(values)) if values else None


def answer_marker_y(item: dict[str, Any]) -> int | None:
    markers: list[int] = []
    for line in item.get("ocr_lines") or []:
        text = str(line.get("text") or "").strip()
        y = line_y(line)
        if y is None:
            continue
        is_marker = bool(
            re.search(r"\bCorrect\s+Answer\b", text, re.IGNORECASE)
            or (
                re.search(r"\bID\s*:", text, re.IGNORECASE)
                and re.search(r"\bAnswer\b", text, re.IGNORECASE)
            )
            or re.fullmatch(r"Rationale", text, re.IGNORECASE)
        )
        if is_marker:
            markers.append(y)
    return min(markers) if markers else None


def is_complete_reliable_question(item: dict[str, Any]) -> bool:
    if item.get("id") in KNOWN_INVALID_ITEM_IDS:
        return False
    if item.get("answer_status") not in RELIABLE_ANSWER_STATUSES:
        return False
    if item.get("answer") not in {"A", "B", "C", "D"}:
        return False
    if not item.get("question_asset"):
        return False

    marker = answer_marker_y(item)
    has_four_options = len(item.get("options") or []) == 4
    source_kind = item.get("source_kind")

    # Official PDF pages with an answer section necessarily contain the full
    # question above that section.  Question-only PDF/segment crops must have
    # four detected options so answer-only and truncated crops are rejected.
    return bool((source_kind == "pdf" and marker is not None) or has_four_options)


def safe_crop(image: Image.Image, item: dict[str, Any]) -> Image.Image:
    marker = answer_marker_y(item)
    if marker is None:
        return image

    # Keep a small white gutter after choice D and stop before the ID/Answer
    # heading.  The marker coordinates are in source-image pixels.
    crop_bottom = max(1, min(image.height, marker - 20))
    return image.crop((0, 0, image.width, crop_bottom))


def normalize_image(image: Image.Image, max_width: int = 1120) -> Image.Image:
    image = image.convert("RGB")
    if image.width <= max_width:
        return image
    height = round(image.height * max_width / image.width)
    return image.resize((max_width, height), Image.Resampling.LANCZOS)


def public_asset_path(item_id: str) -> str:
    return f"/content/sat-grammar/questions/{item_id}.webp"


def build_record(item: dict[str, Any], image_size: tuple[int, int]) -> dict[str, Any]:
    category = str(item.get("subtopic") or "综合语法")
    chapter_id = CATEGORY_TO_ENTRY.get(category, "syntax-completeness")
    return {
        "id": item["id"],
        "chapterId": chapter_id,
        "category": category,
        "officialSkill": item.get("official_skill") or "Standard English Conventions",
        "difficulty": item.get("difficulty") or "Medium",
        "answer": item["answer"],
        "answerStatus": item["answer_status"],
        "asset": public_asset_path(item["id"]),
        "assetWidth": image_size[0],
        "assetHeight": image_size[1],
        "explanation": (
            item.get("chinese_explanation")
            or f"正确答案：{item['answer']}。请结合本题所属知识点复盘句子结构与选项差异。"
        ),
    }


def main() -> None:
    args = parse_args()
    source_catalog = args.source_root / "output/data/sat_grammar_items.json"
    items: list[dict[str, Any]] = json.loads(source_catalog.read_text(encoding="utf-8"))
    selected = [item for item in items if is_complete_reliable_question(item)]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    expected_files: set[str] = set()
    records: list[dict[str, Any]] = []

    for item in selected:
        source_asset = args.source_root / Path(str(item["question_asset"]).replace("\\", "/"))
        destination = args.output_dir / f"{item['id']}.webp"
        expected_files.add(destination.name)
        with Image.open(source_asset) as source_image:
            output_image = normalize_image(safe_crop(source_image, item))
            output_image.save(destination, "WEBP", quality=80, method=6)
            output_size = output_image.size
        records.append(build_record(item, output_size))

    for stale_file in args.output_dir.glob("*.webp"):
        if stale_file.name not in expected_files:
            stale_file.unlink()

    category_counts: dict[str, int] = {}
    chapter_counts: dict[str, int] = {}
    for record in records:
        category_counts[record["category"]] = category_counts.get(record["category"], 0) + 1
        chapter_counts[record["chapterId"]] = chapter_counts.get(record["chapterId"], 0) + 1

    payload = {
        "version": "2026-08-02",
        "source": "SAT语法单项训练_全量版.pdf",
        "summary": {
            "sourceItemCount": len(items),
            "interactiveItemCount": len(records),
            "excludedItemCount": len(items) - len(records),
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
        f"Built {len(records)} interactive SAT grammar questions "
        f"from {len(items)} source records."
    )


if __name__ == "__main__":
    main()
