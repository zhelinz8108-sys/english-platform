"""Fill missing listening vocabulary, order by occurrence, and deduplicate.

Vocabulary already supplied by publishers is preserved and supplemented to
8-20 transcript-grounded words based on episode length. Dedupe is performed
within each episode and uses ECDICT's base-form metadata when available, so
inflections such as ``failed`` and ``fail`` share one key.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Enrich listening-library vocabulary.")
    parser.add_argument(
        "--library",
        type=Path,
        default=repository / "apps" / "web" / "data" / "listening-library.json",
    )
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument(
        "--context-cache",
        type=Path,
        default=repository / "apps" / "web" / "data" / "listening-context-translations.json",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=repository / "output" / "listening-vocabulary-enrichment-report.json",
    )
    parser.add_argument("--translate-contexts", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_builder() -> Any:
    path = Path(__file__).with_name("build-local-listening-library.py")
    spec = importlib.util.spec_from_file_location("listening_library_builder", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load listening builder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def occurrence_position(transcript: str, term: str, builder: Any) -> int:
    normalized = builder.normalize_text(transcript).casefold()
    positions: list[int] = []
    for variant in builder.vocabulary_search_terms(term):
        match = re.search(rf"\b{re.escape(variant)}\b", normalized, flags=re.IGNORECASE)
        if match:
            positions.append(match.start())
    if positions:
        return min(positions)
    for word in re.findall(r"[a-z][a-z'-]+", term.casefold()):
        match = builder.flexible_word_pattern(word).search(normalized)
        if match:
            positions.append(match.start())
    return min(positions) if positions else len(normalized) + 1


def base_form(term: str, row: dict[str, str] | None) -> str:
    normalized = " ".join(term.casefold().split()).strip(" -")
    if not row or " " in normalized:
        return normalized
    match = re.search(r"(?:^|/)0:([^/]+)", str(row.get("exchange") or ""))
    if match:
        candidate = " ".join(match.group(1).casefold().split()).strip(" -")
        if candidate:
            return candidate
    return normalized


def dictionary_ipa_for_term(
    term: str, dictionary: dict[str, dict[str, str]], builder: Any
) -> str:
    normalized = " ".join(term.casefold().split()).strip(" -")
    row = dictionary.get(normalized)
    ipa = builder.dictionary_ipa(str(row.get("phonetic") or "")) if row else ""
    if ipa:
        return ipa
    lemma = base_form(normalized, row)
    lemma_row = dictionary.get(lemma)
    ipa = (
        builder.dictionary_ipa(str(lemma_row.get("phonetic") or ""))
        if lemma_row
        else ""
    )
    if ipa:
        return ipa

    parts = re.findall(r"[a-z]+", normalized)
    if len(parts) < 2:
        return builder.american_ipa(normalized)
    part_ipas: list[str] = []
    for part in parts:
        part_row = dictionary.get(part)
        part_ipa = (
            builder.dictionary_ipa(str(part_row.get("phonetic") or ""))
            if part_row
            else builder.american_ipa(part)
        )
        if not part_ipa:
            return ""
        part_ipas.append(part_ipa.strip("/"))
    return f"/{' '.join(part_ipas)}/"


def target_count(transcript: str, builder: Any) -> int:
    word_count = len(builder.WORD_PATTERN.findall(transcript))
    if word_count <= 180:
        return 8
    if word_count <= 500:
        return 10
    if word_count <= 900:
        return 14
    if word_count <= 1_600:
        return 16
    return 20


def contains_chinese(value: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", value))


def candidate_pools(
    collection_items: list[dict[str, Any]], builder: Any
) -> dict[str, list[str]]:
    document_frequency: Counter[str] = Counter()
    transcripts = [str(item.get("transcript") or "") for item in collection_items]
    for transcript in transcripts:
        words = {
            match.group(0).casefold().strip("'-")
            for match in builder.WORD_PATTERN.finditer(transcript)
        }
        document_frequency.update(word for word in words if word)
    document_count = max(1, len([transcript for transcript in transcripts if transcript]))

    pools: dict[str, list[str]] = {}
    for item, transcript in zip(collection_items, transcripts, strict=True):
        frequencies: Counter[str] = Counter()
        first_position: dict[str, int] = {}
        for match in builder.WORD_PATTERN.finditer(transcript):
            original = match.group(0)
            word = original.casefold().strip("'-")
            if (
                word in builder.VOCABULARY_STOP_WORDS
                or len(word) < 5
            ):
                continue
            frequencies[word] += 1
            first_position.setdefault(word, match.start())

        title_words = {
            match.group(0).casefold().strip("'-")
            for match in builder.WORD_PATTERN.finditer(str(item.get("title") or ""))
        }
        quoted_words = {
            match.group(1).casefold()
            for match in re.finditer(r"['\"]([A-Za-z][A-Za-z'-]{3,})['\"]", transcript)
        }
        ranked: list[tuple[float, int, str]] = []
        for word, frequency in frequencies.items():
            inverse_document_frequency = math.log(
                (document_count + 1) / (document_frequency[word] + 1)
            )
            score = inverse_document_frequency * (1 + math.log(frequency))
            score += min(len(word), 14) / 20
            if word in title_words:
                score += 3.0
            if word in quoted_words:
                score += 2.0
            ranked.append((score, first_position[word], word))
        ranked.sort(key=lambda entry: (-entry[0], entry[1], entry[2]))
        pools[str(item["id"])] = [word for _, _, word in ranked]
    return pools


def atomic_json_write(path: Path, document: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.partial")
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def main() -> int:
    args = parse_args()
    builder = load_builder()
    library_path = args.library.resolve()
    dictionary_path = args.dictionary.resolve()
    if not library_path.is_file():
        raise SystemExit(f"Listening library is missing: {library_path}")
    if not dictionary_path.is_file():
        raise SystemExit(f"ECDICT dictionary is missing: {dictionary_path}")

    library = json.loads(library_path.read_text(encoding="utf-8"))
    items = list(library.get("items") or [])
    collections = [str(entry["id"]) for entry in library.get("collections") or []]
    if not items or not collections:
        raise SystemExit("Listening library has no items or collections.")

    original_empty_ids = {
        str(item["id"])
        for item in items
        if not isinstance(item.get("vocabulary"), list) or not item["vocabulary"]
    }
    items_by_collection: dict[str, list[dict[str, Any]]] = {
        collection: sorted(
            (item for item in items if item.get("collection") == collection),
            key=lambda item: int(item["sequence"]),
        )
        for collection in collections
    }

    pools: dict[str, list[str]] = {}
    for collection_items in items_by_collection.values():
        pools.update(candidate_pools(collection_items, builder))

    all_terms = {
        str(entry.get("word") or "").casefold()
        for item in items
        for entry in item.get("vocabulary") or []
        if entry.get("word")
    }
    all_terms.update(word for pool in pools.values() for word in pool)
    dictionary = builder.load_dictionary_rows(dictionary_path, all_terms)
    support_terms = {
        base_form(term, dictionary.get(term))
        for term in all_terms
        if " " not in term
    }
    support_terms.update(
        part
        for term in all_terms
        for part in re.findall(r"[a-z]+", term)
        if part != term
    )
    dictionary = builder.load_dictionary_rows(dictionary_path, all_terms | support_terms)

    removed_duplicates: Counter[str] = Counter()
    generated_counts: Counter[str] = Counter()
    empty_after: Counter[str] = Counter()
    removed_without_definition = 0
    for collection, collection_items in items_by_collection.items():
        for item in collection_items:
            seen: set[str] = set()
            transcript = str(item.get("transcript") or "")
            ordered = sorted(
                item.get("vocabulary") or [],
                key=lambda entry: occurrence_position(
                    transcript, str(entry.get("word") or ""), builder
                ),
            )
            unique: list[dict[str, Any]] = []
            for entry in ordered:
                term = str(entry.get("word") or "").casefold()
                if not contains_chinese(str(entry.get("definition") or "")):
                    removed_without_definition += 1
                    continue
                if not entry.get("ipa"):
                    entry["ipa"] = dictionary_ipa_for_term(term, dictionary, builder)
                key = base_form(term, dictionary.get(term))
                if not key or key in seen:
                    removed_duplicates[collection] += 1
                    continue
                seen.add(key)
                unique.append(entry)

            desired_count = target_count(transcript, builder)
            for word in pools[str(item["id"])]:
                if len(unique) >= desired_count:
                    break
                row = dictionary.get(word)
                part_of_speech, chinese = builder.parsed_chinese_definition(
                    str(row.get("translation") or "") if row else ""
                )
                if not row or not contains_chinese(chinese):
                    removed_without_definition += 1
                    continue
                ipa = dictionary_ipa_for_term(word, dictionary, builder)
                if not ipa:
                    continue
                key = base_form(word, row)
                if not key or key in seen:
                    continue
                context = builder.context_sentence(transcript, word)
                if not context:
                    continue
                seen.add(key)
                unique.append(
                    {
                        "word": word,
                        "ipa": ipa,
                        "partOfSpeech": part_of_speech
                        or builder.infer_part_of_speech(word, ""),
                        "definition": chinese,
                        "englishDefinition": "",
                        "context": context,
                        "contextTranslation": "",
                    }
                )
                generated_counts[collection] += 1

            unique.sort(
                key=lambda entry: occurrence_position(
                    transcript, str(entry.get("word") or ""), builder
                )
            )
            item["vocabulary"] = unique
            if not unique:
                empty_after[collection] += 1

    context_cache = builder.load_context_translation_cache(args.context_cache.resolve())
    contexts = {
        str(entry.get("context") or "")
        for item in items
        for entry in item.get("vocabulary") or []
        if entry.get("context")
    }
    missing_contexts = sorted(context for context in contexts if not context_cache.get(context))
    if args.translate_contexts and missing_contexts:
        checkpoint_size = 250
        for start in range(0, len(missing_contexts), checkpoint_size):
            checkpoint = missing_contexts[start : start + checkpoint_size]
            context_cache.update(
                builder.google_translate_batch(checkpoint, progress_label="listening contexts")
            )
            builder.write_context_translation_cache(args.context_cache.resolve(), context_cache)
            print(
                f"Saved context translations {min(start + checkpoint_size, len(missing_contexts))}/"
                f"{len(missing_contexts)}...",
                flush=True,
            )

    unresolved_contexts = 0
    for item in items:
        for entry in item.get("vocabulary") or []:
            context = str(entry.get("context") or "")
            translation = context_cache.get(context, "") if context else ""
            entry["contextTranslation"] = translation
            if context and not translation:
                unresolved_contexts += 1

    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "library": str(library_path),
        "originalEmptyItems": len(original_empty_ids),
        "removedWithoutDefinition": removed_without_definition,
        "missingContextTranslations": unresolved_contexts,
        "collections": {
            collection: {
                "items": len(collection_items),
                "generatedVocabulary": generated_counts[collection],
                "deduplicated": removed_duplicates[collection],
                "emptyAfter": empty_after[collection],
                "emptyItemIds": [
                    str(item["id"])
                    for item in collection_items
                    if not item.get("vocabulary")
                ],
                "totalVocabulary": sum(
                    len(item.get("vocabulary") or []) for item in collection_items
                ),
            }
            for collection, collection_items in items_by_collection.items()
        },
    }

    if not args.dry_run:
        library["generatedAt"] = datetime.now(UTC).isoformat()
        atomic_json_write(library_path, library)
        atomic_json_write(args.report.resolve(), report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
