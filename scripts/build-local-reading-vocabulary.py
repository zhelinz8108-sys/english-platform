#!/usr/bin/env python3
"""Build globally deduplicated vocabulary cards for the CommonLit reading library."""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_READING_ROOT = REPOSITORY_ROOT / "apps" / "web" / "data" / "commonlit-reading"
DEFAULT_OUTPUT_ROOT = (
    REPOSITORY_ROOT / "apps" / "web" / "data" / "commonlit-reading-vocabulary"
)
DEFAULT_DICTIONARY = Path(
    r"D:\留学\托福\听力\Minute Earth\tmp\ecdict_repo\ecdict.csv"
)
DEFAULT_TRANSLATION_CACHE = (
    REPOSITORY_ROOT / "tmp" / "commonlit-reading-context-translations.json"
)
WORD_PATTERN = re.compile(r"\b[A-Za-z][A-Za-z'-]{3,}\b")
CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]")
ENGLISH_CONTEXT_SIGNAL_PATTERN = re.compile(
    r"\b(?:a|an|and|are|as|at|be|been|but|by|did|do|does|for|from|had|has|have|he|"
    r"her|his|i|in|is|it|my|not|of|on|or|our|she|that|the|their|they|this|to|was|"
    r"we|were|with|you|your)\b",
    flags=re.IGNORECASE,
)
PROPER_NAME_PATTERN = re.compile(
    r"(?:\[人名\]|人名|姓氏|男子名|女子名|地名|姓或男子名)",
    flags=re.IGNORECASE,
)
POS_PATTERN = re.compile(
    r"^(vt\.?\s*&\s*vi\.?|vi\.?\s*&\s*vt\.?|vt|vi|adj|adv|prep|conj|pron|num|"
    r"interj|abbr|aux|art|v|n|a|s)\.?\s*(.*)$",
    flags=re.IGNORECASE,
)
POS_ABBREVIATIONS = {
    "vt": "v.t.",
    "vi": "v.i.",
    "vt&vi": "v.t. / v.i.",
    "vi&vt": "v.i. / v.t.",
    "v": "v.",
    "n": "n.",
    "a": "adj.",
    "s": "adj.",
    "adj": "adj.",
    "adv": "adv.",
    "prep": "prep.",
    "conj": "conj.",
    "pron": "pron.",
    "num": "num.",
    "interj": "interj.",
    "abbr": "abbr.",
    "aux": "aux.",
    "art": "art.",
}

# Function words and very general classroom words are poor targets even when TF-IDF ranks them.
VOCABULARY_STOP_WORDS = {
    "about",
    "above",
    "after",
    "again",
    "against",
    "almost",
    "along",
    "already",
    "also",
    "although",
    "always",
    "among",
    "another",
    "around",
    "asked",
    "away",
    "back",
    "because",
    "before",
    "being",
    "below",
    "between",
    "both",
    "called",
    "came",
    "could",
    "didn't",
    "doesn't",
    "don't",
    "during",
    "each",
    "enough",
    "even",
    "every",
    "first",
    "found",
    "from",
    "going",
    "great",
    "hadn't",
    "have",
    "having",
    "here",
    "himself",
    "herself",
    "itself",
    "just",
    "later",
    "little",
    "looked",
    "made",
    "maybe",
    "might",
    "more",
    "most",
    "much",
    "never",
    "other",
    "people",
    "really",
    "right",
    "said",
    "same",
    "should",
    "since",
    "something",
    "still",
    "that's",
    "their",
    "there",
    "these",
    "thing",
    "think",
    "those",
    "thought",
    "through",
    "today",
    "together",
    "under",
    "until",
    "using",
    "very",
    "wanted",
    "wasn't",
    "we're",
    "we've",
    "well",
    "weren't",
    "what's",
    "where",
    "which",
    "while",
    "without",
    "would",
    "you're",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reading-root", type=Path, default=DEFAULT_READING_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--dictionary", type=Path, default=DEFAULT_DICTIONARY)
    parser.add_argument("--translation-cache", type=Path, default=DEFAULT_TRANSLATION_CACHE)
    parser.add_argument("--words-per-article", type=int, default=10)
    parser.add_argument("--translation-workers", type=int, default=6)
    parser.add_argument(
        "--skip-context-translations",
        action="store_true",
        help="Build cards without calling Google Translate; intended only for local selection checks.",
    )
    return parser.parse_args()


