#!/usr/bin/env python3
"""Standard-library tests for the Skill's deterministic question-bank tools."""

from __future__ import annotations

import copy
import unittest

from question_bank_common import SKILL_VERSION, source_hash
from reconcile_reviews import reconcile_adjudication, reconcile_review
from validate_question_sets import validate_bank


def source(collection: str = "minute-earth") -> dict:
    transcript = (
        "Beginning evidence explains the central scientific question clearly. "
        + "Background context expands the first idea with a useful comparison. "
        + "Middle evidence describes the mechanism and shows why the example matters. "
        + "A second explanation connects the mechanism to a broader consequence. "
        + "Ending evidence summarizes the result and predicts what researchers may examine next."
    )
    return {
        "id": "minute-earth-test" if collection == "minute-earth" else "bbc-test",
        "collection": collection,
        "sequence": 1,
        "title": "Test source",
        "durationSeconds": 180 if collection == "minute-earth" else 360,
        "transcript": transcript,
    }


def evidence(transcript: str, text: str) -> dict:
    start = transcript.index(text)
    return {"start": start, "end": start + len(text), "quote": text}


def valid_bank(item: dict | None = None) -> dict:
    item = item or source()
    transcript = item["transcript"]
    snippets = [
        "Beginning evidence explains the central scientific question clearly.",
        "Middle evidence describes the mechanism and shows why the example matters.",
        "A second explanation connects the mechanism to a broader consequence.",
        "Ending evidence summarizes the result and predicts what researchers may examine next.",
    ]
    question_types = ["main_idea", "detail", "rhetorical_purpose", "inference"]
    questions = []
    for index, question_type in enumerate(question_types, start=1):
        questions.append(
            {
                "id": f"{item['id']}-q{index:02d}",
                "position": index,
                "type": question_type,
                "difficulty": "medium",
                "public": {
                    "prompt": f"What does question {index} test?",
                    "options": [
                        {"id": "a", "text": f"Accurate option {index}"},
                        {"id": "b", "text": f"Distractor one {index}"},
                        {"id": "c", "text": f"Distractor two {index}"},
                        {"id": "d", "text": f"Distractor three {index}"},
                    ],
                },
                "private": {
                    "answer": "a",
                    "evidence": [evidence(transcript, snippets[index - 1])],
                    "explanationZh": "原文证据能够支持正确答案。",
                    "optionRationalesZh": {
                        "a": "该选项准确概括了证据。",
                        "b": "该选项与原文关系不符。",
                        "c": "该选项扩大了原文范围。",
                        "d": "该选项混淆了前因后果。",
                    },
                },
            }
        )
    collection = item["collection"]
    return {
        "schemaVersion": 1,
        "skillVersion": SKILL_VERSION,
        "generatedAt": "2026-01-01T00:00:00+00:00",
        "sets": [
            {
                "sourceId": item["id"],
                "collection": collection,
                "profile": (
                    "minute-earth-academic-talk"
                    if collection == "minute-earth"
                    else "bbc-full-academic-discussion"
                ),
                "sourceHash": source_hash(item),
                "label": (
                    "TOEFL Academic Listening Practice"
                    if collection == "minute-earth"
                    else "TOEFL-style Academic Listening Practice"
                ),
                "exactSimulation": collection == "minute-earth",
                "status": "draft",
                "audioDifficulty": {
                    "level": "medium",
                    "basis": "provisional-content-analysis",
                },
                "questions": questions,
            }
        ],
    }


def error_messages(item: dict, bank: dict) -> list[str]:
    return [issue.message for issue in validate_bank({item["id"]: item}, bank) if issue.severity == "error"]


class ValidatorTests(unittest.TestCase):
    def test_valid_bank(self) -> None:
        item = source()
        self.assertEqual(error_messages(item, valid_bank(item)), [])

    def test_requires_exactly_four_questions(self) -> None:
        item = source()
        bank = valid_bank(item)
        bank["sets"][0]["questions"].pop()
        self.assertIn("Each set must contain exactly four questions", error_messages(item, bank))

    def test_rejects_duplicate_options(self) -> None:
        item = source()
        bank = valid_bank(item)
        options = bank["sets"][0]["questions"][0]["public"]["options"]
        options[1]["text"] = options[0]["text"]
        self.assertIn("Option texts must be unique", error_messages(item, bank))

    def test_rejects_invalid_answer(self) -> None:
        item = source()
        bank = valid_bank(item)
        bank["sets"][0]["questions"][0]["private"]["answer"] = "e"
        self.assertIn("answer must be one of a, b, c, d", error_messages(item, bank))

    def test_rejects_inexact_evidence(self) -> None:
        item = source()
        bank = valid_bank(item)
        bank["sets"][0]["questions"][0]["private"]["evidence"][0]["quote"] = "wrong"
        self.assertIn("Quote does not match transcript offsets", error_messages(item, bank))

    def test_rejects_stale_source_hash(self) -> None:
        item = source()
        bank = valid_bank(item)
        bank["sets"][0]["sourceHash"] = "0" * 64
        self.assertIn("Source hash is stale or incorrect", error_messages(item, bank))

    def test_rejects_invalid_question_type(self) -> None:
        item = source()
        bank = valid_bank(item)
        bank["sets"][0]["questions"][0]["type"] = "vocabulary"
        self.assertIn("Unsupported question type", error_messages(item, bank))

    def test_bbc_requires_end_region_coverage(self) -> None:
        item = source("bbc-6-minute-english")
        bank = valid_bank(item)
        first = bank["sets"][0]["questions"][0]["private"]["evidence"][0]
        for question in bank["sets"][0]["questions"]:
            question["private"]["evidence"] = [copy.deepcopy(first)]
        messages = error_messages(item, bank)
        self.assertTrue(any(message.startswith("Evidence does not cover") for message in messages))


class ReconciliationTests(unittest.TestCase):
    def review_result(self, bank: dict, *, disagree: bool = False) -> dict:
        question_set = bank["sets"][0]
        answers = []
        for index, question in enumerate(question_set["questions"]):
            answers.append(
                {
                    "questionId": question["id"],
                    "answer": "b" if disagree and index == 0 else "a",
                    "ambiguous": False,
                    "reasonZh": "根据原文独立作答。",
                }
            )
        return {
            "schemaVersion": 1,
            "mode": "review-result",
            "reviews": [
                {
                    "sourceId": question_set["sourceId"],
                    "sourceHash": question_set["sourceHash"],
                    "answers": answers,
                }
            ],
        }

    def test_agreement_moves_draft_to_reviewed(self) -> None:
        bank = valid_bank()
        reconciled = reconcile_review(bank, self.review_result(bank))
        self.assertEqual(reconciled["sets"][0]["status"], "reviewed")

    def test_disagreement_requires_adjudication(self) -> None:
        bank = valid_bank()
        reconciled = reconcile_review(bank, self.review_result(bank, disagree=True))
        self.assertEqual(reconciled["sets"][0]["status"], "needs_adjudication")
        self.assertEqual(
            reconciled["sets"][0]["review"]["disagreements"],
            ["minute-earth-test-q01"],
        )

    def test_adjudication_rejects_wrong_starting_state(self) -> None:
        bank = valid_bank()
        question_set = bank["sets"][0]
        result = {
            "schemaVersion": 1,
            "mode": "adjudication-result",
            "reviews": [
                {
                    "sourceId": question_set["sourceId"],
                    "sourceHash": question_set["sourceHash"],
                    "answers": [],
                }
            ],
        }
        with self.assertRaises(SystemExit):
            reconcile_adjudication(bank, result)


if __name__ == "__main__":
    unittest.main()
