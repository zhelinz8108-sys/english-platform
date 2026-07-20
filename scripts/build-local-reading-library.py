#!/usr/bin/env python3
"""Extract CommonLit passages and questions into the local reading library."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber
from bs4 import BeautifulSoup


DEFAULT_WORKSPACE = Path(r"D:\留学\托福\阅读")
DEFAULT_PDF_ROOT = DEFAULT_WORKSPACE / "output" / "pdf" / "CommonLit"
DEFAULT_OUTPUT_ROOT = (
    Path(__file__).resolve().parents[1] / "apps" / "web" / "data" / "commonlit-reading"
)
TEXT_VIEW_PATTERN = re.compile(
    r'<div\s+id="TextView"\s+data-props="([\s\S]*?)"\s+translate="no"></div>',
    re.IGNORECASE,
)
FILE_PATTERN = re.compile(r"^(\d{3})_(.+)\.html$", re.IGNORECASE)
QUESTION_PATTERN = re.compile(r"^(\d{1,2})\.\s+(.+)$")
OPTION_PATTERN = re.compile(r"^([A-D])\.\s+(.+)$")
PAGE_NUMBER_PATTERN = re.compile(r"^\d{1,3}$")
SPACE_PATTERN = re.compile(r"\s+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workspace",
        type=Path,
        default=Path(os.environ.get("COMMONLIT_READING_WORKSPACE", DEFAULT_WORKSPACE)),
    )
    parser.add_argument(
        "--pdf-root",
        type=Path,
        default=Path(os.environ.get("COMMONLIT_READING_SOURCE_DIR", DEFAULT_PDF_ROOT)),
    )
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--grade", type=int, choices=range(3, 13))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 4))
    return parser.parse_args()


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return SPACE_PATTERN.sub(" ", value.replace("\xa0", " ")).strip()


def text_from_html(value: str | None) -> str:
    if not value:
        return ""
    if "<" not in value and "&" not in value:
        return normalize_text(value)
    return normalize_text(BeautifulSoup(value, "html.parser").get_text(" ", strip=True))


def ordered_children(children: Any) -> list[Any]:
    if not isinstance(children, dict):
        return []

    def key(value: tuple[str, Any]) -> tuple[int, int | str]:
        raw = value[0]
        return (0, int(raw)) if raw.isdigit() else (1, raw)

    return [child for _, child in sorted(children.items(), key=key)]


def node_text(node: Any) -> str:
    if node is None:
        return ""
    if not isinstance(node, dict):
        return normalize_text(str(node))
    if node.get("innerText") is not None:
        return normalize_text(str(node["innerText"]))
    return normalize_text(" ".join(node_text(child) for child in ordered_children(node.get("children"))))


def extract_props(html_path: Path) -> dict[str, Any]:
    source = html_path.read_text(encoding="utf-8")
    match = TEXT_VIEW_PATTERN.search(source)
    if not match:
        raise ValueError("TextView data was not found")
    return json.loads(html.unescape(match.group(1)))


def extract_passage(props: dict[str, Any]) -> dict[str, Any]:
    excerpt = props.get("excerpt") or {}
    text = excerpt.get("text") or props.get("text") or props.get("lessonTemplate") or {}
    body = excerpt.get("body") or {}
    blocks = []
    for position, node in enumerate(ordered_children(body), start=1):
        value = node_text(node)
        if not value:
            continue
        raw_tag = str(node.get("tag") or "p").lower() if isinstance(node, dict) else "p"
        tag = raw_tag if raw_tag in {"p", "blockquote", "h2", "h3", "li"} else "p"
        blocks.append({"number": position, "tag": tag, "text": value})

    plain_text = " ".join(str(block["text"]) for block in blocks)
    word_count = len(re.findall(r"\b[\w'’-]+\b", plain_text, re.UNICODE))
    title = normalize_text(str(text.get("strippedTitle") or text.get("formattedTitle") or ""))
    return {
        "title": title,
        "subtitle": normalize_text(str(text.get("subtitle") or "")),
        "author": normalize_text(str(text.get("author") or "")),
        "publicationYear": normalize_text(str(text.get("publicationYear") or "")),
        "description": normalize_text(str(text.get("description") or "")),
        "lexile": int(text["lexile"]) if isinstance(text.get("lexile"), (int, float)) else None,
        "category": normalize_text(str(text.get("commonCoreCategory") or "")),
        "slug": normalize_text(str(text.get("slug") or "")),
        "intro": text_from_html(excerpt.get("studentIntroHtml") or props.get("studentIntroHtml")),
        "annotationTask": normalize_text(str(props.get("annotationTask") or "")),
        "permissions": text_from_html(text.get("permissionsLine")),
        "isPoem": bool((excerpt.get("metaData") or {}).get("poem")),
        "wordCount": word_count,
        "blocks": blocks,
    }


def clean_pdf_lines(section: str, headings: set[str]) -> list[str]:
    lines = []
    skip_directions_continuation = False
    for raw in section.replace("\r", "").split("\n"):
        line = normalize_text(raw).rstrip("\\").strip()
        if not line or line in headings or PAGE_NUMBER_PATTERN.fullmatch(line):
            continue
        if line.startswith("Directions:"):
            skip_directions_continuation = True
            continue
        if skip_directions_continuation and (
            line.lower() == "sentences."
            or line.startswith("prepared to share")
            or line.startswith("complete sentences")
        ):
            continue
        skip_directions_continuation = False
        lines.append(line)
    return lines


def parse_questions(section: str, *, discussion: bool) -> list[dict[str, Any]]:
    headings = {"Text-Dependent Questions", "Assessment Questions", "Discussion Questions"}
    lines = clean_pdf_lines(section, headings)
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_option: dict[str, str] | None = None

    def finish() -> None:
        nonlocal current, current_option
        if not current:
            return
        current["prompt"] = normalize_text(" ".join(current.pop("promptParts")))
        for option in current["options"]:
            option["label"] = normalize_text(option["label"])
        current["kind"] = "multiple-choice" if len(current["options"]) >= 2 else "short-answer"
        if current["prompt"]:
            questions.append(current)
        current = None
        current_option = None

    for line in lines:
        question_match = QUESTION_PATTERN.match(line)
        if question_match:
            finish()
            number = int(question_match.group(1))
            current = {
                "id": f"{'discussion' if discussion else 'text'}-{number}",
                "number": number,
                "promptParts": [question_match.group(2)],
                "options": [],
            }
            continue
        if current is None:
            continue
        option_match = None if discussion else OPTION_PATTERN.match(line)
        if option_match:
            expected_option = chr(ord("A") + len(current["options"]))
            if option_match.group(1) != expected_option:
                option_match = None
        if option_match:
            current_option = {
                "id": option_match.group(1).lower(),
                "label": option_match.group(2),
            }
            current["options"].append(current_option)
        elif current_option is not None:
            current_option["label"] += f" {line}"
        else:
            current["promptParts"].append(line)
    finish()
    return questions


def fallback_passage_blocks(page_texts: list[str], title: str) -> list[dict[str, Any]]:
    if not page_texts:
        return []
    cleaned_pages = []
    for page_index, page_text in enumerate(page_texts):
        lines = [line.strip() for line in page_text.replace("\r", "").split("\n")]
        if page_index == 0:
            start = next((index for index, line in enumerate(lines) if re.match(r"^\[1\]\s*", line)), -1)
            lines = lines[start:] if start >= 0 else lines
        kept = []
        for line in lines:
            if not line or PAGE_NUMBER_PATTERN.fullmatch(line):
                continue
            lowered = line.lower()
            if lowered.startswith("unless otherwise noted, this content is licensed"):
                break
            if title and title.lower() in lowered and (
                "copyright" in lowered or "public domain" in lowered or "reprinted by permission" in lowered
            ):
                break
            kept.append(line)
        if kept:
            cleaned_pages.append(" ".join(kept))

    body = " ".join(cleaned_pages)
    chunks = [chunk for chunk in re.split(r"(?=\[\d+\]\s*)", body) if normalize_text(chunk)]
    blocks = []
    last_number = 0
    for chunk in chunks:
        marker = re.match(r"^\[(\d+)\]\s*", chunk)
        if marker:
            number = int(marker.group(1))
            text = chunk[marker.end() :]
            last_number = number
        else:
            number = last_number + 1
            text = chunk
            last_number = number
        text = normalize_text(text)
        if text:
            blocks.append({"number": number, "tag": "p", "text": text})
    return blocks


def extract_pdf_sections(pdf_path: Path, *, include_passage: bool, title: str) -> dict[str, Any]:
    with pdfplumber.open(pdf_path) as document:
        page_count = len(document.pages)
        start = max(0, page_count - 9)
        tail_page_texts = [(page.extract_text() or "") for page in document.pages[start:]]
        tail = "\n".join(tail_page_texts)
        article_page_texts = []
        if include_passage:
            heading_page_offset = next(
                (
                    index
                    for index, value in enumerate(tail_page_texts)
                    if "Text-Dependent Questions" in value or "Assessment Questions" in value
                ),
                len(tail_page_texts),
            )
            article_page_count = min(page_count, start + heading_page_offset)
            article_page_texts = [
                (page.extract_text() or "") for page in document.pages[:article_page_count]
            ]

    text_heading = "Text-Dependent Questions"
    text_start = tail.find(text_heading)
    if text_start < 0:
        text_heading = "Assessment Questions"
        text_start = tail.find(text_heading)
    discussion_heading = "Discussion Questions"
    discussion_start = tail.find(discussion_heading)

    if text_start >= 0:
        text_end = discussion_start if discussion_start > text_start else len(tail)
        text_section = tail[text_start:text_end]
    else:
        text_section = ""
    discussion_section = tail[discussion_start:] if discussion_start >= 0 else ""
    questions = parse_questions(text_section, discussion=False)
    discussion_questions = parse_questions(discussion_section, discussion=True)
    return {
        "pageCount": page_count,
        "questions": questions,
        "discussionQuestions": discussion_questions,
        "foundQuestionHeading": text_start >= 0,
        "foundDiscussionHeading": discussion_start >= 0,
        "fallbackBlocks": fallback_passage_blocks(article_page_texts, title) if include_passage else [],
    }


def extract_job(job: tuple[int, int, str, str, str]) -> dict[str, Any]:
    grade, sequence, html_path_text, pdf_path_text, pdf_relative_path = job
    html_path = Path(html_path_text)
    pdf_path = Path(pdf_path_text)
    props = extract_props(html_path)
    passage = extract_passage(props)
    needs_pdf_passage = not passage["isPoem"] and (
        len(passage["blocks"]) < 8 or int(passage["wordCount"]) < 200
    )
    question_data = extract_pdf_sections(
        pdf_path,
        include_passage=needs_pdf_passage,
        title=str(passage["title"]),
    )
    fallback_blocks = question_data.pop("fallbackBlocks")
    if fallback_blocks:
        passage["blocks"] = fallback_blocks
        passage["wordCount"] = len(
            re.findall(
                r"\b[\w'’-]+\b",
                " ".join(str(block["text"]) for block in fallback_blocks),
                re.UNICODE,
            )
        )
    article_id = f"commonlit-g{grade:02d}-{sequence:03d}"
    return {
        "id": article_id,
        "grade": grade,
        "sequence": sequence,
        **passage,
        **question_data,
        "pdfRelativePath": pdf_relative_path,
        "pdfSizeBytes": pdf_path.stat().st_size,
        "sourceUrl": f"https://www.commonlit.org/texts/{passage['slug']}" if passage["slug"] else "",
    }


def collect_jobs(workspace: Path, pdf_root: Path, selected_grade: int | None) -> list[tuple[int, int, str, str, str]]:
    jobs = []
    for grade in range(3, 13):
        if selected_grade and grade != selected_grade:
            continue
        grade_label = f"Grade_{grade:02d}"
        html_root = (
            workspace / "CommonLit_Grade12" / "articles"
            if grade == 12
            else workspace / "CommonLit_Grades_03-11" / grade_label / "articles"
        )
        for html_path in sorted(html_root.glob("*.html")):
            match = FILE_PATTERN.match(html_path.name)
            if not match:
                raise SystemExit(f"Unexpected CommonLit filename: {html_path}")
            sequence = int(match.group(1))
            pdf_path = pdf_root / grade_label / f"{html_path.stem}.pdf"
            if not pdf_path.is_file():
                raise SystemExit(f"Missing matching PDF: {pdf_path}")
            jobs.append(
                (
                    grade,
                    sequence,
                    str(html_path),
                    str(pdf_path),
                    pdf_path.relative_to(pdf_root).as_posix(),
                )
            )
    return jobs


def main() -> None:
    args = parse_args()
    workspace = args.workspace.resolve()
    pdf_root = args.pdf_root.resolve()
    output_root = args.output_root.resolve()
    jobs = collect_jobs(workspace, pdf_root, args.grade)
    if args.limit > 0:
        jobs = jobs[: args.limit]
    if not jobs:
        raise SystemExit("No CommonLit article jobs found")

    workers = max(1, min(args.workers, 16))
    if workers == 1:
        articles = [extract_job(job) for job in jobs]
    else:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            articles = list(executor.map(extract_job, jobs, chunksize=6))
    articles.sort(key=lambda item: (int(item["grade"]), int(item["sequence"])))

    output_root.mkdir(parents=True, exist_ok=True)
    grade_summaries = []
    index_items = []
    missing_questions = []
    unusual_option_counts = []
    total_pages = 0
    total_questions = 0
    total_discussion = 0

    for grade in sorted({int(article["grade"]) for article in articles}):
        grade_articles = [article for article in articles if int(article["grade"]) == grade]
        expected = list(range(1, len(grade_articles) + 1))
        actual = [int(article["sequence"]) for article in grade_articles]
        if not args.limit and actual != expected:
            raise SystemExit(f"Grade {grade} has a sequence gap")
        (output_root / f"grade-{grade:02d}.json").write_text(
            json.dumps({"schemaVersion": 1, "grade": grade, "articles": grade_articles}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        grade_pages = sum(int(article["pageCount"]) for article in grade_articles)
        grade_questions = sum(len(article["questions"]) for article in grade_articles)
        grade_summaries.append(
            {
                "grade": grade,
                "label": f"Grade {grade}",
                "count": len(grade_articles),
                "pageCount": grade_pages,
                "questionCount": grade_questions,
            }
        )
        for article in grade_articles:
            total_pages += int(article["pageCount"])
            total_questions += len(article["questions"])
            total_discussion += len(article["discussionQuestions"])
            if not article["questions"]:
                missing_questions.append(article["id"])
            for question in article["questions"]:
                if question["kind"] == "multiple-choice" and len(question["options"]) != 4:
                    unusual_option_counts.append(
                        {"articleId": article["id"], "questionId": question["id"], "optionCount": len(question["options"])}
                    )
            index_items.append(
                {
                    "id": article["id"],
                    "grade": grade,
                    "sequence": article["sequence"],
                    "title": article["title"],
                    "author": article["author"],
                    "publicationYear": article["publicationYear"],
                    "description": article["description"],
                    "lexile": article["lexile"],
                    "category": article["category"],
                    "wordCount": article["wordCount"],
                    "pageCount": article["pageCount"],
                    "questionCount": len(article["questions"]),
                    "discussionQuestionCount": len(article["discussionQuestions"]),
                }
            )

    index_document = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "CommonLit",
        "totalCount": len(articles),
        "totalPages": total_pages,
        "totalQuestions": total_questions,
        "totalDiscussionQuestions": total_discussion,
        "grades": grade_summaries,
        "items": index_items,
    }
    (output_root / "index.json").write_text(
        json.dumps(index_document, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    report = {
        "generatedAt": index_document["generatedAt"],
        "articleCount": len(articles),
        "gradeCount": len(grade_summaries),
        "pageCount": total_pages,
        "questionCount": total_questions,
        "discussionQuestionCount": total_discussion,
        "missingQuestionArticles": missing_questions,
        "unusualMultipleChoiceOptionCounts": unusual_option_counts,
    }
    (output_root / "extraction-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Extracted {len(articles)} articles, {total_questions} text-dependent questions, "
        f"and {total_discussion} discussion questions across {len(grade_summaries)} grades."
    )
    print(
        f"Missing question sets: {len(missing_questions)}; "
        f"unusual option counts: {len(unusual_option_counts)}"
    )
    print(output_root)


if __name__ == "__main__":
    main()