def normalize_text(value: str) -> str:
    replacements = {
        "\u00a0": " ",
        "\u200b": "",
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
    }
    normalized = html.unescape(value)
    for old, new in replacements.items():
        normalized = normalized.replace(old, new)
    return re.sub(r"\s+", " ", normalized).strip()


def load_articles(reading_root: Path) -> list[dict[str, Any]]:
    articles: list[dict[str, Any]] = []
    for grade in range(3, 13):
        path = reading_root / f"grade-{grade:02d}.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        articles.extend(document.get("articles") or [])
    articles.sort(key=lambda article: (int(article["grade"]), int(article["sequence"])))
    return articles


def article_text(article: dict[str, Any]) -> str:
    return "\n".join(
        normalize_text(str(block.get("text") or "")) for block in article.get("blocks") or []
    )


def candidate_terms(text: str) -> set[str]:
    lowercase_terms: set[str] = set()
    all_terms: set[str] = set()
    for match in WORD_PATTERN.finditer(text):
        original = match.group(0).strip("'-")
        word = original.casefold()
        if len(word) < 5 or word in VOCABULARY_STOP_WORDS:
            continue
        all_terms.add(word)
        if original[0].islower():
            lowercase_terms.add(word)
    # Proper names are normally capitalized everywhere. Sentence-initial vocabulary remains eligible
    # when it also appears in lowercase elsewhere in the article.
    return all_terms & lowercase_terms


def parse_exchange_base(value: str, word: str) -> str:
    for segment in value.split("/"):
        if segment.startswith("0:"):
            base = segment[2:].strip().casefold()
            if re.fullmatch(r"[a-z][a-z'-]{2,}", base):
                return base
    return word


def parsed_chinese_definition(value: str) -> tuple[str, str]:
    definitions: list[tuple[str, str]] = []
    for raw in value.replace("\\r\\n", "\n").replace("\\n", "\n").splitlines():
        line = raw.strip()
        if not line:
            continue
        match = POS_PATTERN.match(line)
        if match:
            raw_pos = re.sub(r"[.\s]+", "", match.group(1).casefold())
            part_of_speech = POS_ABBREVIATIONS.get(raw_pos, "")
            meaning = match.group(2).strip(" .")
        else:
            part_of_speech = ""
            meaning = line
        if meaning:
            definitions.append((part_of_speech, meaning.rstrip("\uff0c\uff1b ")))
    parts = list(dict.fromkeys(part for part, _ in definitions if part))
    part_of_speech = " / ".join(parts)
    chinese = "\uff1b".join(f"{part} {meaning}".strip() for part, meaning in definitions)
    return part_of_speech, chinese


def dictionary_ipa(value: str) -> str:
    normalized = normalize_text(value).replace("\u04d9", "\u0259").replace(":", "\u02d0").strip("/ ")
    return f"/{normalized}/" if normalized else ""


def usable_dictionary_row(row: dict[str, str], word: str) -> dict[str, str] | None:
    part_of_speech, definition = parsed_chinese_definition(str(row.get("translation") or ""))
    if (
        not part_of_speech
        or not CHINESE_PATTERN.search(definition)
        or PROPER_NAME_PATTERN.search(definition)
    ):
        return None
    return {
        "word": word,
        "ipa": dictionary_ipa(str(row.get("phonetic") or "")),
        "partOfSpeech": part_of_speech,
        "definition": definition,
        "base": parse_exchange_base(str(row.get("exchange") or ""), word),
        "frequencyRank": str(row.get("frq") or "0"),
        "collins": str(row.get("collins") or "0"),
    }


