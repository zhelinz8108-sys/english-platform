"""Extract Minute Earth transcripts and vocabulary from the combined PDF.

The parser uses PDF table geometry instead of relying on plain-text order. This
keeps vocabulary rows separate from the transcript even when both share a page.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pdfplumber


EPISODE_RE = re.compile(r"^(\d{3})\.\s+(.+)$")
METADATA_RE = re.compile(
    r"^Audio duration:\s*(\d+):(\d{2})\s*\|\s*Transcript words:\s*([\d,]+)$"
)
PAGE_RE = re.compile(r"^Page\s+\d+$")
HEADER_PREFIX = "MinuteEarth | Transcripts + TOEFL/SAT Vocabulary"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Minute Earth study content from the combined PDF."
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def object_inside_table(obj: dict[str, Any], table_boxes: list[tuple[float, ...]]) -> bool:
    if obj.get("object_type") != "char":
        return False
    x = (float(obj["x0"]) + float(obj["x1"])) / 2
    y = (float(obj["top"]) + float(obj["bottom"])) / 2
    return any(x0 <= x <= x1 and top <= y <= bottom for x0, top, x1, bottom in table_boxes)


def is_boilerplate(line: str, episode_sequence: int | None) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.startswith(HEADER_PREFIX) or PAGE_RE.match(stripped):
        return True
    if EPISODE_RE.match(stripped) or METADATA_RE.match(stripped):
        return True
    if stripped in {
        "TOEFL/SAT vocabulary - first appearance",
        "Word & IPA 中文释义",
        "Word & IPA",
        "中文释义",
    }:
        return True
    if stripped.lower().startswith("no new toefl/sat vocabulary"):
        return True
    if "没有首次出现的新 TOEFL/SAT 词汇" in stripped:
        return True
    return episode_sequence is None


def normalize_cell(value: str | None) -> str:
    if not value:
        return ""
    return "\n".join(part.strip() for part in value.splitlines() if part.strip())


def parse_vocabulary_row(left: str | None, right: str | None) -> dict[str, str] | None:
    left_text = normalize_cell(left)
    definition = normalize_cell(right)
    if not left_text or left_text == "Word & IPA" or not definition:
        return None
    parts = left_text.splitlines()
    ipa = ""
    if len(parts) > 1 and parts[-1].startswith("/"):
        ipa = parts.pop()
    word = " ".join(parts).strip()
    if not word:
        return None
    return {"word": word, "ipa": ipa, "definition": definition}


def append_page_transcript(
    episode: dict[str, Any], lines: list[dict[str, Any]], page_number: int
) -> None:
    cleaned: list[dict[str, Any]] = []
    for line in lines:
        text = str(line.get("text", "")).strip()
        if not is_boilerplate(text, int(episode["sequence"])):
            cleaned.append({**line, "text": text})
    if not cleaned:
        return

    blocks: list[str] = []
    current: list[str] = []
    previous_bottom: float | None = None
    for line in cleaned:
        top = float(line["top"])
        if previous_bottom is not None and top - previous_bottom > 5.5 and current:
            blocks.append(" ".join(current))
            current = []
        current.append(str(line["text"]))
        previous_bottom = float(line["bottom"])
    if current:
        blocks.append(" ".join(current))

    paragraphs: list[str] = episode["paragraphs"]
    for index, block in enumerate(blocks):
        if (
            index == 0
            and paragraphs
            and episode.get("lastTranscriptPage") != page_number
            and not re.search(r"[.!?][\"']?$", paragraphs[-1])
        ):
            paragraphs[-1] = f"{paragraphs[-1]} {block}"
        else:
            paragraphs.append(block)
    episode["lastTranscriptPage"] = page_number


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_file():
        raise SystemExit(f"PDF does not exist: {source}")

    episodes: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    with pdfplumber.open(source) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            raw_lines = page.extract_text_lines()
            title_lines: list[tuple[int, dict[str, Any], re.Match[str]]] = []
            for index, line in enumerate(raw_lines):
                match = EPISODE_RE.match(str(line.get("text", "")).strip())
                if match:
                    title_lines.append((index, line, match))

            segments: list[dict[str, Any]] = []
            segment_top = 0.0
            segment_episode = current
            segment_content_top = 0.0
            for title_index, title_line, title_match in title_lines:
                title_top = float(title_line["top"])
                if segment_episode is not None and title_top > segment_top:
                    segments.append(
                        {
                            "top": segment_top,
                            "bottom": title_top,
                            "episode": segment_episode,
                            "contentTop": segment_content_top,
                        }
                    )

                sequence = int(title_match.group(1))
                title_parts = [title_match.group(2).strip()]
                metadata_match: re.Match[str] | None = None
                heading_bottom = float(title_line["bottom"])
                for following in raw_lines[title_index + 1 :]:
                    following_top = float(following["top"])
                    next_title = EPISODE_RE.match(str(following.get("text", "")).strip())
                    if next_title:
                        break
                    following_text = str(following.get("text", "")).strip()
                    possible_metadata = METADATA_RE.match(following_text)
                    if possible_metadata:
                        metadata_match = possible_metadata
                        continue
                    if following_text == "TOEFL/SAT vocabulary - first appearance":
                        heading_bottom = float(following["bottom"])
                        break
                    if metadata_match is None and following_top > title_top and following_text:
                        title_parts.append(following_text)

                current = {
                    "sequence": sequence,
                    "title": " ".join(title_parts),
                    "durationSeconds": None,
                    "transcriptWordCount": None,
                    "vocabulary": [],
                    "paragraphs": [],
                    "lastTranscriptPage": None,
                }
                if metadata_match:
                    current["durationSeconds"] = int(metadata_match.group(1)) * 60 + int(
                        metadata_match.group(2)
                    )
                    current["transcriptWordCount"] = int(
                        metadata_match.group(3).replace(",", "")
                    )
                episodes.append(current)
                segment_episode = current
                segment_top = title_top
                segment_content_top = heading_bottom

            if title_lines:
                segments.append(
                    {
                        "top": segment_top,
                        "bottom": float(page.height),
                        "episode": segment_episode,
                        "contentTop": segment_content_top,
                    }
                )
            elif current is not None:
                segments.append(
                    {
                        "top": 0.0,
                        "bottom": float(page.height),
                        "episode": current,
                        "contentTop": 0.0,
                    }
                )

            tables = page.find_tables()
            table_boxes = [table.bbox for table in tables]
            filtered = page.filter(lambda obj: not object_inside_table(obj, table_boxes))
            filtered_lines = filtered.extract_text_lines()

            for segment in segments:
                episode = segment["episode"]
                top = float(segment["top"])
                bottom = float(segment["bottom"])
                content_top = float(segment["contentTop"])
                for table in tables:
                    table_top = float(table.bbox[1])
                    if not (top <= table_top < bottom):
                        continue
                    for row in table.extract() or []:
                        if len(row) < 2:
                            continue
                        entry = parse_vocabulary_row(row[0], row[1])
                        if entry:
                            episode["vocabulary"].append(entry)

                segment_lines = [
                    line
                    for line in filtered_lines
                    if content_top < float(line["top"]) < bottom
                ]
                append_page_transcript(episode, segment_lines, page_number)

            if page_number % 50 == 0:
                print(f"Processed {page_number}/{len(pdf.pages)} PDF pages...", flush=True)

    expected = list(range(1, 271))
    actual = [int(episode["sequence"]) for episode in episodes]
    if actual != expected:
        missing = sorted(set(expected) - set(actual))
        duplicates = sorted({value for value in actual if actual.count(value) > 1})
        raise SystemExit(
            f"Episode validation failed: count={len(actual)}, missing={missing}, duplicates={duplicates}"
        )

    for episode in episodes:
        episode["transcript"] = "\n\n".join(episode.pop("paragraphs")).strip()
        episode.pop("lastTranscriptPage", None)
        if not episode["transcript"]:
            raise SystemExit(f"Episode {episode['sequence']:03d} has no transcript")
        if episode["durationSeconds"] is None or episode["transcriptWordCount"] is None:
            raise SystemExit(f"Episode {episode['sequence']:03d} has no metadata")

    source_bytes = source.read_bytes()
    result = {
        "schemaVersion": 1,
        "source": {
            "fileName": source.name,
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
        },
        "episodes": episodes,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".partial")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(output)

    vocabulary_count = sum(len(episode["vocabulary"]) for episode in episodes)
    print(
        f"Extracted {len(episodes)} episodes and {vocabulary_count} vocabulary rows to {output}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
