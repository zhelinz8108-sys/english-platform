#!/usr/bin/env python3
"""Reconcile blind-review or adjudication results without silently changing answers."""

from __future__ import annotations

import argparse
import copy
from pathlib import Path
from typing import Any

from question_bank_common import (
    OPTION_IDS,
    SCHEMA_VERSION,
    SKILL_VERSION,
    bank_by_source,
    bank_sets,
    compact_text,
    read_json,
    utc_now,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--author", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--review", type=Path)
    group.add_argument("--adjudication", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def result_by_source(document: dict[str, Any], expected_mode: str) -> dict[str, dict[str, Any]]:
    if document.get("schemaVersion") != SCHEMA_VERSION:
        raise SystemExit(f"Result schemaVersion must equal {SCHEMA_VERSION}")
    if document.get("mode") != expected_mode:
        raise SystemExit(f"Expected mode {expected_mode!r}, got {document.get('mode')!r}")
    reviews = document.get("reviews")
    if not isinstance(reviews, list):
        raise SystemExit("Result document must contain a reviews array")
    result: dict[str, dict[str, Any]] = {}
    for review in reviews:
        if not isinstance(review, dict):
            raise SystemExit("Every result entry must be an object")
        source_id = compact_text(review.get("sourceId"))
        if not source_id or source_id in result:
            raise SystemExit(f"Missing or duplicate result sourceId: {source_id!r}")
        result[source_id] = review
    return result


def answer_map(review: dict[str, Any]) -> dict[str, dict[str, Any]]:
    answers = review.get("answers")
    if not isinstance(answers, list):
        raise SystemExit(f"Review for {review.get('sourceId')} must contain an answers array")
    result: dict[str, dict[str, Any]] = {}
    for answer in answers:
        if not isinstance(answer, dict):
            raise SystemExit("Every review answer must be an object")
        question_id = compact_text(answer.get("questionId"))
        if not question_id or question_id in result:
            raise SystemExit(f"Missing or duplicate review questionId: {question_id!r}")
        option = compact_text(answer.get("answer")).lower()
        if option not in OPTION_IDS:
            raise SystemExit(f"{question_id}: answer must be one of a, b, c, d")
        if not isinstance(answer.get("ambiguous"), bool):
            raise SystemExit(f"{question_id}: ambiguous must be true or false")
        if not compact_text(answer.get("reasonZh")):
            raise SystemExit(f"{question_id}: reasonZh is required")
        result[question_id] = answer
    return result


def author_questions(question_set: dict[str, Any]) -> dict[str, dict[str, Any]]:
    questions = question_set.get("questions")
    if not isinstance(questions, list):
        raise SystemExit(f"Question set {question_set.get('sourceId')} has no questions array")
    result: dict[str, dict[str, Any]] = {}
    for question in questions:
        if not isinstance(question, dict):
            raise SystemExit("Every author question must be an object")
        question_id = compact_text(question.get("id"))
        if not question_id or question_id in result:
            raise SystemExit(f"Missing or duplicate author question id: {question_id!r}")
        private = question.get("private")
        if not isinstance(private, dict) or compact_text(private.get("answer")).lower() not in OPTION_IDS:
            raise SystemExit(f"Author question has no valid private answer: {question_id}")
        result[question_id] = question
    return result


def reconcile_review(bank: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    result_sets = result_by_source(result, "review-result")
    author_sets = bank_by_source(bank)
    unknown = sorted(set(result_sets) - set(author_sets))
    if unknown:
        raise SystemExit(f"Review contains unknown source ids: {', '.join(unknown)}")
    for source_id, review in result_sets.items():
        question_set = author_sets[source_id]
        if question_set.get("status") != "draft":
            raise SystemExit(f"Blind review requires draft status: {source_id}")
        if review.get("sourceHash") != question_set.get("sourceHash"):
            raise SystemExit(f"Review source hash differs for {source_id}")
        questions = author_questions(question_set)
        reviewed = answer_map(review)
        if set(reviewed) != set(questions):
            missing = sorted(set(questions) - set(reviewed))
            extra = sorted(set(reviewed) - set(questions))
            raise SystemExit(
                f"Review question ids differ for {source_id}; missing={missing}, extra={extra}"
            )
        disagreements: list[str] = []
        ambiguous: list[str] = []
        for question_id, review_answer in reviewed.items():
            author_answer = compact_text(questions[question_id]["private"].get("answer")).lower()
            if review_answer["ambiguous"]:
                ambiguous.append(question_id)
            if review_answer["ambiguous"] or review_answer["answer"] != author_answer:
                disagreements.append(question_id)
        question_set["review"] = {
            "reviewedAt": utc_now(),
            "reviewAnswers": {
                question_id: reviewed[question_id]["answer"] for question_id in questions
            },
            "reasonsZh": {
                question_id: reviewed[question_id]["reasonZh"] for question_id in questions
            },
            "ambiguousQuestionIds": ambiguous,
            "disagreements": disagreements,
        }
        question_set["status"] = "needs_adjudication" if disagreements else "reviewed"
    return bank


def complete_adjudication(answer: dict[str, Any], question_id: str) -> dict[str, Any]:
    if answer.get("ambiguous") is not False:
        raise SystemExit(f"{question_id}: adjudication must resolve ambiguity")
    evidence = answer.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise SystemExit(f"{question_id}: adjudication evidence is required")
    for span in evidence:
        if not isinstance(span, dict) or not isinstance(span.get("start"), int) or not isinstance(span.get("end"), int) or not isinstance(span.get("quote"), str):
            raise SystemExit(f"{question_id}: every adjudication evidence span needs start, end, and quote")
    explanation = compact_text(answer.get("explanationZh"))
    rationales = answer.get("optionRationalesZh")
    if not explanation:
        raise SystemExit(f"{question_id}: adjudication explanationZh is required")
    if not isinstance(rationales, dict) or set(rationales) != set(OPTION_IDS):
        raise SystemExit(f"{question_id}: adjudication needs four optionRationalesZh")
    if any(not compact_text(rationales.get(option_id)) for option_id in OPTION_IDS):
        raise SystemExit(f"{question_id}: adjudication option rationales cannot be empty")
    return {
        "answer": compact_text(answer.get("answer")).lower(),
        "evidence": copy.deepcopy(evidence),
        "explanationZh": explanation,
        "optionRationalesZh": copy.deepcopy(rationales),
    }


def reconcile_adjudication(bank: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    result_sets = result_by_source(result, "adjudication-result")
    author_sets = bank_by_source(bank)
    unknown = sorted(set(result_sets) - set(author_sets))
    if unknown:
        raise SystemExit(f"Adjudication contains unknown source ids: {', '.join(unknown)}")
    for source_id, adjudication in result_sets.items():
        question_set = author_sets[source_id]
        if question_set.get("status") != "needs_adjudication":
            raise SystemExit(f"Adjudication requires needs_adjudication status: {source_id}")
        if adjudication.get("sourceHash") != question_set.get("sourceHash"):
            raise SystemExit(f"Adjudication source hash differs for {source_id}")
        review = question_set.get("review")
        disputes = review.get("disagreements") if isinstance(review, dict) else None
        if not isinstance(disputes, list) or not disputes:
            raise SystemExit(f"No recorded disputes for {source_id}")
        questions = author_questions(question_set)
        resolved = answer_map(adjudication)
        if set(resolved) != set(disputes):
            missing = sorted(set(disputes) - set(resolved))
            extra = sorted(set(resolved) - set(disputes))
            raise SystemExit(
                f"Adjudication question ids differ for {source_id}; missing={missing}, extra={extra}"
            )
        final_answers: dict[str, str] = {}
        reasons: dict[str, str] = {}
        for question_id, result_answer in resolved.items():
            questions[question_id]["private"] = complete_adjudication(result_answer, question_id)
            final_answers[question_id] = result_answer["answer"]
            reasons[question_id] = result_answer["reasonZh"]
        question_set["adjudication"] = {
            "adjudicatedAt": utc_now(),
            "finalAnswers": final_answers,
            "reasonsZh": reasons,
        }
        question_set["status"] = "adjudicated"
    return bank


def main() -> None:
    args = parse_args()
    bank = read_json(args.author.resolve())
    if bank.get("schemaVersion") != SCHEMA_VERSION or bank.get("skillVersion") != SKILL_VERSION:
        raise SystemExit("Author bank schemaVersion or skillVersion is unsupported")
    output = copy.deepcopy(bank)
    if args.review:
        output = reconcile_review(output, read_json(args.review.resolve()))
    else:
        output = reconcile_adjudication(output, read_json(args.adjudication.resolve()))
    output["updatedAt"] = utc_now()
    write_json(args.output, output)
    states: dict[str, int] = {}
    for question_set in bank_sets(output):
        status = compact_text(question_set.get("status"))
        states[status] = states.get(status, 0) + 1
    summary = ", ".join(f"{key}={value}" for key, value in sorted(states.items()))
    print(f"Wrote reconciled bank to {args.output.resolve()} ({summary})", flush=True)


if __name__ == "__main__":
    main()