def load_dictionary(path: Path, terms: set[str]) -> dict[str, dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"Missing ECDICT dictionary: {path}")
    surface_rows: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            word = str(row.get("word") or "").casefold()
            if word not in terms or not row.get("translation"):
                continue
            parsed = usable_dictionary_row(row, word)
            if parsed:
                surface_rows[word] = parsed

    base_terms = {row["base"] for row in surface_rows.values() if row["base"] != row["word"]}
    base_rows: dict[str, dict[str, str]] = {}
    if base_terms:
        with path.open(encoding="utf-8", newline="") as file:
            for row in csv.DictReader(file):
                word = str(row.get("word") or "").casefold()
                if word not in base_terms or not row.get("translation"):
                    continue
                parsed = usable_dictionary_row(row, word)
                if parsed:
                    base_rows[word] = parsed

    rows: dict[str, dict[str, str]] = {}
    for surface, surface_row in surface_rows.items():
        base = surface_row["base"]
        teaching_row = base_rows.get(base, surface_row)
        rows[surface] = {
            **teaching_row,
            "surface": surface,
            "base": base,
            # Candidate scoring should use the observed form's corpus rank when it is available.
            "frequencyRank": surface_row["frequencyRank"],
            "collins": surface_row["collins"],
        }
    return rows


def shortened_context(text: str, match: re.Match[str], limit: int = 360) -> str:
    if len(text) <= limit:
        return text
    left = max(0, match.start() - 135)
    right = min(len(text), match.end() + 205)
    if left:
        left = text.find(" ", left) + 1
    if right < len(text):
        previous_space = text.rfind(" ", 0, right)
        right = previous_space if previous_space > left else right
    return f"{'...' if left else ''}{text[left:right].strip()}{'...' if right < len(text) else ''}"


def context_for_word(article: dict[str, Any], word: str) -> str:
    pattern = re.compile(rf"\b{re.escape(word)}\b", flags=re.IGNORECASE)
    for block in article.get("blocks") or []:
        text = normalize_text(str(block.get("text") or ""))
        match = pattern.search(text)
        if not match:
            continue
        sentence_parts = re.split(r"(?<=[.!?])\s+", text)
        for sentence in sentence_parts:
            sentence_match = pattern.search(sentence)
            if sentence_match and ENGLISH_CONTEXT_SIGNAL_PATTERN.search(sentence):
                return shortened_context(sentence, sentence_match)
        if ENGLISH_CONTEXT_SIGNAL_PATTERN.search(text):
            return shortened_context(text, match)
    return ""


def rank_for_article(
    article: dict[str, Any],
    dictionary: dict[str, dict[str, str]],
    document_frequency: Counter[str],
    document_count: int,
) -> list[str]:
    text = article_text(article)
    frequencies = Counter(
        match.group(0).casefold().strip("'-")
        for match in WORD_PATTERN.finditer(text)
        if match.group(0).casefold().strip("'-") in dictionary
    )
    ranked: list[tuple[float, str]] = []
    for word, frequency in frequencies.items():
        row = dictionary[word]
        rank = int(row["frequencyRank"] or 0)
        collins = int(row["collins"] or 0)
        inverse_document_frequency = math.log(
            (document_count + 1) / (document_frequency[word] + 1)
        )
        rarity = 2.15 if rank == 0 else min(2.4, math.log1p(rank) / 4.2)
        common_penalty = max(0, collins - 3) * 0.35
        score = (
            inverse_document_frequency * 1.55
            + rarity
            + min(len(word), 14) / 12
            + math.log1p(frequency) * 0.28
            - common_penalty
        )
        ranked.append((score, word))
    ranked.sort(key=lambda entry: (-entry[0], entry[1]))
    return [word for _, word in ranked]


