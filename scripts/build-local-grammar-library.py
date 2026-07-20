#!/usr/bin/env python3
"""Build the local Aurelis grammar library from the curated three-book synthesis."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


LEVELS = (
    ("beginner", "初级", "基础形式与核心意义", "beginner"),
    ("intermediate", "中级", "用法对比与结构限制", "intermediate"),
    ("advanced", "高级", "复杂结构、语体与信息组织", "advanced"),
)


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载模块：{path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def compact_ranges(numbers: list[int]) -> str:
    if not numbers:
        return ""
    numbers = sorted(set(numbers))
    ranges: list[str] = []
    start = previous = numbers[0]
    for number in numbers[1:]:
        if number == previous + 1:
            previous = number
            continue
        ranges.append(str(start) if start == previous else f"{start}–{previous}")
        start = previous = number
    ranges.append(str(start) if start == previous else f"{start}–{previous}")
    return "、".join(ranges)


def build_source_map(
    topic_slugs: set[str],
    books: tuple[tuple[str, int], ...],
    source_sequences: dict[str, list[tuple[int, int, list[str]]]],
) -> tuple[dict[str, dict[str, list[int]]], list[dict[str, Any]]]:
    reverse: dict[str, dict[str, list[int]]] = {
        slug: {book: [] for book, _ in books} for slug in topic_slugs
    }
    mappings: list[dict[str, Any]] = []
    for book, total in books:
        seen: set[int] = set()
        for start, end, slugs in source_sequences[book]:
            span = end - start + 1
            for offset, unit in enumerate(range(start, end + 1)):
                topic_index = min(len(slugs) - 1, (offset * len(slugs)) // span)
                slug = slugs[topic_index]
                if slug not in topic_slugs:
                    raise ValueError(f"来源映射包含未知知识点：{slug}")
                if unit in seen:
                    raise ValueError(f"{book} Unit {unit} 被重复映射")
                seen.add(unit)
                reverse[slug][book].append(unit)
                mappings.append({"book": book, "unit": unit, "topicId": slug})
        expected = set(range(1, total + 1))
        if seen != expected:
            missing = sorted(expected - seen)
            extra = sorted(seen - expected)
            raise ValueError(f"{book} 来源单元不完整，缺失={missing}，越界={extra}")
    return reverse, mappings


def build_library(grammar_root: Path) -> dict[str, Any]:
    tools_dir = grammar_root / "tools"
    grammar_data = load_module("grammar_data", tools_dir / "grammar_data.py")
    grammar_builder = load_module("aurelis_grammar_builder", tools_dir / "build_grammar_pdf.py")

    parts = grammar_data.PARTS
    books = grammar_builder.BOOKS
    all_topics = [topic for part in parts for topic in part.topics]
    topic_slugs = {topic.slug for topic in all_topics}
    if len(topic_slugs) != len(all_topics):
        raise ValueError("知识点 slug 存在重复")

    reverse, mappings = build_source_map(topic_slugs, books, grammar_builder.SOURCE_SEQUENCES)
    global_sequence = 0
    part_rows: list[dict[str, Any]] = []
    for part_index, part in enumerate(parts, start=1):
        topic_rows: list[dict[str, Any]] = []
        for topic_index, topic in enumerate(part.topics, start=1):
            global_sequence += 1
            sources = []
            for book, _ in books:
                units = reverse[topic.slug][book]
                if units:
                    sources.append(
                        {
                            "level": book,
                            "units": units,
                            "rangeLabel": f"Unit {compact_ranges(units)}",
                        }
                    )
            topic_rows.append(
                {
                    "id": topic.slug,
                    "sequence": topic_index,
                    "globalSequence": global_sequence,
                    "title": topic.title,
                    "english": topic.english,
                    "overview": topic.overview,
                    "patterns": list(topic.patterns),
                    "levels": [
                        {
                            "id": level_id,
                            "label": label,
                            "focus": focus,
                            "sequence": level_index,
                            "content": list(getattr(topic, field_name)),
                            "source": next(
                                (source for source in sources if source["level"] == label),
                                None,
                            ),
                        }
                        for level_index, (level_id, label, focus, field_name) in enumerate(
                            LEVELS, start=1
                        )
                    ],
                    "examples": [
                        {"english": english, "chinese": chinese}
                        for english, chinese in topic.examples
                    ],
                    "mistakes": [
                        {"wrong": wrong, "right": right, "explanation": explanation}
                        for wrong, right, explanation in topic.mistakes
                    ],
                    "related": list(topic.related),
                    "sources": sources,
                }
            )
        part_rows.append(
            {
                "id": f"part-{part_index:02d}",
                "sequence": part_index,
                "title": part.title,
                "english": part.english,
                "summary": part.summary,
                "topics": topic_rows,
            }
        )

    total_units = sum(total for _, total in books)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "title": "Aurelis 英语语法完整学习路径",
        "description": "基于《剑桥初级英语语法》《剑桥中级英语语法》《剑桥高级英语语法》的三阶融合路径。",
        "sources": [
            {
                "id": level_id,
                "level": label,
                "title": f"剑桥{label}英语语法",
                "unitCount": total,
            }
            for (level_id, label, _, _), (_, total) in zip(LEVELS, books, strict=True)
        ],
        "summary": {
            "partCount": len(part_rows),
            "topicCount": len(all_topics),
            "levelLessonCount": len(all_topics) * len(LEVELS),
            "sourceUnitCount": total_units,
        },
        "parts": part_rows,
        "sourceMappings": mappings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--grammar-root",
        type=Path,
        default=Path(r"D:\留学\托福\语法"),
        help="包含 tools/grammar_data.py 的三本语法书整理目录",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("apps/web/data/grammar-library.json"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    library = build_library(args.grammar_root.resolve())
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(library, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = library["summary"]
    print(
        f"已生成 {output}：{summary['partCount']} 个模块，"
        f"{summary['topicCount']} 个知识点，{summary['sourceUnitCount']} 个来源单元"
    )


if __name__ == "__main__":
    main()
