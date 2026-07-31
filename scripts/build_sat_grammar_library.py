#!/usr/bin/env python3
"""Build the SAT grammar library from the 3000-word PDF source."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import fitz


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "source" / "语法书" / "SAT语法知识点大全_3000词汇量版.pdf"
DEFAULT_OUTPUT = ROOT / "apps" / "web" / "data" / "grammar-library.json"

CHAPTERS = (
    ("complete-sentence", "Complete Sentence Structure", 1, "3–4"),
    ("phrases-and-clauses", "Phrases and Clauses", 1, "4–5"),
    ("sentence-types", "Four Basic Sentence Types", 1, "5"),
    ("joining-independent-clauses", "Joining Independent Clauses", 1, "5–6"),
    ("sentence-boundary-errors", "Sentence Boundary Errors", 1, "7"),
    ("dependent-and-main-clauses", "Dependent and Main Clauses", 1, "7–8"),
    ("colons", "Colons", 2, "8–9"),
    ("dashes", "Dashes", 2, "9"),
    ("commas", "Commas", 2, "9–10"),
    ("comma-restrictions", "Where Commas Do Not Belong", 2, "10"),
    ("subject-verb-agreement", "Subject-Verb Agreement", 3, "11–12"),
    ("finite-and-nonfinite-verbs", "Finite and Nonfinite Verbs", 3, "12–13"),
    ("verb-tense", "Verb Tense", 3, "13–14"),
    ("pronouns", "Pronouns", 4, "15–16"),
    ("possessives-and-plurals", "Possessives and Plurals", 4, "16–17"),
    ("modifiers", "Modifiers", 4, "17–18"),
    ("restrictive-information", "Restrictive and Nonrestrictive Information", 4, "18"),
    ("parallel-structure", "Parallel Structure", 4, "18–19"),
    ("comparisons", "Comparisons", 4, "19–20"),
    ("adjectives-and-adverbs", "Adjectives and Adverbs", 4, "20"),
    ("count-and-noncount-nouns", "Count and Noncount Nouns", 4, "20–21"),
    ("articles", "Articles", 4, "21–22"),
    ("transitions", "Logical Transitions", 5, "22–23"),
    ("sat-grammar-traps", "Common SAT Grammar Traps", 5, "23–24"),
    ("sat-grammar-workflow", "SAT Grammar Workflow", 5, "24–25"),
    ("essential-formulas", "Essential Formulas", 5, "25"),
    ("study-priorities", "Study Priorities and Summary", 5, "25–26"),
)

MODULES = (
    (
        "sentence-foundations",
        "句子基础",
        "Sentence Foundations",
        "先找主语和谓语，再判断短语、从句、句型与句子边界。",
    ),
    (
        "punctuation",
        "标点与句子边界",
        "Punctuation and Sentence Boundaries",
        "用冒号、破折号和逗号表达正确的句法关系。",
    ),
    (
        "verbs",
        "动词系统",
        "The Verb System",
        "检查主谓一致、谓语与非谓语，并根据时间线选择时态。",
    ),
    (
        "sentence-details",
        "句子细节",
        "Sentence Details",
        "处理代词、所有格、修饰语、平行、比较、词性与名词。",
    ),
    (
        "logic-and-strategy",
        "逻辑与做题策略",
        "Logic and Test Strategy",
        "判断句间逻辑，掌握高频陷阱、固定分析流程和必记公式。",
    ),
)

SPECIAL_HEADINGS = {
    "核心问题",
    "基本规则",
    "冒号规则",
    "公式",
    "做题原则",
    "做题方法",
    "固定分析流程",
    "最终总结",
}


def clean_pages(source: Path) -> list[str]:
    document = fitz.open(source)
    pages: list[str] = []
    for page_number, page in enumerate(document, 1):
        lines = [line.strip() for line in page.get_text("text").splitlines()]
        cleaned: list[str] = []
        bullet_pending = False
        for line in lines:
            if not line or line == str(page_number):
                continue
            if line.startswith("SAT 语法知识点大全 · 3000 词汇量版"):
                continue
            if line == "\uf0b7":
                bullet_pending = True
                continue
            if bullet_pending:
                line = f"• {line}"
                bullet_pending = False
            cleaned.append(line)
        pages.append("\n".join(cleaned))
    return pages


def joined_text(pages: list[str]) -> str:
    text = "\n".join(pages[2:])
    replacements = {
        "Mia thought \nthe movie was boring.": "Mia thought the movie was boring.",
        "单复数和所有\n格 →": "单复数和所有格 →",
        "大多\n数 SAT": "大多数 SAT",
    }
    for before, after in replacements.items():
        text = text.replace(before, after)
    return text


def split_chapters(text: str) -> list[tuple[str, list[str]]]:
    heading = re.compile(r"(?m)^第[\u4e00-\u9fa5]+部分：\s*(.+)$")
    matches = list(heading.finditer(text))
    if len(matches) != len(CHAPTERS):
        raise ValueError(f"期望 27 章，实际解析到 {len(matches)} 章")
    chapters: list[tuple[str, list[str]]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        lines = [line.strip() for line in text[match.end() : end].splitlines() if line.strip()]
        chapters.append((match.group(1).strip(), lines))
    return chapters


def section_heading(line: str) -> str | None:
    numbered = re.match(r"^[一二三四五六七八九十百]+、\s*(.+)$", line)
    if numbered:
        return numbered.group(1).strip()
    labeled = re.match(
        r"^(?:陷阱[一二三四五六七八九十]|第[一二三四五六七八九十]+步|第[一二三四五六七八九十]+阶段)：\s*(.+)$",
        line,
    )
    if labeled:
        return line
    if line in SPECIAL_HEADINGS:
        return line
    return None


def build_sections(lines: list[str]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    current = {"title": "本章要点", "lines": []}
    for line in lines:
        heading = section_heading(line)
        if heading:
            if current["lines"]:
                sections.append(current)
            current = {"title": heading, "lines": []}
        else:
            current["lines"].append(line)
    if current["lines"]:
        sections.append(current)
    return sections


def display_line(line: str) -> str:
    return re.sub(r"^(?:错误|正确|不清楚|清楚|更清楚|简化)：\s*", "", line).strip()


def looks_english(line: str) -> bool:
    value = display_line(line)
    latin = len(re.findall(r"[A-Za-z]", value))
    chinese = len(re.findall(r"[\u3400-\u9fff]", value))
    return latin >= 3 and (value[:1].isascii() or latin > chinese * 1.5)


def build_examples(sections: list[dict[str, Any]]) -> list[dict[str, str]]:
    examples: list[dict[str, str]] = []
    seen: set[str] = set()
    for section in sections:
        lines = section["lines"]
        for index, line in enumerate(lines):
            if line.startswith(("错误：", "不清楚：")) or not looks_english(line):
                continue
            english = display_line(line)
            if english in seen:
                continue
            note = ""
            if index + 1 < len(lines) and not looks_english(lines[index + 1]):
                note = lines[index + 1]
            examples.append({"english": english, "chinese": "", "note": note or section["title"]})
            seen.add(english)
    return examples


def build_mistakes(sections: list[dict[str, Any]]) -> list[dict[str, str]]:
    mistakes: list[dict[str, str]] = []
    seen: set[str] = set()
    for section in sections:
        lines = section["lines"]
        for index, line in enumerate(lines):
            if not line.startswith(("错误：", "不清楚：")):
                continue
            wrong = display_line(line)
            right = ""
            explanation = section["title"]
            for candidate in lines[index + 1 : index + 4]:
                if candidate.startswith(("正确：", "清楚：", "更清楚：", "简化：")):
                    right = display_line(candidate)
                    continue
                if right and not looks_english(candidate):
                    explanation = candidate
                    break
            if right and wrong not in seen:
                mistakes.append({"wrong": wrong, "right": right, "explanation": explanation})
                seen.add(wrong)
    return mistakes


def first_summary_line(sections: list[dict[str, Any]], fallback: str) -> str:
    for section in sections:
        for line in section["lines"]:
            if not looks_english(line) and not line.startswith("• "):
                return line
    return fallback


def build_library(source: Path) -> dict[str, Any]:
    pages = clean_pages(source)
    chapters = split_chapters(joined_text(pages))
    topics: list[dict[str, Any]] = []
    for index, ((title, lines), definition) in enumerate(zip(chapters, CHAPTERS, strict=True), 1):
        topic_id, english, module_sequence, page_range = definition
        sections = build_sections(lines)
        summary = first_summary_line(sections, f"学习{title}的 SAT 核心用法。")
        rules = [
            f"{section['title']}：{section['lines'][0]}"
            for section in sections
            if section["lines"]
        ]
        source_ref = {"level": "SAT 3000词汇量版", "rangeLabel": f"第 {page_range} 页"}
        topics.append(
            {
                "id": topic_id,
                "sequence": sum(1 for topic in topics if topic["moduleSequence"] == module_sequence) + 1,
                "globalSequence": index,
                "moduleSequence": module_sequence,
                "title": title,
                "english": english,
                "overview": summary,
                "patterns": [],
                "levels": [
                    {
                        "id": "beginner",
                        "label": "SAT核心",
                        "focus": title,
                        "sequence": 1,
                        "content": rules,
                        "source": source_ref,
                    }
                ],
                "examples": build_examples(sections),
                "mistakes": build_mistakes(sections),
                "sections": sections,
                "related": [],
                "sources": [source_ref],
            }
        )

    parts: list[dict[str, Any]] = []
    for sequence, (module_id, title, english, summary) in enumerate(MODULES, 1):
        module_topics: list[dict[str, Any]] = []
        for topic in topics:
            if topic["moduleSequence"] != sequence:
                continue
            topic = {key: value for key, value in topic.items() if key != "moduleSequence"}
            module_topics.append(topic)
        parts.append(
            {
                "id": module_id,
                "sequence": sequence,
                "title": title,
                "english": english,
                "summary": summary,
                "topics": module_topics,
            }
        )

    return {
        "version": "sat-grammar-3000-v1",
        "generatedAt": None,
        "title": "SAT 语法知识点大全",
        "description": "基于《SAT 语法知识点大全 - 3000 词汇量版》的 27 章句子结构课程。",
        "summary": {
            "partCount": len(parts),
            "topicCount": len(topics),
            "levelLessonCount": len(topics),
            "sourceUnitCount": len(topics),
        },
        "sources": [
            {
                "id": "sat-grammar-3000",
                "level": "SAT 3000词汇量版",
                "fileName": source.name,
                "unitCount": len(topics),
            }
        ],
        "parts": parts,
        "sourceMappings": [
            {"book": "sat-grammar-3000", "unit": index, "topicId": topic[0]}
            for index, topic in enumerate(CHAPTERS, 1)
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    library = build_library(args.source.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(library, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Built {library['summary']['topicCount']} SAT grammar chapters "
        f"across {library['summary']['partCount']} modules."
    )


if __name__ == "__main__":
    main()