def select_vocabulary(
    articles: list[dict[str, Any]],
    dictionary: dict[str, dict[str, str]],
    document_frequency: Counter[str],
    words_per_article: int,
) -> list[dict[str, Any]]:
    ranked_by_article = [
        rank_for_article(article, dictionary, document_frequency, len(articles))
        for article in articles
    ]
    candidate_base_frequency: Counter[str] = Counter()
    for ranked in ranked_by_article:
        candidate_base_frequency.update({dictionary[word]["word"] for word in ranked})

    # Reserve rare candidates in rounds before filling cards in catalogue order. Without this pass,
    # early long passages can consume nearly every eligible word from later short poems.
    reserved_by_article: dict[int, list[str]] = {}
    reserved_bases: set[str] = set()
    article_order = sorted(
        range(len(articles)),
        key=lambda index: (len(ranked_by_article[index]), int(articles[index]["grade"]), index),
    )
    candidate_order_by_article: dict[int, list[str]] = {}
    for article_index in article_order:
        ranked = ranked_by_article[article_index]
        rank_position = {word: position for position, word in enumerate(ranked)}
        candidate_order_by_article[article_index] = sorted(
            ranked,
            key=lambda word: (
                candidate_base_frequency[dictionary[word]["word"]],
                rank_position[word],
                dictionary[word]["word"],
            ),
        )

    for _round in range(words_per_article):
        reserved_this_round = 0
        for article_index in article_order:
            reserved = reserved_by_article.setdefault(article_index, [])
            if len(reserved) > _round:
                continue
            for word in candidate_order_by_article[article_index]:
                row = dictionary[word]
                deduplication_key = row["word"]
                if deduplication_key in reserved_bases:
                    continue
                context = context_for_word(articles[article_index], word)
                if not context:
                    continue
                reserved_bases.add(deduplication_key)
                reserved.append(word)
                reserved_this_round += 1
                break
        if reserved_this_round == 0:
            break

    seen_bases = set(reserved_bases)
    selected_articles: list[dict[str, Any]] = []
    for article_index, article in enumerate(articles):
        entries: list[dict[str, str]] = []
        reserved = reserved_by_article.get(article_index, [])
        reserved_keys = {dictionary[word]["word"] for word in reserved}
        ordered_words = reserved + ranked_by_article[article_index]
        included_bases: set[str] = set()
        for word in ordered_words:
            row = dictionary[word]
            deduplication_key = row["word"]
            is_reserved = deduplication_key in reserved_keys
            if deduplication_key in included_bases or (
                deduplication_key in seen_bases and not is_reserved
            ):
                continue
            context = context_for_word(article, word)
            if not context:
                continue
            seen_bases.add(deduplication_key)
            included_bases.add(deduplication_key)
            entries.append(
                {
                    "word": row["word"],
                    "contextTerm": word,
                    "ipa": row["ipa"],
                    "partOfSpeech": row["partOfSpeech"],
                    "definition": row["definition"],
                    "englishDefinition": "",
                    "context": context,
                    "contextTranslation": "",
                }
            )
            if len(entries) >= words_per_article:
                break
        selected_articles.append({"articleId": article["id"], "vocabulary": entries})
        completed = article_index + 1
        if completed % 100 == 0 or completed == len(articles):
            print(
                f"Selected vocabulary for {completed}/{len(articles)} articles "
                f"({len(seen_bases)} globally unique terms)...",
                flush=True,
            )
    return selected_articles


def load_translation_cache(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    return {
        source: translation
        for source, translation in dict(document.get("translations") or {}).items()
        if CHINESE_PATTERN.search(str(translation))
    }


def write_translation_cache(path: Path, translations: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": datetime.now(UTC).isoformat(),
                "translations": translations,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def google_translate_batch(values: list[str], workers: int) -> dict[str, str]:
    def request_translation(payload: str) -> str:
        query = urllib.parse.urlencode(
            {"client": "gtx", "sl": "en", "tl": "zh-CN", "dt": "t", "q": payload}
        )
        url = f"https://translate.googleapis.com/translate_a/single?{query}"
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    document = json.loads(response.read().decode("utf-8"))
                return "".join(segment[0] for segment in document[0] if segment[0])
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1.5 * (attempt + 1))
        return ""

    batches: list[list[str]] = []
    current: list[str] = []
    current_length = 0
    for value in values:
        estimated = len(value) + 12
        if current and (len(current) >= 30 or current_length + estimated > 3800):
            batches.append(current)
            current = []
            current_length = 0
        current.append(value)
        current_length += estimated
    if current:
        batches.append(current)

    def translate_batch(batch: list[str]) -> dict[str, str]:
        translations: dict[str, str] = {}
        payload = "\n".join(f"[{index:02d}] {value}" for index, value in enumerate(batch))
        translated_text = request_translation(payload)
        matches = list(
            re.finditer(r"\[(\d{2})\]\s*(.*?)(?=\n?\[\d{2}\]|$)", translated_text, re.DOTALL)
        )
        translated_indexes: set[int] = set()
        for match in matches:
            marker = int(match.group(1))
            if marker >= len(batch):
                continue
            translated_indexes.add(marker)
            source = batch[marker]
            translation = normalize_text(match.group(2)).rstrip("\u3002")
            if not CHINESE_PATTERN.search(translation):
                translation = normalize_text(request_translation(source)).rstrip("\u3002")
            translations[source] = translation
        for marker in range(len(batch)):
            if marker in translated_indexes:
                continue
            source = batch[marker]
            translations[source] = normalize_text(request_translation(source)).rstrip("\u3002")
        return translations

    translations: dict[str, str] = {}
    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(batches)))) as executor:
        futures = {executor.submit(translate_batch, batch): batch for batch in batches}
        for future in as_completed(futures):
            batch = futures[future]
            translations.update(future.result())
            completed += len(batch)
            print(f"Translated {completed}/{len(values)} vocabulary contexts...", flush=True)
    return translations


