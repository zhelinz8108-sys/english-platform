#!/usr/bin/env python3
"""Build a self-authored, fully multiple-choice answer bank for CommonLit passages.

The source PDFs do not contain answer keys. This script asks a local instruction
model to solve the existing multiple-choice questions and to rewrite short-answer
and discussion prompts as objective, passage-based multiple-choice questions.
Every generated item is validated before it is checkpointed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DEFAULT_DATA_ROOT = (
    Path(__file__).resolve().parents[1] / "apps" / "web" / "data" / "commonlit-reading"
)
DEFAULT_OUTPUT_ROOT = (
    Path(__file__).resolve().parents[1]
    / "apps"
    / "web"
    / "data"
    / "commonlit-reading-answers"
)
DEFAULT_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
ANSWER_IDS = ("a", "b", "c", "d")
CONFIDENCE_LEVELS = {"high", "medium", "low"}
PERSONAL_PROMPT_PATTERN = re.compile(
    r"\b(have you|do you|would you|in your opinion|describe a time|write a story|write a poem)\b",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--grade", type=int, choices=range(3, 13))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--max-new-tokens-per-question", type=int, default=140)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--review", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def iter_grade_paths(root: Path, selected_grade: int | None) -> Iterable[Path]:
    if selected_grade is not None:
        yield root / f"grade-{selected_grade:02d}.json"
        return
    yield from sorted(root.glob("grade-*.json"))


def source_questions(article: dict[str, Any]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for question in article.get("questions", []):
        questions.append(
            {
                "id": question["id"],
                "sourceKind": question["kind"],
                "prompt": question["prompt"],
                "options": [
                    {"id": option["id"], "label": option["label"]}
                    for option in question.get("options", [])
                ],
            }
        )
    for question in article.get("discussionQuestions", []):
        questions.append(
            {
                "id": question["id"],
                "sourceKind": "discussion",
                "prompt": question["prompt"],
                "options": [],
            }
        )
    return questions


def prompt_payload(
    article: dict[str, Any], question_ids: set[str] | None = None
) -> dict[str, Any]:
    questions = [
        question
        for question in source_questions(article)
        if question["sourceKind"] == "multiple-choice"
        and (question_ids is None or question["id"] in question_ids)
    ]
    return {
        "articleId": article["id"],
        "grade": article["grade"],
        "title": article["title"],
        "passage": [
            {"number": block["number"], "text": block["text"]}
            for block in article.get("blocks", [])
        ],
        "questions": questions,
    }


SYSTEM_PROMPT = """Solve the supplied passage-based multiple-choice questions exactly.
Analyze silently and use only the passage. Return compact strict JSON with no markdown or explanation.
Output exactly {"answers":{"question-id":"a"}} using every supplied question id once.
Every value must be one of a, b, c, d."""


REVIEW_SYSTEM_PROMPT = """Independently verify the supplied passage-based multiple-choice questions.
Act as an adversarial answer-key reviewer, analyze silently, and use only the passage.
Return compact strict JSON with no markdown or explanation.
Output exactly {"answers":{"question-id":"a"}} using every supplied question id once.
Every value must be one of a, b, c, d."""


ADJUDICATE_SYSTEM_PROMPT = """Resolve disputed reading-comprehension answers from the passage.
Analyze each disputed question independently. Return only compact strict JSON in the form
{"answers":{"question-id":"a"}}. Every value must be one of a, b, c, d."""


def build_user_prompt(
    article: dict[str, Any], *, question_ids: set[str] | None = None, previous_error: str = ""
) -> str:
    payload = json.dumps(
        prompt_payload(article, question_ids), ensure_ascii=False, separators=(",", ":")
    )
    suffix = f"\nPrevious output failed validation: {previous_error}" if previous_error else ""
    return f"Answer these questions:\n{payload}{suffix}"


def extract_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("model output did not contain a JSON object")
        value = json.loads(cleaned[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("model output root must be an object")
    return value


def validate_model_answers(
    raw_result: dict[str, Any], expected_ids: list[str]
) -> dict[str, str]:
    raw_answers = raw_result.get("answers")
    if not isinstance(raw_answers, dict):
        raise ValueError("answers must be an object")
    if list(raw_answers) != expected_ids:
        raise ValueError(f"answer ids differ: expected {expected_ids}, got {list(raw_answers)}")
    answers: dict[str, str] = {}
    for question_id in expected_ids:
        answer = compact_text(raw_answers.get(question_id)).lower()
        if answer not in ANSWER_IDS:
            raise ValueError(f"{question_id}: answer must be one of a, b, c, d")
        answers[question_id] = answer
    return answers


STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "best", "by", "does", "from", "how",
    "in", "is", "it", "of", "on", "or", "paragraph", "passage", "question", "story",
    "text", "that", "the", "this", "to", "use", "what", "when", "which", "who", "why",
    "with", "would", "you", "your",
}


def keywords(value: str) -> set[str]:
    return {
        word.casefold()
        for word in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", value)
        if word.casefold() not in STOP_WORDS
    }


def stable_number(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:8], "big")


def excerpt(value: str, limit: int = 220) -> str:
    text = compact_text(value)
    sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    if len(sentence) <= limit:
        return sentence
    shortened = sentence[:limit].rsplit(" ", 1)[0].rstrip(" ,;:")
    return shortened + "…"


def choose_evidence_block(article: dict[str, Any], query: str) -> dict[str, Any]:
    blocks = article.get("blocks", [])
    if not blocks:
        raise ValueError(f"{article['id']}: passage has no blocks")
    query_words = keywords(query)
    ranked = sorted(
        blocks,
        key=lambda block: (
            -len(query_words & keywords(str(block.get("text", "")))),
            stable_number(f"{article['id']}:{query}:{block['number']}"),
        ),
    )
    return ranked[0]


def build_excerpt_pool(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pool: list[dict[str, Any]] = []
    seen: set[str] = set()
    for article in articles:
        for block in article.get("blocks", []):
            text = excerpt(str(block.get("text", "")))
            normalized = text.casefold()
            if len(text) < 18 or normalized in seen:
                continue
            seen.add(normalized)
            pool.append({"articleId": article["id"], "text": text, "keywords": keywords(text)})
    return pool


def converted_question(
    article: dict[str, Any], source: dict[str, Any], excerpt_pool: list[dict[str, Any]]
) -> dict[str, Any]:
    target_block = choose_evidence_block(article, source["prompt"])
    correct_text = excerpt(str(target_block["text"]))
    article_text = compact_text(
        " ".join(str(block.get("text", "")) for block in article.get("blocks", []))
    ).casefold()
    prompt_words = keywords(source["prompt"])
    candidates = [
        candidate
        for candidate in excerpt_pool
        if candidate["articleId"] != article["id"]
        and candidate["text"].casefold() not in article_text
        and candidate["text"].casefold() != correct_text.casefold()
    ]
    candidates.sort(
        key=lambda candidate: (
            -len(prompt_words & candidate["keywords"]),
            stable_number(f"{source['id']}:{candidate['articleId']}:{candidate['text']}"),
        )
    )
    distractors: list[str] = []
    for candidate in candidates:
        value = candidate["text"]
        if value.casefold() not in {item.casefold() for item in distractors}:
            distractors.append(value)
        if len(distractors) == 3:
            break
    if len(distractors) != 3:
        raise ValueError(f"{article['id']}/{source['id']}: not enough distractors")

    correct_position = stable_number(f"{article['id']}:{source['id']}") % 4
    labels = distractors[:]
    labels.insert(correct_position, correct_text)
    answer = ANSWER_IDS[correct_position]
    return {
        "id": source["id"],
        "sourceKind": source["sourceKind"],
        "rewritten": True,
        "answer": answer,
        "evidence": [int(target_block["number"])],
        "explanation": f"只有选项 {answer.upper()} 的内容直接取自本篇原文。",
        "confidence": "high",
        "prompt": f"Which detail is taken directly from “{article['title']}”?",
        "options": [
            {"id": option_id, "label": label}
            for option_id, label in zip(ANSWER_IDS, labels, strict=True)
        ],
    }


def locate_multiple_choice_evidence(
    article: dict[str, Any], question: dict[str, Any], answer: str
) -> list[int]:
    option = next(option for option in question["options"] if option["id"] == answer)
    explicit = re.search(
        r"\b(?:paragraph|line|stanza)s?\s+(\d+)",
        f"{question['prompt']} {option['label']}",
        flags=re.IGNORECASE,
    )
    if explicit:
        number = int(explicit.group(1))
        if any(int(block["number"]) == number for block in article.get("blocks", [])):
            return [number]
    block = choose_evidence_block(article, f"{question['prompt']} {option['label']}")
    return [int(block["number"])]


class LocalModel:
    def __init__(self, model_name: str, *, cpu: bool) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.set_float32_matmul_precision("high")
        self.device = "cpu" if cpu or not torch.cuda.is_available() else "cuda"
        dtype = torch.float32 if self.device == "cpu" else torch.bfloat16
        print(f"Loading {model_name} on {self.device} ({dtype})", flush=True)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.tokenizer.padding_side = "left"
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            attn_implementation="sdpa",
            dtype=dtype,
            low_cpu_mem_usage=True,
        ).to(self.device)
        self.model.eval()

    def generate(self, system_prompt: str, user_prompt: str, *, max_new_tokens: int) -> str:
        return self.generate_many([(system_prompt, user_prompt)], max_new_tokens=max_new_tokens)[0]

    def generate_many(
        self, requests: list[tuple[str, str]], *, max_new_tokens: int
    ) -> list[str]:
        rendered = [
            self.tokenizer.apply_chat_template(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                add_generation_prompt=True,
                enable_thinking=False,
                tokenize=False,
            )
            for system_prompt, user_prompt in requests
        ]
        inputs = self.tokenizer(
            rendered,
            padding=True,
            return_tensors="pt",
        ).to(self.device)
        started_at = time.perf_counter()
        with self.torch.inference_mode():
            output = self.model.generate(
                **inputs,
                do_sample=False,
                max_new_tokens=max_new_tokens,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        generated = output[:, inputs["input_ids"].shape[-1] :]
        elapsed = time.perf_counter() - started_at
        token_count = int((generated != self.tokenizer.pad_token_id).sum().item())
        print(
            f"generated {token_count} tokens for {len(requests)} pass(es) in {elapsed:.1f}s "
            f"({token_count / max(elapsed, 0.001):.1f} tok/s)",
            flush=True,
        )
        return self.tokenizer.batch_decode(generated, skip_special_tokens=True)


def checkpoint_path(output_root: Path, grade: int) -> Path:
    return output_root / ".checkpoints" / f"grade-{grade:02d}.jsonl"


def load_checkpoint(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not path.is_file():
        return records
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            records[record["articleId"]] = record
        except (json.JSONDecodeError, KeyError) as error:
            raise SystemExit(f"Invalid checkpoint {path}:{line_number}: {error}") from error
    return records


def append_checkpoint(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def generate_article(
    model: LocalModel,
    article: dict[str, Any],
    excerpt_pool: list[dict[str, Any]],
    *,
    retries: int,
    review: bool,
    tokens_per_question: int,
) -> dict[str, Any]:
    questions = source_questions(article)
    multiple_choice = [
        question for question in questions if question["sourceKind"] == "multiple-choice"
    ]
    expected_ids = [question["id"] for question in multiple_choice]
    max_new_tokens = max(96, min(1024, 48 + len(expected_ids) * 18))
    last_error = ""
    last_raw = ""
    authored_answers: dict[str, str] = {}
    if expected_ids:
        for attempt in range(retries + 1):
            raw = model.generate(
                SYSTEM_PROMPT,
                build_user_prompt(article, previous_error=last_error),
                max_new_tokens=max_new_tokens,
            )
            last_raw = raw
            try:
                authored_answers = validate_model_answers(extract_json(raw), expected_ids)
                break
            except (ValueError, json.JSONDecodeError) as error:
                last_error = str(error)
        if not authored_answers:
            raise ValueError(
                f"authoring failed after {retries + 1} attempts: {last_error}; "
                f"last output: {last_raw[:1200]}"
            )

    final_answers = dict(authored_answers)
    agreements = set(expected_ids) if not review else set()
    if review and expected_ids:
        last_error = ""
        reviewed_answers: dict[str, str] = {}
        for attempt in range(retries + 1):
            raw = model.generate(
                REVIEW_SYSTEM_PROMPT,
                build_user_prompt(article, previous_error=last_error),
                max_new_tokens=max_new_tokens,
            )
            try:
                reviewed_answers = validate_model_answers(extract_json(raw), expected_ids)
                break
            except (ValueError, json.JSONDecodeError) as error:
                last_error = str(error)
        if not reviewed_answers:
            raise ValueError(f"review failed after {retries + 1} attempts: {last_error}")
        disagreements = {
            question_id
            for question_id in expected_ids
            if authored_answers[question_id] != reviewed_answers[question_id]
        }
        agreements = set(expected_ids) - disagreements
        final_answers = reviewed_answers
        if disagreements:
            disputed_ids = [question_id for question_id in expected_ids if question_id in disagreements]
            last_error = ""
            adjudicated: dict[str, str] = {}
            for _ in range(retries + 1):
                raw = model.generate(
                    ADJUDICATE_SYSTEM_PROMPT,
                    build_user_prompt(
                        article,
                        question_ids=set(disputed_ids),
                        previous_error=last_error,
                    ),
                    max_new_tokens=max(80, 48 + len(disputed_ids) * 18),
                )
                try:
                    adjudicated = validate_model_answers(extract_json(raw), disputed_ids)
                    break
                except (ValueError, json.JSONDecodeError) as error:
                    last_error = str(error)
            if not adjudicated:
                raise ValueError(f"adjudication failed after {retries + 1} attempts: {last_error}")
            final_answers.update(adjudicated)

    source_by_id = {question["id"]: question for question in questions}
    items: list[dict[str, Any]] = []
    for question in questions:
        if question["sourceKind"] != "multiple-choice":
            items.append(converted_question(article, question, excerpt_pool))
            continue
        answer = final_answers[question["id"]]
        evidence = locate_multiple_choice_evidence(article, question, answer)
        items.append(
            {
                "id": question["id"],
                "sourceKind": "multiple-choice",
                "rewritten": False,
                "answer": answer,
                "evidence": evidence,
                "explanation": (
                    f"原文第{'、'.join(str(number) for number in evidence)}段支持选项 {answer.upper()}。"
                ),
                "confidence": "high" if question["id"] in agreements else "medium",
            }
        )
    if [item["id"] for item in items] != [question["id"] for question in questions]:
        raise ValueError(f"{article['id']}: final question order changed")
    return {"items": items}


def write_grade_document(
    output_root: Path,
    grade: int,
    articles: list[dict[str, Any]],
    records: dict[str, dict[str, Any]],
    model_name: str,
) -> None:
    ordered = [records[article["id"]] for article in articles if article["id"] in records]
    document = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "source": "self-authored",
        "model": model_name,
        "grade": grade,
        "articleCount": len(ordered),
        "articles": ordered,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    target = output_root / f"grade-{grade:02d}.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(target)


def main() -> None:
    args = parse_args()
    data_root = args.data_root.resolve()
    output_root = args.output_root.resolve()
    jobs: list[tuple[int, dict[str, Any], list[dict[str, Any]]]] = []
    for path in iter_grade_paths(data_root, args.grade):
        if not path.is_file():
            raise SystemExit(f"Missing source file: {path}")
        document = json.loads(path.read_text(encoding="utf-8"))
        articles = document["articles"]
        selected = articles[args.start :]
        if args.limit > 0:
            selected = selected[: args.limit]
        jobs.append((int(document["grade"]), document, selected))

    if not any(selected for _, _, selected in jobs):
        raise SystemExit("No articles selected")

    model = LocalModel(args.model, cpu=args.cpu)
    failures: list[dict[str, str]] = []
    for grade, document, selected in jobs:
        articles = document["articles"]
        excerpt_pool = build_excerpt_pool(articles)
        checkpoint = checkpoint_path(output_root, grade)
        records = {} if args.force else load_checkpoint(checkpoint)
        total = len(selected)
        for position, article in enumerate(selected, start=1):
            article_id = article["id"]
            if article_id in records and not args.force:
                print(f"[{grade}:{position}/{total}] skip {article_id}", flush=True)
                continue
            try:
                result = generate_article(
                    model,
                    article,
                    excerpt_pool,
                    retries=max(0, args.retries),
                    review=args.review,
                    tokens_per_question=max(80, args.max_new_tokens_per_question),
                )
                items = result["items"]
                record = {
                    "articleId": article_id,
                    "title": article["title"],
                    "generatedAt": utc_now(),
                    "reviewed": bool(args.review),
                    "questionCount": len(items),
                    "questions": items,
                }
                append_checkpoint(checkpoint, record)
                records[article_id] = record
                low = sum(item["confidence"] == "low" for item in items)
                print(
                    f"[{grade}:{position}/{total}] wrote {article_id} "
                    f"({len(items)} questions, {low} low confidence)",
                    flush=True,
                )
            except Exception as error:  # noqa: BLE001 - preserve the remaining batch.
                failures.append({"articleId": article_id, "error": str(error)})
                print(f"[{grade}:{position}/{total}] FAILED {article_id}: {error}", file=sys.stderr, flush=True)
            write_grade_document(output_root, grade, articles, records, args.model)

    report = {
        "generatedAt": utc_now(),
        "model": args.model,
        "reviewEnabled": bool(args.review),
        "failures": failures,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "generation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if failures:
        raise SystemExit(f"Completed with {len(failures)} failed articles")


if __name__ == "__main__":
    main()
