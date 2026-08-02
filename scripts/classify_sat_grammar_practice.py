#!/usr/bin/env python3
"""Classify embedded SAT grammar questions by course chapter and knowledge point."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


DEFAULT_CATALOG = Path("apps/web/data/sat-grammar-practice.json")
DEFAULT_SOURCE_CATALOG = Path("D:/BaiduNetdiskDownload/SAT真题/output/data/sat_grammar_items.json")
DEFAULT_LIBRARY = Path("apps/web/data/sat-grammar-library.json")

CATEGORY_DEFAULT_RULE = {
    "主语与谓语之间的标点": "rule-017",
    "句界与独立分句": "rule-005",
    "插入语与补充成分": "rule-021",
    "标点选择": "rule-030",
    "主谓一致": "rule-038",
    "代词指代与格": "rule-053",
    "修饰语": "rule-067",
    "动词形式": "rule-073",
    "动词时态": "rule-090",
    "句法与语意完整性": "rule-105",
    "平行结构": "rule-107",
    "所有格与撇号": "rule-112",
    "比较结构": "rule-121",
}

PRONOUNS = {
    "he",
    "him",
    "his",
    "she",
    "her",
    "hers",
    "they",
    "them",
    "their",
    "theirs",
    "there",
    "they're",
    "it",
    "its",
    "it's",
    "we",
    "us",
    "our",
    "ours",
    "i",
    "me",
    "my",
    "mine",
    "you",
    "your",
    "yours",
    "who",
    "whom",
    "whose",
    "which",
    "that",
    "this",
    "these",
    "those",
    "one",
    "ones",
    "himself",
    "herself",
    "itself",
    "themselves",
    "ourselves",
    "yourself",
    "yourselves",
}

CONNECTIVE_ADVERBS = (
    "however",
    "therefore",
    "moreover",
    "nevertheless",
    "nonetheless",
    "consequently",
    "instead",
    "likewise",
    "for example",
    "for instance",
    "in fact",
    "thus",
)


def load_knowledge_points(path: Path) -> dict[str, dict[str, str]]:
    library = json.loads(path.read_text(encoding="utf-8"))
    points: dict[str, dict[str, str]] = {}
    for entry in [*library["chapters"], *library["appendices"]]:
        for section in entry["sections"]:
            for rule in section["rules"]:
                points[rule["id"]] = {
                    "chapterId": entry["id"],
                    "chapterTitle": entry["title"],
                    "knowledgePointTitle": rule["title"],
                }
    return points


def normalized_words(value: str) -> list[str]:
    return re.findall(r"[a-z]+(?:'[a-z]+)?", value.lower())


def first_word(value: str) -> str:
    words = normalized_words(value)
    return words[0] if words else ""


def rationale_rule(rationale: str) -> str | None:
    value = re.sub(r"\s+", " ", rationale.lower())
    hints = (
        (r"subject[-— ]modifier placement", "rule-065"),
        (r"subject[-— ]verb agreement", "rule-038"),
        (r"pronoun[-— ]antecedent agreement", "rule-053"),
        (r"possessive determiners?", "rule-057"),
        (r"plural and possessive nouns?", "rule-111"),
        (r"possessive nouns?", "rule-112"),
        (r"plural nouns?", "rule-111"),
        (r"finite and nonfinite verb forms?|finite and non-finite verb forms?", "rule-073"),
        (r"nonfinite verb forms?|non-finite \(untensed\) verb forms?", "rule-073"),
        (r"verbs? to express tense", "rule-090"),
        (r"finite verbs? in a relative clause", "rule-051"),
        (r"finite verb use in a main clause", "rule-094"),
        (r"integrated relative clause", "rule-022"),
        (r"punctuation between a subject and a verb", "rule-017"),
        (r"preposition and its complement", "rule-019"),
        (r"titles? and proper nouns?|name and title", "rule-024"),
        (r"items? in a complex series|elements? in a complex series", "rule-031"),
        (r"items? in a series", "rule-027"),
        (r"colon (?:use|within)", "rule-032"),
        (r"supplementary", "rule-021"),
        (r"subordinate clause and a main clause", "rule-011"),
        (r"main clause and a subordinate clause", "rule-012"),
        (r"coordination of (?:independent|main) clauses", "rule-008"),
        (r"punctuation use between sentences|end-of-sentence punctuation", "rule-007"),
        (r"punctuation between coordinates", "rule-027"),
    )
    for pattern, rule_id in hints:
        if re.search(pattern, value):
            return rule_id
    return None


def pronoun_rule(choices: list[str]) -> str | None:
    heads = [first_word(choice) for choice in choices]
    if sum(head in PRONOUNS for head in heads) < 3:
        return None
    values = set(heads)
    if {"who", "whom"} & values:
        return "rule-056"
    if {"its", "it's"} <= values or "it's" in values:
        return "rule-058"
    if {"their", "there", "they're"} & values:
        return "rule-059"
    if any(value.endswith("self") or value.endswith("selves") for value in values):
        return "rule-060"
    if {"this", "that", "these", "those"} & values:
        return "rule-061"
    if {"one", "ones"} & values:
        return "rule-062"
    if {"which", "that", "who", "whom", "whose"} & values:
        return "rule-063"
    if {"my", "mine", "your", "yours", "his", "her", "hers", "our", "ours", "their", "theirs"} & values:
        return "rule-057"
    return "rule-053"


def comparison_rule(question: str, choices: list[str]) -> str | None:
    del question
    value = " ".join(choices).lower()
    average_words = sum(len(normalized_words(choice)) for choice in choices) / max(1, len(choices))
    if average_words > 6:
        return None
    if re.search(r"\bbetween\b|\bamong\b", value):
        return "rule-129"
    if re.search(r"\bfewer\b|\bless\b|\bnumber of\b|\bamount of\b", value):
        return "rule-126"
    if re.search(r"\bthat\b|\bthose\b", value) and re.search(r"\bthan\b|\bas\b", value):
        return "rule-122"
    if re.search(r"\bas\b.+\bas\b|\bthan\b", value):
        return "rule-125"
    marker_signatures = {
        tuple(re.findall(r"\b(?:more|most|less|least|fewer|fewest)\b", choice.lower()))
        for choice in choices
    }
    if len(marker_signatures) > 1 and any(marker_signatures):
        return "rule-123"
    return None


def possessive_rule(choices: list[str]) -> str | None:
    joined = " ".join(choices)
    if sum(bool(re.search(r"['’]", choice)) for choice in choices) < 2:
        return None
    words = [normalized_words(choice) for choice in choices]
    if not words or max((len(value) for value in words), default=0) > 5:
        return None
    if any(re.search(r"\b(?:its|theirs|hers|ours|yours)['’]", choice.lower()) for choice in choices):
        return "rule-119"
    if any(re.search(r"s['’](?:\s|$)", choice.lower()) for choice in choices):
        return "rule-113"
    return "rule-112"


def verb_rule(question: str, choices: list[str]) -> str | None:
    values = [choice.strip().lower() for choice in choices]
    short = [value for value in values if len(normalized_words(value)) <= 6]
    if len(short) < 3:
        return None
    nonfinite = sum(
        bool(re.match(r"(?:to\s+\w+|having\s+\w+|being\s+\w+|\w+ing\b|\w+ed\b)", value))
        for value in values
    )
    if nonfinite >= 2 and any(
        not re.match(r"(?:to\s+\w+|having\s+\w+|being\s+\w+|\w+ing\b|\w+ed\b)", value)
        for value in values
    ):
        if any(value.startswith("having ") for value in values):
            return "rule-078"
        if any(value.startswith("to ") for value in values):
            return "rule-074"
        if any(value.startswith("being ") for value in values):
            return "rule-080"
        return "rule-073"

    heads = [first_word(value) for value in values]
    head_set = set(heads)
    agreement_sets = (
        {"is", "are"},
        {"was", "were"},
        {"has", "have"},
        {"does", "do"},
    )
    if any(pair <= head_set for pair in agreement_sets):
        if len(head_set & {"had", "will", "been", "being"}) == 0:
            return "rule-038"

    tense_markers = re.compile(r"\b(?:will|would|had|has|have|was|were|is|are|been|being|did|does)\b")
    if sum(bool(tense_markers.search(value)) for value in values) >= 2:
        if any(value.startswith("will ") for value in values):
            return "rule-088"
        if any(value.startswith("had ") for value in values):
            return "rule-087"
        if any(value.startswith(("has ", "have ")) for value in values):
            return "rule-086"
        if any(re.search(r"\b(?:been|being)\b", value) for value in values):
            return "rule-091"
        return "rule-090"

    if all(1 <= len(normalized_words(value)) <= 3 for value in values) and len(head_set) >= 3:
        endings = sum(bool(re.search(r"(?:s|ed|ing)\b", head)) for head in heads)
        if endings >= 2:
            return "rule-073"
    return None


def punctuation_rule(question: str, choices: list[str]) -> str | None:
    joined = " ".join(choices)
    signatures = {
        "".join(re.findall(r"[,;:.—–-]", choice.replace("'", "").replace("’", "")))
        for choice in choices
    }
    punctuation_count = sum(
        bool(re.search(r"[,;:.—–-]", choice.replace("'", "").replace("’", "")))
        for choice in choices
    )
    average_words = sum(len(normalized_words(choice)) for choice in choices) / max(1, len(choices))
    if punctuation_count < 2 or len(signatures) < 2 or average_words > 8:
        return None
    lower = joined.lower()
    question_lower = question.lower()
    if any(token in lower for token in CONNECTIVE_ADVERBS):
        return "rule-013"
    if re.search(r"\b(?:such as|including)\b", lower) and ":" in joined:
        return "rule-035"
    if ":" in joined:
        return "rule-032"
    if "—" in joined or "–" in joined:
        return "rule-034"
    if ";" in joined and joined.count(",") >= 4:
        return "rule-031"
    if re.search(r"\b(?:called|named|author|artist|poet|novelist|scientist|researcher|professor|composer|painter)\b", question_lower):
        return "rule-024"
    if re.search(r"\b(?:which|who|whose|where)\b", question_lower):
        return "rule-021"
    if ";" in joined or re.search(r"\.\s+[A-Z]", joined):
        return "rule-007"
    if re.search(r",\s*(?:and|but|or|nor|for|so|yet)\b", lower):
        return "rule-008"
    if joined.count(",") >= 5:
        return "rule-029"
    return "rule-020"


def fallback_rule(item: dict[str, Any], question: str, choices: list[str]) -> str:
    del item
    punctuation = punctuation_rule(question, choices)
    if punctuation:
        return punctuation
    pronoun = pronoun_rule(choices)
    if pronoun:
        return pronoun
    possessive = possessive_rule(choices)
    if possessive:
        return possessive
    comparison = comparison_rule(question, choices)
    if comparison:
        return comparison
    verb = verb_rule(question, choices)
    if verb:
        return verb
    values = [normalized_words(choice) for choice in choices]
    average_words = sum(len(value) for value in values) / max(1, len(values))
    if average_words >= 5:
        return "rule-067"
    if any(re.search(r"\b(?:such as|including)\b", choice.lower()) for choice in choices):
        return "rule-100"
    if any(re.search(r"\b(?:there is|there are|it is|it was)\b", choice.lower()) for choice in choices):
        return "rule-103"
    return "rule-105"


def refine_rule(chapter_id: str, question: str, choices: list[str]) -> str:
    if chapter_id == "pronouns":
        return pronoun_rule(choices) or "rule-053"
    if chapter_id == "comparisons":
        return comparison_rule(question, choices) or "rule-121"
    if chapter_id == "possessives-apostrophes":
        return possessive_rule(choices) or "rule-112"
    if chapter_id in {"subject-verb-agreement", "verb-forms", "tense-voice-mood"}:
        inferred = verb_rule(question, choices)
        if inferred:
            inferred_chapter = {
                "rule-038": "subject-verb-agreement",
                "rule-086": "tense-voice-mood",
                "rule-087": "tense-voice-mood",
                "rule-088": "tense-voice-mood",
                "rule-090": "tense-voice-mood",
                "rule-091": "tense-voice-mood",
            }.get(inferred, "verb-forms")
            if inferred_chapter == chapter_id:
                return inferred
    if chapter_id in {"clause-boundaries", "commas-parentheticals", "semicolons-colons-dashes"}:
        inferred = punctuation_rule(question, choices)
        if inferred:
            inferred_chapter = (
                "clause-boundaries"
                if inferred in {"rule-007", "rule-008", "rule-013"}
                else "semicolons-colons-dashes"
                if inferred in {"rule-031", "rule-032", "rule-034", "rule-035"}
                else "commas-parentheticals"
            )
            if inferred_chapter == chapter_id:
                return inferred
    return {
        "clause-boundaries": "rule-005",
        "commas-parentheticals": "rule-021",
        "semicolons-colons-dashes": "rule-030",
        "subject-verb-agreement": "rule-038",
        "pronouns": "rule-053",
        "modifiers": "rule-067",
        "verb-forms": "rule-073",
        "tense-voice-mood": "rule-090",
        "syntax-completeness": "rule-105",
        "parallelism": "rule-107",
        "possessives-apostrophes": "rule-112",
        "comparisons": "rule-121",
    }[chapter_id]


def classify_question(
    item: dict[str, Any],
    question: str,
    choices: list[str],
    knowledge_points: dict[str, dict[str, str]],
) -> dict[str, str]:
    rule_id = rationale_rule(str(item.get("english_rationale") or ""))
    source_category = str(item.get("subtopic") or "句法与语意完整性")
    if source_category == "平行结构":
        rule_id = rule_id or "rule-107"
    if not rule_id:
        rule_id = punctuation_rule(question, choices)
    if not rule_id:
        rule_id = pronoun_rule(choices)
    if not rule_id:
        rule_id = possessive_rule(choices)
    if not rule_id:
        rule_id = comparison_rule(question, choices)
    if not rule_id:
        rule_id = verb_rule(question, choices)
    if not rule_id and source_category != "句法与语意完整性":
        default_rule = CATEGORY_DEFAULT_RULE.get(source_category, "rule-105")
        chapter_id = knowledge_points[default_rule]["chapterId"]
        rule_id = refine_rule(chapter_id, question, choices)
    if not rule_id:
        rule_id = fallback_rule(item, question, choices)
    point = knowledge_points[rule_id]
    return {
        "chapterId": point["chapterId"],
        "category": point["knowledgePointTitle"],
        "knowledgePointId": rule_id,
        "knowledgePointTitle": point["knowledgePointTitle"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--source-catalog", type=Path, default=DEFAULT_SOURCE_CATALOG)
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(args.catalog.read_text(encoding="utf-8"))
    source_items = {
        str(item["id"]): item
        for item in json.loads(args.source_catalog.read_text(encoding="utf-8"))
    }
    knowledge_points = load_knowledge_points(args.library)
    chapter_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    point_counts: dict[str, int] = {}
    for record in payload["items"]:
        source = source_items[str(record["id"])]
        classification = classify_question(
            source, record["questionText"], record["choiceTexts"], knowledge_points
        )
        record.update(classification)
        chapter_counts[record["chapterId"]] = chapter_counts.get(record["chapterId"], 0) + 1
        category_counts[record["category"]] = category_counts.get(record["category"], 0) + 1
        point_id = record["knowledgePointId"]
        point_counts[point_id] = point_counts.get(point_id, 0) + 1
    payload["version"] = "2026-08-03-classified"
    payload["summary"]["chapterCounts"] = dict(sorted(chapter_counts.items()))
    payload["summary"]["categoryCounts"] = dict(sorted(category_counts.items()))
    payload["summary"]["knowledgePointCounts"] = dict(sorted(point_counts.items()))
    args.catalog.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Classified {len(payload['items'])} questions across "
        f"{len(chapter_counts)} chapters and {len(point_counts)} knowledge points."
    )


if __name__ == "__main__":
    main()