def enrich_context_translations(
    articles: list[dict[str, Any]],
    cache_path: Path,
    skip_translations: bool,
    translation_workers: int,
) -> None:
    entries = [entry for article in articles for entry in article["vocabulary"]]
    cache = load_translation_cache(cache_path)
    contexts = sorted({entry["context"] for entry in entries if entry["context"]})
    missing = [context for context in contexts if not cache.get(context)]
    if not skip_translations and missing:
        checkpoint_size = 250
        for start in range(0, len(missing), checkpoint_size):
            checkpoint = missing[start : start + checkpoint_size]
            cache.update(google_translate_batch(checkpoint, translation_workers))
            write_translation_cache(cache_path, cache)
            print(
                f"Saved context translations {min(start + checkpoint_size, len(missing))}/"
                f"{len(missing)}...",
                flush=True,
            )
    for entry in entries:
        entry["contextTranslation"] = cache.get(entry["context"], "")


def write_documents(output_root: Path, articles: list[dict[str, Any]]) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC).isoformat()
    grade_summaries: list[dict[str, int]] = []
    for grade in range(3, 13):
        grade_articles = [
            article
            for article in articles
            if int(article["articleId"].split("-g", 1)[1].split("-", 1)[0]) == grade
        ]
        vocabulary_count = sum(len(article["vocabulary"]) for article in grade_articles)
        grade_summaries.append(
            {"grade": grade, "articleCount": len(grade_articles), "vocabularyCount": vocabulary_count}
        )
        document = {
            "schemaVersion": 1,
            "generatedAt": now,
            "grade": grade,
            "articles": grade_articles,
        }
        (output_root / f"grade-{grade:02d}.json").write_text(
            json.dumps(document, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    total_vocabulary = sum(summary["vocabularyCount"] for summary in grade_summaries)
    articles_with_vocabulary = sum(bool(article["vocabulary"]) for article in articles)
    index = {
        "schemaVersion": 1,
        "generatedAt": now,
        "deduplicationScope": "commonlit-library",
        "deduplicationKey": "displayed-dictionary-headword",
        "articleCount": len(articles),
        "articlesWithVocabulary": articles_with_vocabulary,
        "totalVocabulary": total_vocabulary,
        "grades": grade_summaries,
        "items": [
            {
                "articleId": article["articleId"],
                "vocabularyCount": len(article["vocabulary"]),
            }
            for article in articles
        ],
    }
    (output_root / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"Wrote {total_vocabulary} globally unique vocabulary cards for "
        f"{articles_with_vocabulary}/{len(articles)} articles to {output_root}",
        flush=True,
    )


def main() -> None:
    args = parse_args()
    if not 1 <= args.words_per_article <= 30:
        raise SystemExit("--words-per-article must be between 1 and 30")
    articles = load_articles(args.reading_root.resolve())
    article_terms = [candidate_terms(article_text(article)) for article in articles]
    all_terms = set().union(*article_terms)
    document_frequency: Counter[str] = Counter()
    for terms in article_terms:
        document_frequency.update(terms)
    print(f"Loading {len(all_terms)} candidate terms from ECDICT...", flush=True)
    dictionary = load_dictionary(args.dictionary.resolve(), all_terms)
    print(f"ECDICT supplied {len(dictionary)} usable vocabulary terms.", flush=True)
    selected = select_vocabulary(
        articles, dictionary, document_frequency, args.words_per_article
    )
    enrich_context_translations(
        selected,
        args.translation_cache.resolve(),
        args.skip_context_translations,
        args.translation_workers,
    )
    write_documents(args.output_root.resolve(), selected)


if __name__ == "__main__":
    main()
