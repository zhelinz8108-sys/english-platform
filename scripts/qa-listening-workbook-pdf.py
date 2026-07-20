#!/usr/bin/env python3
"""Run structural and thumbnail QA on a rendered listening-workbook PDF."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import fitz
from PIL import Image, ImageDraw


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--expected-sets", type=int, required=True)
    parser.add_argument("--expected-questions", type=int, required=True)
    return parser.parse_args()


def page_image(page: fitz.Page, scale: float) -> Image.Image:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    document = fitz.open(args.pdf)
    counts = {
        "transcriptSections": 0,
        "questionSections": 0,
        "answerSections": 0,
        "answerLeads": 0,
    }
    issues: list[dict[str, object]] = []
    first_bbc_page: int | None = None
    body_character_counts: list[int] = []
    all_text: list[str] = []

    for page_index, page in enumerate(document):
        text = page.get_text("text")
        all_text.append(text)
        counts["transcriptSections"] += text.count("TRANSCRIPT")
        counts["questionSections"] += text.count("QUESTIONS")
        counts["answerSections"] += text.count("ANSWERS & EXPLANATIONS")
        counts["answerLeads"] += len(
            re.findall(r"第\s*[1-4]\s*题\s*·\s*正确答案\s*[A-D]", text)
        )
        if first_bbc_page is None and "Academic Discussion" in text:
            first_bbc_page = page_index + 1
        if "�" in text:
            issues.append({"page": page_index + 1, "issue": "replacement-character"})
        body_chars = 0
        for x0, y0, x1, y1, block_text, *_ in page.get_text("blocks"):
            if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                issues.append(
                    {
                        "page": page_index + 1,
                        "issue": "text-outside-page",
                        "bbox": [x0, y0, x1, y1],
                    }
                )
            if 70 <= y0 <= page.rect.height - 55:
                body_chars += len(block_text.strip())
        body_character_counts.append(body_chars)

    expected = {
        "transcriptSections": args.expected_sets,
        "questionSections": args.expected_sets,
        "answerSections": args.expected_sets,
        "answerLeads": args.expected_questions,
    }
    for key, expected_count in expected.items():
        if counts[key] != expected_count:
            issues.append(
                {
                    "issue": "content-count-mismatch",
                    "field": key,
                    "expected": expected_count,
                    "actual": counts[key],
                }
            )

    thumb_scale = 1 / 6
    columns, rows = 8, 8
    thumb_width = round(document[0].rect.width * thumb_scale)
    thumb_height = round(document[0].rect.height * thumb_scale)
    sheet_width = columns * thumb_width
    sheet_height = rows * (thumb_height + 14)
    for sheet_index in range(math.ceil(len(document) / (columns * rows))):
        sheet = Image.new("RGB", (sheet_width, sheet_height), "white")
        draw = ImageDraw.Draw(sheet)
        start = sheet_index * columns * rows
        stop = min(len(document), start + columns * rows)
        for page_index in range(start, stop):
            slot = page_index - start
            row, column = divmod(slot, columns)
            x = column * thumb_width
            y = row * (thumb_height + 14)
            thumb = page_image(document[page_index], thumb_scale)
            sheet.paste(thumb, (x, y))
            draw.text((x + 2, y + thumb_height + 1), str(page_index + 1), fill="black")
        sheet.save(args.output_dir / f"contact-{sheet_index + 1:02d}.png", optimize=True)

    selected_pages = {
        1,
        2,
        3,
        len(document),
        max(1, len(document) - 1),
        max(1, len(document) // 2),
    }
    if first_bbc_page is not None:
        selected_pages.update(
            {
                first_bbc_page,
                min(len(document), first_bbc_page + 1),
                min(len(document), first_bbc_page + 2),
            }
        )
    for page_number in sorted(selected_pages):
        image = page_image(document[page_number - 1], 5 / 3)
        image.save(args.output_dir / f"detail-{page_number:04d}.png", optimize=True)

    report = {
        "pdf": str(args.pdf.resolve()),
        "pages": len(document),
        "firstBbcPage": first_bbc_page,
        "counts": counts,
        "expected": expected,
        "bodyCharacters": {
            "minimum": min(body_character_counts),
            "maximum": max(body_character_counts),
            "pagesBelow40": [
                index + 1 for index, value in enumerate(body_character_counts) if value < 40
            ],
        },
        "issues": issues,
    }
    (args.output_dir / "qa-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
