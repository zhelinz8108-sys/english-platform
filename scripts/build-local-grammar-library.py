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


CURRICULUM_PARTS: tuple[dict[str, Any], ...] = (
    {
        "title": "句子骨架、be/do/have",
        "english": "Sentence Structure and Core Auxiliaries",
        "summary": "先掌握句子的层级、核心成分和基本语序，再用 be、do、have 搭起最常用的句型骨架。",
        "topics": (
            "grammar-levels",
            "word-classes",
            "sentence-elements",
            "basic-patterns",
            "agreement-order",
            "core-auxiliaries",
        ),
    },
    {
        "title": "名词、代词、冠词与基础介词",
        "english": "Nouns, Pronouns, Articles and Basic Prepositions",
        "summary": "建立名词短语系统，掌握指代、数量、限定和所属关系，并补齐时间、地点与移动的基础介词。",
        "topics": (
            "countability",
            "number-plurals",
            "possession",
            "indefinite-article",
            "definite-article",
            "zero-generic",
            "determiners-pronouns",
            "reflexive-reciprocal",
            "quantifiers",
            "prepositions",
        ),
    },
    {
        "title": "一般现在时和过去时、否定与疑问",
        "english": "Present and Past Simple, Negation and Questions",
        "summary": "用一般现在时和过去时表达事实、习惯与已发生事件，同时学会构造否定句、疑问句和简短回应。",
        "topics": (
            "verb-forms",
            "state-dynamic",
            "present-simple",
            "past-simple",
            "negation",
            "yes-no-questions",
            "wh-questions",
            "tags-short-answers",
        ),
    },
    {
        "title": "进行时、完成时与时态对比",
        "english": "Progressive and Perfect Aspect, Tense Contrasts",
        "summary": "从进行中的过程、与现在相关的经历和先后关系出发，系统比较容易混淆的时态和体。",
        "topics": (
            "present-progressive",
            "present-contrast",
            "past-progressive",
            "present-perfect",
            "perfect-progressive",
            "perfect-vs-past",
            "past-perfect",
            "time-expressions",
        ),
    },
    {
        "title": "情态动词、祈使句与基本语气",
        "english": "Modal Verbs, Imperatives and Basic Mood",
        "summary": "围绕能力、许可、义务、建议和可能性表达说话者态度，并掌握祈使、感叹和基础强调。",
        "topics": (
            "ability",
            "permission-requests",
            "obligation",
            "prohibition-need",
            "advice",
            "possibility-deduction",
            "modal-perfect",
            "used-to-habit",
            "imperatives-emphasis",
        ),
    },
    {
        "title": "将来表达与时间关系",
        "english": "Future Forms and Time Relations",
        "summary": "区分预测、意图、计划和安排，理解英语如何用多种形式表达将来及时间从句。",
        "topics": (
            "will-shall",
            "going-to",
            "present-future",
            "future-progressive-perfect",
            "future-past-clauses",
        ),
    },
    {
        "title": "形容词、副词、比较与修饰",
        "english": "Adjectives, Adverbs, Comparison and Modification",
        "summary": "建立描述、程度、比较和修饰的完整系统，并掌握形容词、名词和动词常见的介词搭配。",
        "topics": (
            "adjective-position-order",
            "adjective-complements",
            "adverbs-order",
            "comparison",
            "degree-result",
            "dependent-prepositions",
        ),
    },
    {
        "title": "动词配价、不定式、动名词与分词",
        "english": "Verb Valency, Infinitives, Gerunds and Participles",
        "summary": "从动词需要哪些成分出发，学习宾语、补语、非谓语选择、分词结构和高频动词搭配。",
        "topics": (
            "transitivity-linking",
            "objects-complements",
            "common-verbs",
            "infinitive-basics",
            "gerunds",
            "verb-infinitive",
            "verb-gerund",
            "meaning-change",
            "purpose-result",
            "participles",
            "participle-clauses",
            "phrasal-verbs",
        ),
    },
    {
        "title": "被动语态、使役与报告结构",
        "english": "Passive Voice, Causatives and Reporting Structures",
        "summary": "学习改变事件视角、表达使役关系和转述信息，理解形式变化背后的信息焦点。",
        "topics": (
            "passive-forms",
            "passive-use-reporting",
            "causatives",
            "reported-speech",
        ),
    },
    {
        "title": "名词性、定语与状语从句",
        "english": "Complement, Relative and Adverbial Clauses",
        "summary": "先掌握嵌入疑问，再系统学习名词性、关系和状语从句如何扩展简单句。",
        "topics": (
            "indirect-questions",
            "that-wh-clauses",
            "whether-if",
            "defining-relatives",
            "nondefining-relatives",
            "advanced-relatives",
            "time-reason-purpose",
            "contrast-comparison-clauses",
        ),
    },
    {
        "title": "条件句、愿望与虚拟语气",
        "english": "Conditionals, Wishes and Subjunctive Meaning",
        "summary": "在掌握基础从句后学习真实、假设和反事实条件，并表达愿望、建议与虚拟意义。",
        "topics": (
            "conditionals-basic",
            "second-conditional",
            "third-mixed",
            "conditional-connectors",
            "wishes-subjunctive",
        ),
    },
    {
        "title": "倒装、省略、强调与信息结构",
        "english": "Inversion, Ellipsis, Emphasis and Information Structure",
        "summary": "从句法压缩和焦点安排理解高级表达，调整语序、突出重点并保持段落衔接。",
        "topics": (
            "substitution-ellipsis",
            "inversion",
            "clefts-fronting",
            "information-structure",
            "cohesion-register",
        ),
    },
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

    source_parts = grammar_data.PARTS
    books = grammar_builder.BOOKS
    source_topics = [topic for part in source_parts for topic in part.topics]
    source_topic_slugs = {topic.slug for topic in source_topics}
    if len(source_topic_slugs) != len(source_topics):
        raise ValueError("知识点 slug 存在重复")

    topics_by_slug = {topic.slug: topic for topic in source_topics}
    curriculum_topic_slugs = [
        slug for part in CURRICULUM_PARTS for slug in part["topics"]
    ]
    if len(curriculum_topic_slugs) != len(set(curriculum_topic_slugs)):
        raise ValueError("新学习路径中的知识点 slug 存在重复")
    if set(curriculum_topic_slugs) != source_topic_slugs:
        missing = sorted(source_topic_slugs - set(curriculum_topic_slugs))
        extra = sorted(set(curriculum_topic_slugs) - source_topic_slugs)
        raise ValueError(f"新学习路径知识点不完整，缺失={missing}，未知={extra}")
    all_topics = [topics_by_slug[slug] for slug in curriculum_topic_slugs]
    topic_slugs = set(curriculum_topic_slugs)

    reverse, mappings = build_source_map(topic_slugs, books, grammar_builder.SOURCE_SEQUENCES)
    global_sequence = 0
    part_rows: list[dict[str, Any]] = []
    for part_index, part in enumerate(CURRICULUM_PARTS, start=1):
        topic_rows: list[dict[str, Any]] = []
        for topic_index, topic_slug in enumerate(part["topics"], start=1):
            topic = topics_by_slug[topic_slug]
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
                "title": part["title"],
                "english": part["english"],
                "summary": part["summary"],
                "topics": topic_rows,
            }
        )

    total_units = sum(total for _, total in books)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "title": "Aurelis 英语语法完整学习路径",
        "description": "融合《剑桥初级英语语法》《剑桥中级英语语法》《剑桥高级英语语法》，每个知识点按由简到难连续编排。",
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
