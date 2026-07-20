#!/usr/bin/env python3
"""Validate TOEFL Academic Listening author/reconciled question-bank JSON."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from question_bank_common import (
    DIFFICULTY_LEVELS,
    HIGHER_ORDER_TYPES,
    OPTION_IDS,
    QUESTION_TYPES,
    SCHEMA_VERSION,
    SKILL_VERSION,
    STATUSES,
    bank_sets,
    compact_text,
    exact_simulation_for,
    label_for,
    load_library,
    normalized_text,
    profile_for,
    read_json,
    source_hash,
    transcript_region,
)


CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]")
HEX_64_PATTERN = re.compile(r"^[0-9a-f]{64}$")
LEAK_MARKERS = re.compile(r"(?:correct\s*answer|answer\s*is|\[answer\]|✓|✔)", re.IGNORECASE)
PRIVATE_KEYS = {"answer", "evidence", "explanationZh", "optionRationalesZh"}


@dataclass(frozen=True)
class Issue:
    severity: str
    path: str
    message: str


def add(issues: list[Issue], severity: str, path: str, message: str) -> None:
    issues.append(Issue(severity, path, message))


def has_chinese(value: Any) -> bool:
    return bool(CHINESE_PATTERN.search(str(value or "")))


def validate_private_block(
    value: Any,
    *,
    transcript: str,
    path: str,
    issues: list[Issue],
) -> set[str]:
    regions: set[str] = set()
    if not isinstance(value, dict):
        add(issues, "error", path, "private must be an object")
        return regions
    answer = compact_text(value.get("answer")).lower()
    if answer not in OPTION_IDS:
        add(issues, "error", f"{path}.answer", "answer must be one of a, b, c, d")
    explanation = compact_text(value.get("explanationZh"))
    if not explanation or not has_chinese(explanation):
        add(issues, "error", f"{path}.explanationZh", "Chinese explanation is required")
    rationales = value.get("optionRationalesZh")
    if not isinstance(rationales, dict) or set(rationales) != set(OPTION_IDS):
        add(
            issues,
            "error",
            f"{path}.optionRationalesZh",
            "option rationales must contain exactly a, b, c, and d",
        )
    else:
        for option_id in OPTION_IDS:
            rationale = compact_text(rationales.get(option_id))
            if not rationale or not has_chinese(rationale):
                add(
                    issues,
                    "error",
                    f"{path}.optionRationalesZh.{option_id}",
                    "A Chinese rationale is required",
                )
    evidence = value.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        add(issues, "error", f"{path}.evidence", "At least one evidence span is required")
        return regions
    for index, span in enumerate(evidence):
        span_path = f"{path}.evidence[{index}]"
        if not isinstance(span, dict):
            add(issues, "error", span_path, "Evidence span must be an object")
            continue
        start = span.get("start")
        end = span.get("end")
        quote = span.get("quote")
        if not isinstance(start, int) or not isinstance(end, int):
            add(issues, "error", span_path, "Evidence start and end must be integers")
            continue
        if start < 0 or end <= start or end > len(transcript):
            add(issues, "error", span_path, "Evidence offsets are outside the transcript")
            continue
        if not isinstance(quote, str) or transcript[start:end] != quote:
            add(issues, "error", f"{span_path}.quote", "Quote does not match transcript offsets")
            continue
        if len(quote.strip()) < 12:
            add(issues, "warning", f"{span_path}.quote", "Evidence quote may be too short")
        if len(quote) > 600:
            add(issues, "warning", f"{span_path}.quote", "Evidence quote may be broader than needed")
        regions.add(transcript_region(start, len(transcript)))
    return regions


def validate_bank(
    sources: dict[str, dict[str, Any]],
    bank: dict[str, Any],
) -> list[Issue]:
    issues: list[Issue] = []
    if bank.get("schemaVersion") != SCHEMA_VERSION:
        add(issues, "error", "schemaVersion", f"Must equal {SCHEMA_VERSION}")
    if bank.get("skillVersion") != SKILL_VERSION:
        add(issues, "error", "skillVersion", f"Must equal {SKILL_VERSION}")
    try:
        sets = bank_sets(bank)
    except SystemExit as error:
        add(issues, "error", "sets", str(error))
        return issues
    seen_sources: set[str] = set()
    seen_question_ids: set[str] = set()
    prompt_owners: dict[str, str] = {}
    answers: list[str] = []
    for set_index, question_set in enumerate(sets):
        set_path = f"sets[{set_index}]"
        source_id = compact_text(question_set.get("sourceId"))
        if not source_id:
            add(issues, "error", f"{set_path}.sourceId", "sourceId is required")
            continue
        if source_id in seen_sources:
            add(issues, "error", f"{set_path}.sourceId", "Duplicate sourceId")
        seen_sources.add(source_id)
        source = sources.get(source_id)
        if source is None:
            add(issues, "error", f"{set_path}.sourceId", "Source is missing from listening library")
            continue
        collection = compact_text(question_set.get("collection"))
        expected_collection = compact_text(source.get("collection"))
        if collection != expected_collection:
            add(issues, "error", f"{set_path}.collection", "Collection differs from source")
        if question_set.get("profile") != profile_for(expected_collection):
            add(issues, "error", f"{set_path}.profile", "Profile does not match collection")
        if question_set.get("label") != label_for(expected_collection):
            add(issues, "error", f"{set_path}.label", "Practice label does not match collection")
        if question_set.get("exactSimulation") is not exact_simulation_for(expected_collection):
            add(
                issues,
                "error",
                f"{set_path}.exactSimulation",
                "exactSimulation does not match the source profile",
            )
        expected_hash = source_hash(source)
        actual_hash = compact_text(question_set.get("sourceHash"))
        if not HEX_64_PATTERN.fullmatch(actual_hash):
            add(issues, "error", f"{set_path}.sourceHash", "sourceHash must be lowercase SHA-256")
        if actual_hash != expected_hash:
            add(issues, "error", f"{set_path}.sourceHash", "Source hash is stale or incorrect")
        status = compact_text(question_set.get("status"))
        if status not in STATUSES:
            add(issues, "error", f"{set_path}.status", "Unsupported status")
        if status == "approved":
            approval = question_set.get("humanApproval")
            if not isinstance(approval, dict) or not compact_text(approval.get("approvedBy")) or not compact_text(approval.get("approvedAt")):
                add(
                    issues,
                    "error",
                    f"{set_path}.humanApproval",
                    "approved requires named human approval and timestamp",
                )
        audio_difficulty = question_set.get("audioDifficulty")
        if not isinstance(audio_difficulty, dict):
            add(issues, "error", f"{set_path}.audioDifficulty", "audioDifficulty must be an object")
        else:
            if audio_difficulty.get("level") not in DIFFICULTY_LEVELS:
                add(issues, "error", f"{set_path}.audioDifficulty.level", "Unsupported difficulty")
            if audio_difficulty.get("basis") != "provisional-content-analysis":
                add(
                    issues,
                    "error",
                    f"{set_path}.audioDifficulty.basis",
                    "Difficulty basis must remain explicitly provisional",
                )
        questions = question_set.get("questions")
        if not isinstance(questions, list):
            add(issues, "error", f"{set_path}.questions", "questions must be an array")
            continue
        if len(questions) != 4:
            add(issues, "error", f"{set_path}.questions", "Each set must contain exactly four questions")
        type_counts: Counter[str] = Counter()
        set_regions: set[str] = set()
        set_prompts: list[tuple[str, str]] = []
        transcript = str(source.get("transcript") or "")
        for question_index, question in enumerate(questions):
            question_path = f"{set_path}.questions[{question_index}]"
            if not isinstance(question, dict):
                add(issues, "error", question_path, "Question must be an object")
                continue
            position = question.get("position")
            if position != question_index + 1:
                add(issues, "error", f"{question_path}.position", "Positions must be consecutive 1-4")
            question_id = compact_text(question.get("id"))
            expected_id = f"{source_id}-q{question_index + 1:02d}"
            if question_id != expected_id:
                add(issues, "error", f"{question_path}.id", f"Expected {expected_id}")
            if question_id in seen_question_ids:
                add(issues, "error", f"{question_path}.id", "Duplicate question id")
            seen_question_ids.add(question_id)
            question_type = compact_text(question.get("type"))
            if question_type not in QUESTION_TYPES:
                add(issues, "error", f"{question_path}.type", "Unsupported question type")
            else:
                type_counts[question_type] += 1
            if question.get("difficulty") not in DIFFICULTY_LEVELS:
                add(issues, "error", f"{question_path}.difficulty", "Unsupported difficulty")
            public = question.get("public")
            if not isinstance(public, dict):
                add(issues, "error", f"{question_path}.public", "public must be an object")
                continue
            leaked_keys = PRIVATE_KEYS.intersection(public)
            if leaked_keys:
                add(
                    issues,
                    "error",
                    f"{question_path}.public",
                    f"Private keys leaked into public: {', '.join(sorted(leaked_keys))}",
                )
            public_text = json.dumps(public, ensure_ascii=False)
            if LEAK_MARKERS.search(public_text):
                add(issues, "error", f"{question_path}.public", "Public text contains an answer marker")
            prompt = compact_text(public.get("prompt"))
            if not prompt or not prompt.endswith("?"):
                add(issues, "error", f"{question_path}.public.prompt", "Prompt must be a question")
            normalized_prompt = normalized_text(prompt)
            if normalized_prompt in prompt_owners:
                add(
                    issues,
                    "warning",
                    f"{question_path}.public.prompt",
                    f"Exact prompt also used by {prompt_owners[normalized_prompt]}",
                )
            else:
                prompt_owners[normalized_prompt] = question_id
            for previous_id, previous_prompt in set_prompts:
                similarity = SequenceMatcher(None, normalized_prompt, previous_prompt).ratio()
                if similarity > 0.92:
                    add(
                        issues,
                        "warning",
                        f"{question_path}.public.prompt",
                        f"Question is very similar to {previous_id}",
                    )
            set_prompts.append((question_id, normalized_prompt))
            options = public.get("options")
            if not isinstance(options, list) or len(options) != 4:
                add(issues, "error", f"{question_path}.public.options", "Exactly four options are required")
            else:
                option_ids = [compact_text(option.get("id")).lower() if isinstance(option, dict) else "" for option in options]
                if option_ids != list(OPTION_IDS):
                    add(issues, "error", f"{question_path}.public.options", "Option ids must be ordered a-d")
                option_texts = [compact_text(option.get("text")) if isinstance(option, dict) else "" for option in options]
                if any(not text for text in option_texts):
                    add(issues, "error", f"{question_path}.public.options", "Option text cannot be empty")
                normalized_options = [normalized_text(text) for text in option_texts]
                if len(set(normalized_options)) != 4:
                    add(issues, "error", f"{question_path}.public.options", "Option texts must be unique")
                lengths = sorted(len(text) for text in option_texts if text)
                if len(lengths) == 4 and lengths[-1] > max(lengths[1] * 2.5, lengths[1] + 35):
                    add(
                        issues,
                        "warning",
                        f"{question_path}.public.options",
                        "One option is much longer than the others",
                    )
            private = question.get("private")
            set_regions.update(
                validate_private_block(
                    private,
                    transcript=transcript,
                    path=f"{question_path}.private",
                    issues=issues,
                )
            )
            if isinstance(private, dict):
                answer = compact_text(private.get("answer")).lower()
                if answer in OPTION_IDS:
                    answers.append(answer)
        if type_counts["detail"] > 2:
            add(issues, "error", f"{set_path}.questions", "A set may contain at most two detail questions")
        if not HIGHER_ORDER_TYPES.intersection(type_counts):
            add(issues, "error", f"{set_path}.questions", "A set needs at least one higher-order question")
        expected_regions = {"beginning", "middle", "end"}
        if not expected_regions.issubset(set_regions):
            missing = ", ".join(sorted(expected_regions - set_regions))
            add(
                issues,
                "error",
                f"{set_path}.questions",
                f"Evidence does not cover all transcript regions; missing: {missing}",
            )
    if len(answers) >= 8:
        counts = Counter(answers)
        option, count = counts.most_common(1)[0]
        if count / len(answers) > 0.5:
            add(
                issues,
                "warning",
                "sets",
                f"Answer key is imbalanced: {option} appears {count}/{len(answers)} times",
            )
    return issues


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--warnings-as-errors", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    _, items = load_library(args.library.resolve())
    sources = {item["id"]: item for item in items}
    bank = read_json(args.input.resolve())
    issues = validate_bank(sources, bank)
    errors = [issue for issue in issues if issue.severity == "error"]
    warnings = [issue for issue in issues if issue.severity == "warning"]
    for issue in issues:
        print(f"{issue.severity.upper()} {issue.path}: {issue.message}")
    print(
        f"Validated {len(bank.get('sets', []))} set(s): {len(errors)} error(s), "
        f"{len(warnings)} warning(s)",
        flush=True,
    )
    if errors or (warnings and args.warnings_as_errors):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
