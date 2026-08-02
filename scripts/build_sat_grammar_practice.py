#!/usr/bin/env python3
"""Build the complete SAT grammar interactive-practice catalog.

All 985 deduplicated source records are published as native, selectable web
content.  PDF/image questions are OCRed from the pipeline's answer-free v7
workbook crops; native DOCX/HTML questions are parsed from their text surface.
No question screenshot is shipped to the web application.

Run from the repository root.  Pass ``--source-root`` when the SAT source tree
is not at its default Windows location.  Tesseract OCR with English language
data is required for the image-backed source records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from PIL import Image


DEFAULT_SOURCE_ROOT = Path("D:/BaiduNetdiskDownload/SAT真题")
DEFAULT_OUTPUT_DIR = Path("apps/web/public/content/sat-grammar/questions")
DEFAULT_CATALOG = Path("apps/web/data/sat-grammar-practice.json")
DEFAULT_CACHE_DIR = Path("tmp/pdfs/sat-grammar-ocr")
DEFAULT_OFFICIAL_CATALOG = Path("scripts/data/sat-grammar-official-questions.json")
RELIABLE_ANSWER_STATUSES = {"original_answer", "inferred_duplicate"}
ANSWERS = {"A", "B", "C", "D"}

CATEGORY_TO_ENTRY = {
    "主语与谓语之间的标点": "commas-parentheticals",
    "句界与独立分句": "clause-boundaries",
    "插入语与补充成分": "commas-parentheticals",
    "标点选择": "semicolons-colons-dashes",
    "主谓一致": "subject-verb-agreement",
    "代词指代与格": "pronouns",
    "修饰语": "modifiers",
    "动词形式": "verb-forms",
    "动词时态": "tense-voice-mood",
    "句法与语意完整性": "syntax-completeness",
    "平行结构": "parallelism",
    "所有格与撇号": "possessives-apostrophes",
    "比较结构": "comparisons",
}

ANSWER_MARKER = re.compile(
    r"(?:Correct\s+Answer|Answer|答案)\s*[:：]\s*([A-D])",
    re.IGNORECASE,
)
OPTION_MARKER = re.compile(
    r"(?ms)^\s*(?:[-•]\s*)?([A-D])[.\)]\s*(.+?)(?=^\s*(?:[-•]\s*)?[A-D][.\)]\s|\Z)"
)
GRAMMAR_PROMPT = re.compile(
    r"Which\s+choice\s+completes\s+the\s+text\s+so\s+that\s+it\s+conforms\s+to\s+the\s+conventions\s+of\s+Standard\s+English\?",
    re.IGNORECASE,
)
LOOSE_GRAMMAR_PROMPT = re.compile(
    r"Which\s+choice\s+completes\s+th\s*e?\s*text\s+so\s+th\s*at\s+it\s+conforms"
    r".*?Standard\s+Eng[lI]ish\s*[?？]?",
    re.IGNORECASE | re.DOTALL,
)
STANDARD_PROMPT = (
    "Which choice completes the text so that it conforms to the conventions of Standard English?"
)
NATIVE_GRAMMAR_QUESTION = re.compile(
    r"(?is)(?:^|\n)\s*(?:\d+\.)?\s*"
    r"(?P<prompt>Which\s+choice\s+completes\s+the\s+text\s+so\s+that\s+it\s+conforms\s+to\s+the\s+conventions\s+of\s+Standard\s+English\?)"
    r"\s*(?P<passage>.*?)"
    r"\s*A\.\s*(?P<a>.*?)\s*B\.\s*(?P<b>.*?)\s*C\.\s*(?P<c>.*?)\s*D\.\s*(?P<d>.*?)"
    r"\s*(?:Answer|答案)\s*[:：]\s*(?P<answer>[A-D])",
)
EXPLICIT_OPTION = re.compile(
    r"^\s*([A-Da-d])(?:[.\)]|\s|$|(?=[a-z“\"']))\s*(.*)$"
)
QUESTION_NUMBER = re.compile(r"^(?:Question\s+)?\d+(?:\s+of\s+\d+)?[.:]?$", re.IGNORECASE)

NOISE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"^Assessment$",
        r"^Test$",
        r"^Domain$",
        r"^Skill$",
        r"^Difficulty$",
        r"^SAT$",
        r"^Reading and Writing",
        r"^Standard English Conventions$",
        r"^Section \d",
        r"^Directions\b",
        r"Highlights\s*&\s*Notes",
        r"Mark for Review",
        r"^A[-+]$",
        r"^Back$",
        r"^Next$",
        r"^Question \d+ of \d+",
        r"Property of ",
        r"Property [o0]f ",
        r"Page \d+",
        r"primacy\.org",
        r"examexperter",
        r"fluxx",
        r"扫\s*描",
        r"答案已锁定",
        r"^Untitled\b",
        r"Search or enter website",
    )
]


@dataclass(frozen=True)
class OcrWord:
    text: str
    confidence: float
    left: int
    top: int
    width: int
    height: int
    block: int
    paragraph: int
    line: int

    @property
    def right(self) -> int:
        return self.left + self.width

    @property
    def bottom(self) -> int:
        return self.top + self.height


@dataclass
class OcrLine:
    words: list[OcrWord]

    @property
    def left(self) -> int:
        return min(word.left for word in self.words)

    @property
    def right(self) -> int:
        return max(word.right for word in self.words)

    @property
    def top(self) -> int:
        return min(word.top for word in self.words)

    @property
    def bottom(self) -> int:
        return max(word.bottom for word in self.words)

    @property
    def confidence(self) -> float:
        return sum(word.confidence for word in self.words) / len(self.words)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument(
        "--official-catalog", type=Path, default=DEFAULT_OFFICIAL_CATALOG
    )
    parser.add_argument("--tesseract", type=Path)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--refresh-ocr", action="store_true")
    return parser.parse_args()


def workbook_crop(source_root: Path, item: dict[str, Any]) -> Path | None:
    question_asset = str(item.get("question_asset") or "")
    if not question_asset:
        return None
    asset_key = hashlib.sha1(question_asset.encode("utf-8")).hexdigest()[:10]
    crop = (
        source_root
        / "tmp/pdfs/workbook_crops"
        / f"{item['id']}_{asset_key}_question_v7.jpg"
    )
    if not crop.exists():
        raise FileNotFoundError(f"Missing answer-free question crop: {crop}")
    return crop


def compact_text(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\r", "")
    value = re.sub(r"(?m)^\s*[-•]\s?", "", value)
    value = re.sub(r"(?im)^\s*blank\s*$", "_____", value)
    value = re.sub(r"_{3,}\s+blank\b", "_____", value, flags=re.IGNORECASE)
    value = re.sub(r"\bblank\b", "_____", value, flags=re.IGNORECASE)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def native_question_surface(item: dict[str, Any]) -> tuple[str, list[str]]:
    """Extract the first complete Standard English question from native text."""
    text = str(item.get("ocr_text") or "")
    match = NATIVE_GRAMMAR_QUESTION.search(text)
    if match:
        passage = compact_text(match.group("passage"))
        prompt = compact_text(match.group("prompt"))
        options = [compact_text(match.group(key)) for key in ("a", "b", "c", "d")]
        return compact_text(f"{passage}\n\n{prompt}"), options

    marker = ANSWER_MARKER.search(text)
    surface = compact_text(text[: marker.start()] if marker else text)
    matches = list(OPTION_MARKER.finditer(surface))
    if [match.group(1).upper() for match in matches[-4:]] == ["A", "B", "C", "D"]:
        matches = matches[-4:]
        prompt = compact_text(surface[: matches[0].start()])
        options = [compact_text(match.group(2)) for match in matches]
        return prompt, options
    return surface, []


def resolve_tesseract(explicit: Path | None) -> Path:
    candidates = [
        explicit,
        Path(shutil.which("tesseract") or ""),
        Path("C:/Program Files/Tesseract-OCR/tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate and str(candidate) not in {"", "."} and candidate.exists():
            return candidate
    raise FileNotFoundError("Tesseract OCR was not found. Install it with English language data.")


def resolve_pdftoppm() -> Path | None:
    candidates = [
        Path(
            "C:/Users/zheli/.cache/codex-runtimes/codex-primary-runtime/"
            "dependencies/native/poppler/Library/bin/pdftoppm.exe"
        ),
        Path(shutil.which("pdftoppm.exe") or ""),
    ]
    for candidate in candidates:
        if candidate and str(candidate) not in {"", "."} and candidate.exists():
            return candidate
    return None


def read_or_run_ocr(
    item_id: str,
    crop: Path,
    tesseract: Path,
    cache_dir: Path,
    refresh: bool,
    psm: int = 6,
) -> tuple[int, int, list[OcrWord]]:
    cache_file = cache_dir / (f"{item_id}.json" if psm == 6 else f"{item_id}-psm{psm}.json")
    source_signature = f"{crop.stat().st_size}:{crop.stat().st_mtime_ns}"
    if cache_file.exists() and not refresh:
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        if cached.get("sourceSignature") == source_signature:
            return (
                int(cached["width"]),
                int(cached["height"]),
                [OcrWord(**word) for word in cached["words"]],
            )

    command = [
        str(tesseract),
        str(crop),
        "stdout",
        "-l",
        "eng",
        "--psm",
        str(psm),
        "tsv",
    ]
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    words: list[OcrWord] = []
    for raw_row in completed.stdout.splitlines()[1:]:
        columns = raw_row.split("\t", 11)
        if len(columns) != 12 or columns[0] != "5" or not columns[11].strip():
            continue
        words.append(
            OcrWord(
                text=columns[11].strip(),
                confidence=float(columns[10]),
                left=int(columns[6]),
                top=int(columns[7]),
                width=int(columns[8]),
                height=int(columns[9]),
                block=int(columns[2]),
                paragraph=int(columns[3]),
                line=int(columns[4]),
            )
        )
    with Image.open(crop) as image:
        width, height = image.size
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(
            {
                "sourceSignature": source_signature,
                "width": width,
                "height": height,
                "words": [word.__dict__ for word in words],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return width, height, words


def group_tesseract_lines(words: Iterable[OcrWord]) -> list[OcrLine]:
    grouped: dict[tuple[int, int, int], list[OcrWord]] = {}
    for word in words:
        grouped.setdefault((word.block, word.paragraph, word.line), []).append(word)
    lines = [OcrLine(sorted(group, key=lambda word: word.left)) for group in grouped.values()]
    return sorted(lines, key=lambda line: (line.top, line.left))


def split_lines_at(lines: list[OcrLine], split_x: int, side: str) -> list[OcrLine]:
    result: list[OcrLine] = []
    for line in lines:
        selected = [
            word
            for word in line.words
            if (word.left + word.right) / 2 < split_x
            if side == "left"
        ] if side == "left" else [
            word for word in line.words if (word.left + word.right) / 2 >= split_x
        ]
        if selected:
            result.append(OcrLine(selected))
    return sorted(result, key=lambda line: (line.top, line.left))


def render_line(line: OcrLine, detect_blank: bool = False) -> str:
    words = sorted(line.words, key=lambda word: word.left)
    pieces: list[str] = []
    char_widths = [word.width / max(len(word.text), 1) for word in words if word.width > 0]
    average_char_width = median(char_widths) if char_widths else 8
    # Printed SAT blanks are often only three to five ems wide.  A looser
    # threshold still clears ordinary inter-word spacing while preserving the
    # answer slot that Tesseract commonly omits at line level.
    blank_gap = max(26, average_char_width * 2.8)
    previous: OcrWord | None = None
    for word in words:
        if previous and detect_blank and word.left - previous.right > blank_gap:
            pieces.append("_____")
        pieces.append(word.text)
        previous = word
    return compact_text(" ".join(pieces))


def is_noise(text: str) -> bool:
    compact = compact_text(text)
    if not compact:
        return True
    if any(pattern.search(compact) for pattern in NOISE_PATTERNS):
        return True
    alphanumeric = sum(character.isalnum() for character in compact)
    return alphanumeric == 0 or (alphanumeric < 2 and len(compact) > 2)


def clean_option(value: str) -> str:
    value = compact_text(value)
    value = re.split(
        r"(?is)(?:\bID\s*:.*?\bAnswer\b|\bRationale\b|"
        r"\b(?:Correct\s+)?Answer\s*(?:[:：]|$)|\bWhich\s+choice\s+completes|"
        r"\bQuestion\s+ID\b|\bUnauthorized\s+copying\b|\bCONTINUE\b|"
        r"(?:^|\n)\s*\d+\s*[.·]\s*|答案\s*[:：]|解析\s*[:：])",
        value,
        maxsplit=1,
    )[0]
    value = re.sub(r"^[^A-Za-z0-9'\"“‘]+", "", value)
    value = re.sub(r"^[‘’]\s*(?=[A-Za-z])", "", value)
    value = re.sub(r"^[A-Da-d][.)]\s*", "", value)
    value = re.sub(r"^(?:[|©®@()\[\]{}<>j¢Q»«]+\s*)+", "", value)
    value = re.sub(r"^(?:[A-Da-d]|8|Cc?)(?:[.)]|\s)+", "", value)
    value = re.sub(r"^[.—]+\s+(?=[A-Za-z])", "", value)
    value = re.sub(r"\s*[|}\]]\s*$", "", value)
    value = value.replace(" ，", ",").replace(" ；", ";").replace(" ：", ":")
    return compact_text(value)


def prompt_anchor(lines: list[OcrLine]) -> OcrLine | None:
    for line in lines:
        for index, word in enumerate(line.words):
            if re.sub(r"[^a-z]", "", word.text.lower()) != "which":
                continue
            candidate = OcrLine(line.words[index:])
            normalized = re.sub(r"[^a-z]", "", render_line(candidate).lower())
            if "whichchoicecompletesthetext" in normalized:
                return candidate
    return None


def prompt_anchors(lines: list[OcrLine]) -> list[OcrLine]:
    """Return every Standard English prompt in visual reading order."""
    anchors: list[OcrLine] = []
    for line in lines:
        for index, word in enumerate(line.words):
            if re.sub(r"[^a-z]", "", word.text.lower()) != "which":
                continue
            candidate = OcrLine(line.words[index:])
            normalized = re.sub(r"[^a-z]", "", render_line(candidate).lower())
            if "whichchoicecompletesthetext" in normalized:
                anchors.append(candidate)
                break
    return sorted(anchors, key=lambda anchor: (anchor.top, anchor.left))


def select_body_lines(lines: list[OcrLine], prompt: OcrLine) -> list[OcrLine]:
    candidates = [
        line
        for line in lines
        if line.top < prompt.bottom + 120
        and not is_noise(render_line(line))
        and not GRAMMAR_PROMPT.search(render_line(line))
        and not render_line(line).lower().startswith("standard english")
        and not re.search(r"question\s+id", render_line(line), re.IGNORECASE)
        and not re.match(r"^ID\s*:", render_line(line), re.IGNORECASE)
        and not QUESTION_NUMBER.match(render_line(line))
    ]
    candidates = [line for line in candidates if line.top < prompt.top or line.left < prompt.left]
    if not candidates:
        return []

    heights = [line.bottom - line.top for line in candidates]
    gap_limit = max(82, (median(heights) if heights else 20) * 4.2)
    clusters: list[list[OcrLine]] = []
    for line in sorted(candidates, key=lambda candidate: (candidate.top, candidate.left)):
        if not clusters or line.top - max(member.bottom for member in clusters[-1]) > gap_limit:
            clusters.append([line])
        else:
            clusters[-1].append(line)
    return min(
        clusters,
        key=lambda cluster: (
            abs(max(line.bottom for line in cluster) - prompt.top),
            -sum(len(render_line(line)) for line in cluster),
        ),
    )


def render_body(lines: list[OcrLine]) -> str:
    if not lines:
        return ""
    ordered = sorted(lines, key=lambda line: (line.top, line.left))
    heights = [line.bottom - line.top for line in ordered]
    paragraph_gap = max(55, (median(heights) if heights else 18) * 2.6)
    paragraphs: list[list[str]] = [[]]
    previous: OcrLine | None = None
    for line in ordered:
        if previous and line.top - previous.bottom > paragraph_gap:
            paragraphs.append([])
        paragraphs[-1].append(render_line(line, detect_blank=True))
        previous = line
    return compact_text("\n\n".join(" ".join(part) for part in paragraphs if part))


def collect_instruction(lines: list[OcrLine], anchor: OcrLine) -> tuple[str, int]:
    nearby = sorted(
        [
            line
            for line in lines
            if line.top >= anchor.top - 8
            and line.top <= anchor.top + 70
            and line.left >= anchor.left - 80
        ],
        key=lambda line: (line.top, line.left),
    )
    instruction_lines: list[OcrLine] = []
    for line in nearby:
        instruction_lines.append(line)
        joined = " ".join(render_line(member) for member in instruction_lines)
        normalized = re.sub(r"[^a-z]", "", joined.lower())
        if "standardenglish" in normalized:
            break
    end_y = max((line.bottom for line in instruction_lines), default=anchor.bottom)
    return STANDARD_PROMPT, end_y


def explicit_options(lines: list[OcrLine], instruction_end: int) -> list[str]:
    eligible = [
        line
        for line in lines
        if line.top > instruction_end - 4
        and line.confidence >= 20
        and not is_noise(render_line(line))
    ]
    starts: list[tuple[int, str, str]] = []
    for index, line in enumerate(eligible):
        text = compact_text(render_line(line))
        marker_surface = re.sub(r"^(?:[|©®@Oo0()\[\]{}<>j¢Q»«]+\s*)+", "", text)
        marker = EXPLICIT_OPTION.match(marker_surface)
        if marker:
            starts.append((index, marker.group(1).upper(), marker.group(2)))
    for offset in range(max(0, len(starts) - 7), len(starts) - 3):
        window = starts[offset : offset + 4]
        if [entry[1] for entry in window] != ["A", "B", "C", "D"]:
            continue
        options: list[str] = []
        for option_index, (line_index, _, initial) in enumerate(window):
            next_index = window[option_index + 1][0] if option_index < 3 else len(eligible)
            continuation = [render_line(line) for line in eligible[line_index + 1 : next_index]]
            option = clean_option(" ".join([initial, *continuation]))
            options.append(option)
        if all(options):
            return options
    return []


def markerless_options(lines: list[OcrLine], instruction_end: int) -> list[str]:
    eligible = [
        line
        for line in lines
        if line.top > instruction_end + 8
        and line.confidence >= 20
        and not is_noise(render_line(line))
    ]
    cleaned: list[tuple[OcrLine, str]] = []
    for line in eligible:
        value = clean_option(render_line(line))
        alphanumeric = sum(character.isalnum() for character in value)
        if (
            (
                alphanumeric >= 3
                or re.fullmatch(
                    r"(?:am|be|do|go|he|I|is|it|we)", value.strip(), re.IGNORECASE
                )
            )
            and not value.lower().startswith(
                ("question ", "correct answer", "mark for review")
            )
        ):
            cleaned.append((line, value))
    if len(cleaned) < 4:
        return []

    # SAT grammar replacements are overwhelmingly one visual text row each;
    # radio-button boxes themselves create only a small vertical gap, so gap
    # based merging incorrectly joins adjacent answer choices.
    candidates = [value for _, value in cleaned if value]
    return candidates[:4] if len(candidates) >= 4 else []


def windows_ocr_lines(item: dict[str, Any]) -> list[OcrLine]:
    result: list[OcrLine] = []
    scale = float(item.get("ocr_coordinate_scale") or 1.0)
    for line_index, source_line in enumerate(item.get("ocr_lines") or []):
        words: list[OcrWord] = []
        for word_index, source_word in enumerate(source_line.get("words") or []):
            text = str(source_word.get("text") or "").strip()
            if not text:
                continue
            words.append(
                OcrWord(
                    text=text,
                    confidence=90,
                    left=round(float(source_word.get("x") or 0) * scale),
                    top=round(float(source_word.get("y") or 0) * scale),
                    width=round(float(source_word.get("width") or 0) * scale),
                    height=round(float(source_word.get("height") or 0) * scale),
                    block=0,
                    paragraph=0,
                    line=line_index * 100 + word_index,
                )
            )
        if words:
            result.append(OcrLine(words))
    return sorted(result, key=lambda line: (line.top, line.left))


def coordinate_option_candidates(item: dict[str, Any], width: int) -> list[str]:
    lines = windows_ocr_lines(item)
    anchor = prompt_anchor(lines)
    if not anchor:
        return []
    region = (
        split_lines_at(lines, int(width * 0.5), "right")
        if anchor.left > width * 0.42
        else lines
    )
    anchor = prompt_anchor(region) or anchor
    _, instruction_end = collect_instruction(region, anchor)
    candidates: list[str] = []
    for line in region:
        if line.top <= instruction_end + 6:
            continue
        text = render_line(line)
        if is_noise(text):
            continue
        marker_surface = re.sub(
            r"^(?:[|©®@Oo0()\[\]{}<>j¢Q»«]+\s*)+", "", text
        )
        if re.fullmatch(r"[A-Da-d8](?:[.)])?", marker_surface.strip()):
            continue
        value = clean_option(marker_surface)
        lowered = value.lower()
        if (
            value
            and not lowered.startswith(("question ", "correct answer"))
            and "property" not in lowered
            and "scan" not in lowered
            and "扫" not in value
        ):
            candidates.append(value)
    return candidates[:4] if len(candidates) >= 4 else []


def source_option_candidates(item: dict[str, Any]) -> list[str]:
    raw = list(item.get("options") or [])
    if len(raw) != 4:
        return []
    options: list[str] = []
    for value in raw:
        value = re.split(
            r"(?:Correct\s+Answer|Answer|答案)\s*[:：]",
            str(value),
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        options.append(clean_option(value))
    return options if all(options) else []


def image_question_surface(
    item: dict[str, Any], width: int, words: list[OcrWord]
) -> tuple[str, list[str]]:
    lines = group_tesseract_lines(words)
    anchor = prompt_anchor(lines)
    if not anchor:
        raise ValueError("grammar prompt was not detected")

    two_column = anchor.left > width * 0.42
    if two_column:
        split_x = int(width * 0.5)
        body_region = split_lines_at(lines, split_x, "left")
        answer_region = split_lines_at(lines, split_x, "right")
        answer_anchor = prompt_anchor(answer_region) or anchor
    else:
        body_region = lines
        answer_region = lines
        answer_anchor = anchor

    body = render_body(select_body_lines(body_region, answer_anchor))
    instruction, instruction_end = collect_instruction(answer_region, answer_anchor)
    options = explicit_options(answer_region, instruction_end)
    if len(options) != 4:
        options = markerless_options(answer_region, instruction_end)
    coordinate_options = coordinate_option_candidates(item, width)
    if len(coordinate_options) == 4:
        options = coordinate_options
    if len(options) != 4:
        options = source_option_candidates(item)
    question_text = compact_text(f"{body}\n\n{instruction}")
    return question_text, options


def asset_question_index(item: dict[str, Any]) -> int:
    match = re.search(r"_q(\d+)\.[^.]+$", str(item.get("question_asset") or ""))
    return int(match.group(1)) if match else 1


def alternate_question_assets(source_root: Path, item: dict[str, Any]) -> list[Path]:
    """Return the richer legacy crop followed by nearby continuation crops."""
    question_asset = str(item.get("question_asset") or "")
    if not question_asset:
        return []
    relative = Path(question_asset)
    source_asset = source_root / relative
    match = re.match(
        r"^(?P<prefix>.*_p)(?P<page>\d+)(?:_seg_v5)?_q(?P<question>\d+)\.jpg$",
        source_asset.name,
        re.IGNORECASE,
    )
    if not match:
        return [source_asset] if source_asset.exists() else []

    prefix = match.group("prefix")
    page_digits = match.group("page")
    page = int(page_digits)
    question = int(match.group("question"))
    candidates: list[Path] = []
    for question_number in range(question, question + 4):
        candidate = source_asset.with_name(
            f"{prefix}{page:0{len(page_digits)}d}_q{question_number:02d}.jpg"
        )
        if candidate.exists():
            candidates.append(candidate)
    for next_page in range(page + 1, page + 3):
        for question_number in range(1, 5):
            candidate = source_asset.with_name(
                f"{prefix}{next_page:0{len(page_digits)}d}_q{question_number:02d}.jpg"
            )
            if candidate.exists():
                candidates.append(candidate)
            elif question_number == 1:
                break
        if candidates and any(f"_p{next_page:0{len(page_digits)}d}_" in path.name for path in candidates):
            break
    return candidates[:6]


def first_question_asset(source_root: Path, item: dict[str, Any]) -> Path | None:
    question_asset = str(item.get("question_asset") or "")
    if not question_asset:
        return None
    relative = Path(question_asset)
    source_asset = source_root / relative
    match = re.match(
        r"^(?P<prefix>.*_p)(?P<page>\d+)(?:_seg_v5)?_q\d+\.jpg$",
        source_asset.name,
        re.IGNORECASE,
    )
    if not match:
        return None
    candidate = source_asset.with_name(
        f"{match.group('prefix')}{match.group('page')}_q01.jpg"
    )
    return candidate if candidate.exists() else None


def full_page_asset(source_root: Path, item: dict[str, Any]) -> Path | None:
    question_asset = str(item.get("question_asset") or "")
    if not question_asset:
        return None
    relative = Path(question_asset)
    source_asset = source_root / relative
    name = re.sub(r"_seg_v5_q\d+(?=\.jpg$)", "", source_asset.name)
    name = re.sub(r"_q\d+(?=\.jpg$)", "", name)
    candidate = source_asset.with_name(name)
    return candidate if candidate.exists() else None


def ocr_text_for_asset(
    asset: Path,
    tesseract: Path,
    cache_dir: Path,
    refresh: bool,
    psm: int = 6,
) -> str:
    cache_key = f"asset-{hashlib.sha1(str(asset).encode('utf-8')).hexdigest()[:16]}"
    _, _, words = read_or_run_ocr(
        cache_key, asset, tesseract, cache_dir, refresh, psm=psm
    )
    return "\n".join(render_line(line) for line in group_tesseract_lines(words))


def parse_text_question_surface(
    current_text: str,
    continuation_texts: Iterable[str] = (),
) -> tuple[str, list[str]] | None:
    """Parse one complete question from OCR text, including a later-page tail."""
    full_text = "\n".join([current_text, *continuation_texts])
    current_length = len(current_text)
    marker_pattern = re.compile(r"(?<![A-Za-z])([A-D])(?:[.)]|(?=\s))\s+", re.IGNORECASE)
    for prompt_match in LOOSE_GRAMMAR_PROMPT.finditer(full_text):
        if prompt_match.start() > current_length + 3:
            continue
        after_prompt = full_text[prompt_match.end() :]
        answer_match = re.search(
            r"\b(?:Correct\s+)?Answer\s*[:：]\s*[A-D]",
            after_prompt,
            re.IGNORECASE,
        )
        question_segment = (
            after_prompt[: answer_match.start()] if answer_match else after_prompt
        )
        markers = list(marker_pattern.finditer(question_segment))
        for offset in range(0, len(markers) - 3):
            window = markers[offset : offset + 4]
            if len(window) < 4:
                break
            if [marker.group(1).upper() for marker in window] != ["A", "B", "C", "D"]:
                continue
            choices: list[str] = []
            for choice_index, marker in enumerate(window):
                end = (
                    window[choice_index + 1].start()
                    if choice_index < 3
                    else len(question_segment)
                )
                choice = question_segment[marker.end() : end]
                choice = re.split(r"Options\s*:", choice, maxsplit=1, flags=re.IGNORECASE)[0]
                choice = re.split(
                    r"\b\d+\s*[.·]\s*Which\s+choice",
                    choice,
                    maxsplit=1,
                    flags=re.IGNORECASE,
                )[0]
                choices.append(clean_option(choice))
            passage_after_prompt = compact_text(question_segment[: window[0].start()])
            before_prompt = full_text[: prompt_match.start()]
            before_prompt = re.split(
                r"\b(?:Correct\s+)?Answer\s*[:：]\s*[A-D]",
                before_prompt,
                flags=re.IGNORECASE,
            )[-1]
            passage_before_prompt = compact_text(before_prompt)
            passage = (
                passage_after_prompt
                if sum(character.isalpha() for character in passage_after_prompt) >= 20
                else passage_before_prompt
            )
            passage = re.sub(r"(?is)^.*?\b\d+\.\s*题目\s*", "", passage)
            passage = re.sub(r"(?is)^.*?\bDocument\s+", "", passage)
            id_markers = list(
                re.finditer(r"\bID\s*:\s*[A-Za-z0-9()]+\s*", passage, re.IGNORECASE)
            )
            if id_markers:
                passage = passage[id_markers[-1].end() :]
            passage = compact_text(passage)
            if len(passage) >= 20 and len(choices) == 4 and all(choices):
                return compact_text(f"{passage}\n\n{STANDARD_PROMPT}"), choices
    return None


def alternate_asset_surface(
    item: dict[str, Any],
    source_root: Path,
    tesseract: Path,
    cache_dir: Path,
    refresh: bool,
) -> tuple[str, list[str]] | None:
    assets = alternate_question_assets(source_root, item)
    if assets:
        texts = [
            ocr_text_for_asset(asset, tesseract, cache_dir, refresh)
            for asset in assets
        ]
        parsed = parse_text_question_surface(texts[0], texts[1:])
        if parsed:
            return parsed

    raw_text = str(item.get("ocr_text") or "")
    if re.search(r"(?:Correct\s+Answer|Rationale)", raw_text, re.IGNORECASE):
        first_asset = first_question_asset(source_root, item)
        if first_asset:
            first_text = ocr_text_for_asset(
                first_asset, tesseract, cache_dir, refresh
            )
            parsed = parse_text_question_surface(first_text)
            if parsed:
                return parsed
    return parse_text_question_surface(raw_text)


def full_page_surface(
    item: dict[str, Any],
    source_root: Path,
    tesseract: Path,
    cache_dir: Path,
    refresh: bool,
) -> tuple[str, list[str]] | None:
    page = full_page_asset(source_root, item)
    if page is None:
        return None
    target_index = max(0, asset_question_index(item) - 1)
    best_surface: tuple[str, list[str]] | None = None
    best_score = -1
    page_key = hashlib.sha1(str(page).encode("utf-8")).hexdigest()[:16]
    for psm in (6, 11, 3, 4, 12):
        width, height, words = read_or_run_ocr(
            f"page-{page_key}", page, tesseract, cache_dir, refresh, psm=psm
        )
        anchors = prompt_anchors(group_tesseract_lines(words))
        if not anchors:
            continue
        index = min(target_index, len(anchors) - 1)
        anchor = anchors[index]
        previous_top = anchors[index - 1].top if index else 0
        next_top = anchors[index + 1].top if index + 1 < len(anchors) else height
        top = (previous_top + anchor.top) // 2 if index else 0
        bottom = next_top - 5 if index + 1 < len(anchors) else height
        band_words = [word for word in words if top <= word.top < bottom]
        source_free_item = dict(item, ocr_lines=[], options=[])
        try:
            surface = image_question_surface(source_free_item, width, band_words)
        except ValueError:
            continue
        question_text, choices = surface
        option_quality = sum(
            sum(character.isalnum() for character in choice) for choice in choices
        )
        score = (1000 if len(choices) == 4 else 0) + min(len(question_text), 600) + option_quality
        if score > best_score:
            best_surface = surface
            best_score = score
    if best_surface and len(best_surface[0]) >= 45:
        return best_surface
    return None


def render_source_pdf_page(
    source_root: Path,
    item: dict[str, Any],
    page_offset: int,
    cache_dir: Path,
) -> Path | None:
    reference = next(
        (str(value) for value in item.get("sources") or [] if "#page=" in str(value)),
        "",
    )
    if not reference:
        return None
    relative_path, page_surface = reference.rsplit("#page=", 1)
    try:
        page_number = int(page_surface) + page_offset
    except ValueError:
        return None
    source_pdf = source_root / Path(relative_path)
    pdftoppm = resolve_pdftoppm()
    if (
        not source_pdf.exists()
        or source_pdf.suffix.lower() != ".pdf"
        or pdftoppm is None
    ):
        return None
    signature = hashlib.sha1(
        f"{source_pdf}:{source_pdf.stat().st_size}:{page_number}".encode("utf-8")
    ).hexdigest()[:18]
    page_dir = cache_dir / "source-pages"
    page_dir.mkdir(parents=True, exist_ok=True)
    output_prefix = page_dir / f"{signature}-p{page_number:04d}"
    output_image = output_prefix.with_suffix(".jpg")
    if not output_image.exists():
        try:
            subprocess.run(
                [
                    str(pdftoppm),
                    "-f",
                    str(page_number),
                    "-l",
                    str(page_number),
                    "-r",
                    "160",
                    "-jpeg",
                    "-singlefile",
                    str(source_pdf),
                    str(output_prefix),
                ],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError:
            return None
    return output_image if output_image.exists() else None


def pdf_continuation_surface(
    item: dict[str, Any],
    source_root: Path,
    tesseract: Path,
    cache_dir: Path,
    refresh: bool,
) -> tuple[str, list[str]] | None:
    raw_text = str(item.get("ocr_text") or "")
    assets = alternate_question_assets(source_root, item)
    if LOOSE_GRAMMAR_PROMPT.search(raw_text):
        current_text = raw_text
    elif assets:
        current_text = ocr_text_for_asset(
            assets[0], tesseract, cache_dir, refresh
        )
    else:
        current_text = raw_text
    continuation_texts: list[str] = []
    for page_offset in (1, 2):
        rendered_page = render_source_pdf_page(
            source_root, item, page_offset, cache_dir
        )
        if rendered_page is None:
            continue
        continuation_texts.append(
            ocr_text_for_asset(
                rendered_page, tesseract, cache_dir, refresh, psm=6
            )
        )
        parsed = parse_text_question_surface(current_text, continuation_texts)
        if parsed:
            return parsed
    return None


CHOICE_OVERRIDES: dict[str, list[str]] = {
    # OCR drops the short highlighted option on this Bluebook-style source page.
    "G0451": ["are", "is", "were", "have been"],
    # The page scan clips the leading letter from “others” in every option.
    "G0894": ["others, the", "others. The", "others? The", "others the"],
}

QUESTION_OVERRIDES = {
    "G0894": (
        "Why do children resemble their biological parents in some ways but not in _____ "
        "answer requires an understanding of genetics.\n\n"
        + STANDARD_PROMPT
    ),
}

# A small set of source crops split a question across pages, clipped the blank,
# or included a neighboring question. These source-backed transcriptions were
# checked against the corresponding full-page scan. Keeping them here makes the
# generated catalog deterministic and prevents damaged crop geometry from
# leaking into the native web surface.
SOURCE_SURFACE_OVERRIDES: dict[str, tuple[str, list[str]]] = {
    "G0117": (
        "In 2013, veteran actor Keith David voiced the character Frog King in the film The Frog Kingdom. "
        "Throughout his career, David has acted in _____ and more. However, he gets the most recognition "
        "for his voice acting.\n\n" + STANDARD_PROMPT,
        [
            "movies; commercials; Broadway musicals;",
            "movies commercials Broadway musicals",
            "movies, commercials Broadway musicals,",
            "movies, commercials, Broadway musicals,",
        ],
    ),
    "G0155": (
        "_____ a US state when it ratified the US Constitution on December 12, 1787, Pennsylvania was "
        "thereby empowered, via its representatives to the US Congress, to vote on whether to admit "
        "Louisiana as a state on April 30, 1812.\n\n" + STANDARD_PROMPT,
        [
            "Pennsylvania would officially become",
            "Pennsylvania had officially become",
            "Pennsylvania officially became",
            "Pennsylvania, having officially become",
        ],
    ),
    "G0173": (
        "_____ a US state when it ratified the US Constitution on December 12, 1787, Pennsylvania was "
        "thereby empowered, via its representatives to the US Congress, to vote on whether to admit "
        "Louisiana as a state on April 30, 1812.\n\n" + STANDARD_PROMPT,
        [
            "Pennsylvania would officially become",
            "Pennsylvania had officially become",
            "Pennsylvania officially became",
            "Pennsylvania, having officially become",
        ],
    ),
    "G0246": (
        "Like almost every country in the world, Britain has been allocated an international dialing prefix "
        "to help route incoming international calls. First assigned to Britain in the 1960s Red Book, a "
        "directory published by a United Nations telecommunications agency, _____\n\n" + STANDARD_PROMPT,
        [
            "international direct dialing was not widely available until the 1970s, so initially, only switchboard operators used the prefix.",
            "not until the 1970s did international direct dialing become widely available, meaning that, initially, only switchboard operators used the prefix.",
            "initially, only switchboard operators used the prefix, as international direct dialing was not widely available until the 1970s.",
            "the prefix was used by only switchboard operators initially, as international direct dialing was not widely available until the 1970s.",
        ],
    ),
    "G0297": (
        "In a 2018 study, Ceri Shipton et al. concluded that stone tools excavated from an archaeological "
        "site in Saudi Arabia date to between 197,000 and 276,000 years ago. The reliability of the dates "
        "that Shipton et al. have posited, which were obtained through processes that determined when buried "
        "mineral grains surrounding the tools were last exposed to sunlight, _____ in part upon the "
        "researchers' exclusion of mineral grains that lacked adequate sun exposure before burial.\n\n"
        + STANDARD_PROMPT,
        ["depending", "depend", "depends", "having depended"],
    ),
    "G0350": (
        "The impala (Aepyceros melampus) has a species population of about 2,000,000 _____ less than that "
        "of the water buffalo (Bubalus bubalis), which has a species population of roughly 172,000,000.\n\n"
        + STANDARD_PROMPT,
        [
            "members: this amount is.",
            "members. This amount is:",
            "members; this amount is",
            "members, this amount is.",
        ],
    ),
    "G0356": (
        "In the twentieth century, many countries developed secret codes. These codes were used _____ "
        "plans during wartime.\n\n" + STANDARD_PROMPT,
        ["to communicate", "communicates", "communicate", "have communicated"],
    ),
    "G0357": (
        "A portrait of Silas Wright, former governor of New York, appeared on the $50 gold certificate. "
        "This form of paper currency _____ discontinued by the US Treasury in 1933.\n\n" + STANDARD_PROMPT,
        ["having been", "to be", "was", "being"],
    ),
    "G0358": (
        "Still Life with Three Puppies is a painting by Paul Gauguin, a French artist. Gauguin created _____ "
        "in 1888.\n\n" + STANDARD_PROMPT,
        ["those", "it", "them", "these"],
    ),
    "G0362": (
        "Many works of the Greek historian Strabo (1st century BCE) are _____ his Geographica, a descriptive "
        "history of the ancient world, is an extant work: it can still be read.\n\n" + STANDARD_PROMPT,
        ["lost. Conversely,", "lost and conversely,", "lost, conversely,", "lost, and conversely"],
    ),
    "G0366": (
        "Edwige Moyroud is a biologist at the University of _____ conducts research on plants.\n\n"
        + STANDARD_PROMPT,
        ["Cambridge, she", "Cambridge she", "Cambridge. She", "Cambridge. Where she"],
    ),
    "G0367": (
        "Charles Dickens's classic 1850 novel about a young man named David Copperfield has a title that is "
        "instantly recognizable to many readers: David Copperfield. Dickens's novel originally had a different "
        "_____ while writing and editing, Dickens had planned to call the novel Mag's Diversions.\n\n"
        + STANDARD_PROMPT,
        ["title, though;", "title, though,", "title; though", "title, though"],
    ),
    "G0378": (
        "Novelist and playwright Mary Russell Mitford joined with 55 other prominent British writers in 1837 "
        "to petition the US Congress for greater copyright protections. This cadre of renowned _____ that "
        "American publishers' appropriation of their work caused, in the words of the petition, “deep and "
        "extensive injuries...on their reputation and property,” helped sow the seeds for the International "
        "Copyright Act of 1891.\n\n" + STANDARD_PROMPT,
        ["authors asserted", "authors, asserting", "authors, had asserted", "authors were asserting"],
    ),
    "G0385": (
        "At the Actors Pulse in Sydney, Australia, students can sign up _____ the world-famous Meisner acting "
        "technique. Created by acting teacher Sanford Meisner, this technique trains actors to react naturally "
        "to the other performers in a scene.\n\n" + STANDARD_PROMPT,
        ["learned", "to learn", "learn", "are learning"],
    ),
    "G0388": (
        "At 1,723 years old, KET 3996, a limber pine (Pinus flexilis) located in the United States, is one of "
        "the oldest known trees in the world. With almost two millennia of climate data in its tree rings, a "
        "single tree like _____ claims dendrochronologist Valerie Trouet, can tell the history of the world.\n\n"
        + STANDARD_PROMPT,
        ["this", "this:", "this,", "this;"],
    ),
    "G0411": (
        "San Juan High School and Grand County High School are two of several Utah _____ enormous geoglyph of "
        "the letters SJ overlooks San Juan High, while a geoglyph of the letter G overlooks Grand County High."
        "\n\n" + STANDARD_PROMPT,
        [
            "schools that have their own hillside geoglyphs. An",
            "schools, that have their own hillside geoglyphs and an",
            "schools that have their own hillside geoglyphs, an",
            "schools, that have their own hillside geoglyphs, and an",
        ],
    ),
    "G0429": (
        "Fans of the film The Princess and the Frog (2009) likely _____ the commanding bass voice behind the "
        "character Dr. Facilier. It belongs to actor Keith David. The veteran actor has performed in everything "
        "from commercials to Broadway musicals, but he is most known for his voice acting.\n\n"
        + STANDARD_PROMPT,
        ["recognizes", "has recognized", "recognize", "is recognizing"],
    ),
    "G0485": (
        "As British scientist Peter Whibberley has observed, “the Earth is not a very good timekeeper.” Earth's "
        "slightly irregular rotation rate means that measurements of time must be periodically adjusted. "
        "Specifically, an extra “leap second” (the 86,401st second of the day) is _____ time based on the "
        "planet's rotation lags a full nine-tenths of a second behind time kept by precise atomic clocks.\n\n"
        + STANDARD_PROMPT,
        ["added, whenever", "added; whenever", "added. Whenever", "added whenever"],
    ),
    "G0517": (
        "Minerals can be classified by their ability to transmit light. Krotite, which transmits all or almost "
        "all light, is classified as _____ other minerals, such as groutite, are classified as opaque because "
        "they transmit no light.\n\n" + STANDARD_PROMPT,
        [
            "transparent for example,",
            "transparent; for example,",
            "transparent, for example,",
            "transparent, for example;",
        ],
    ),
    "G0519": (
        "The 1958 poem “The Ghost's Leavetaking” by American author Sylvia Plath _____ the first use of the "
        "word “dreamscape.”\n\n" + STANDARD_PROMPT,
        ["having contained", "to contain", "containing", "contains"],
    ),
    "G0528": (
        "Integrating insights from economics and psychology, researchers in the field of behavioral economics "
        "explore a variety of topics. Lucia Macchia of the University of Oxford studies socioeconomic _____ "
        "other researchers investigate areas such as organizational behavior and personal finance.\n\n"
        + STANDARD_PROMPT,
        [
            "inequality, for instance;",
            "inequality; for instance,",
            "inequality, for instance,",
            "inequality for instance;",
        ],
    ),
    "G0542": (
        "The 1970 founding of the Partido Nacional de La Raza Unida and the 1946 Mendez v. Westminster court "
        "decision are important events in US civil rights _____ former establishing a Latino rights advocacy "
        "group and the latter legally affirming the rights of Latino students.\n\n" + STANDARD_PROMPT,
        ["history the", "history. The", "history, the", "history, and the"],
    ),
    "G0545": (
        "The Southern Delta Aquariid meteor shower has a zenithal hourly rate (ZHR) of 25, meaning that at the "
        "shower's peak, 25 meteors per hour could potentially be seen by a hypothetical observer. A calculation "
        "that assumes ideal viewing conditions, _____\n\n" + STANDARD_PROMPT,
        [
            "an actual viewer's observed number of meteors in an hour and the ZHR may differ considerably.",
            "the number of meteors an actual viewer observes in an hour may differ considerably from the ZHR.",
            "there may be a considerable difference between the number of meteors an actual viewer observes in an hour and the ZHR.",
            "the ZHR may differ considerably from the number of meteors an actual viewer observes in an hour.",
        ],
    ),
    "G0576": (
        "In her work, Tlingit artist Tanis S'eiltin uses a combination of traditional art techniques and "
        "innovative multimedia formats to create striking mixed-media pieces. The Eiteljorg Museum counts "
        "pieces by S'eiltin in _____ impressive collection of Native artworks.\n\n" + STANDARD_PROMPT,
        ["its", "her", "it's", "their"],
    ),
    "G0607": (
        "Doha, the capital of Qatar, has a population of 1,450,000, which accounts for 92 percent of the "
        "country's total population. Having proportionally large populations _____ common for national "
        "capitals.\n\n" + STANDARD_PROMPT,
        ["is", "were", "are", "have been"],
    ),
    "G0620": (
        "Conceptual artist Joan Jonas's first work, Wind (1968), is a silent film depicting people on a beach "
        "struggling to move about in extremely windy conditions. Wind has been recognized for bringing the "
        "principles of postmodern dance—which demystifies traditional choreography by foregrounding features "
        "of movement that ballet and other classical dance forms obscure (such as clumsiness, weightiness, "
        "resistance, and _____ to video.\n\n" + STANDARD_PROMPT,
        ["gravity),", "gravity);", "gravity)—", "gravity)"],
    ),
    "G0621": (
        "In a 2022 study, Fa-Gang Wang et al. concluded that ocher artifacts excavated from an archaeological "
        "site in China date to between 39,000 and 41,000 years ago. The reliability of the dates that Wang et "
        "al. have posited, which were obtained through processes that determined when buried mineral grains "
        "surrounding the ocher artifacts were last exposed to sunlight, _____ in part upon the researchers' "
        "exclusion of mineral grains that lacked adequate sun exposure before burial.\n\n" + STANDARD_PROMPT,
        ["depending", "depend", "having depended", "depends"],
    ),
    "G0624": (
        "The Okavango Delta is a vital water source and hub for biodiversity in southern Africa. Koketso "
        "Mookodi, a director of the National Geographic Okavango Wilderness Project (NGOWP) in Botswana, helps "
        "educate the public about _____ important place.\n\n" + STANDARD_PROMPT,
        ["this", "both", "those", "these"],
    ),
    "G0632": (
        "In 2010, anthropologist Livia Barbosa published a study wherein she documented survey respondents' "
        "perceptions of popular Brazilian foods, such as coxinha and broa. While the data may now be somewhat "
        "outdated, scholars in the future interested in tracking changes in food and sociability in Brazilian "
        "society _____ Barbosa's study useful.\n\n" + STANDARD_PROMPT,
        ["find", "will find", "had found", "found"],
    ),
    "G0652": (
        "Jesse Treviño's 1976 painting Mis Hermanos was featured in the Smithsonian's 2013 exhibition Our "
        "America: The Latino Presence in American Art. The piece _____ chosen for the exhibition by curator "
        "E. Carmen Ramos.\n\n" + STANDARD_PROMPT,
        ["is", "had been", "will be", "is being"],
    ),
    "G0655": (
        "Philosopher Gottlob Frege (1848–1925) explored how multiple names can be used to refer to the same "
        "object or person yet still have different meanings. For instance, the fictional character Clark Kent "
        "and his alter ego Superman are the same person, yet the two personas are distinct. For Frege, this "
        "raises further questions about how _____\n\n" + STANDARD_PROMPT,
        [
            "can we hold contradictory beliefs about a single thing.",
            "we can hold contradictory beliefs about a single thing.",
            "we can hold contradictory beliefs about a single thing?",
            "can we hold contradictory beliefs about a single thing?",
        ],
    ),
    "G0661": (
        "Arms outstretched, right wrist over left with both hands dangling, South Korean musician Psy galloped "
        "from one foot to the other in the iconic dance of his 2012 international hit song “Gangnam Style.” "
        "Later, a statue depicting Psy's arm-positioning during the dance was erected in the place that inspired "
        "the song's _____ Gangnam District in Seoul, South Korea.\n\n" + STANDARD_PROMPT,
        ["name.", "name—", "name", "name;"],
    ),
    "G0663": (
        "Los Angeles–based artist Henry Taylor's large, vibrant paintings of prominent Black figures such as "
        "Olympian Alice Coachman (See Alice Jump, 2011) and artist David Hammons (Hammons meets a hyena on "
        "holiday, _____ celebrated by admirers of twenty-first-century portraiture, attracted legions of new "
        "fans in 2024 when they were included in a popular Taylor retrospective at the Whitney Museum.\n\n"
        + STANDARD_PROMPT,
        ["2016) have long been", "2016), had long been", "2016) were long", "2016), long"],
    ),
    "G0737": (
        "The Grootbos florilegium in South Africa contains a collection of botanical paintings, with each "
        "painting depicting a local plant species in exquisite detail. The florilegium includes a vignette "
        "painting by contributing artist Sibonelo Chiliza. Unlike most paintings in the florilegium, _____\n\n"
        + STANDARD_PROMPT,
        [
            "Chiliza contextualizes a plant within an ecosystem in his vignette.",
            "the contextualization of a plant within an ecosystem occurs in Chiliza's vignette.",
            "a plant's ecosystem is contextualized in Chiliza's vignette.",
            "Chiliza's vignette contextualizes a plant within an ecosystem.",
        ],
    ),
    "G0786": (
        "As the exoplanet 81 Ceti b orbits a star 330 light-years from Earth, the exoplanet's gravity causes the "
        "star to wobble. In 2008, astronomers _____ this wobble through shifts in the color of the star's "
        "spectral light—blueshifts indicating longer wavelengths and movement toward the observer, redshifts "
        "shorter wavelengths and movement away—deduced that the fluctuation was caused by the gravitational "
        "force of a previously undetected exoplanet.\n\n" + STANDARD_PROMPT,
        ["perceived", "had perceived", "were perceiving", "perceiving"],
    ),
    "G0790": (
        "A plano-convex lens _____ the laser on the center of the 10-millimeter-long crystal ensured a spot "
        "size (a measure of the beam's diameter) of 85 micrometers.\n\n" + STANDARD_PROMPT,
        ["focused", "focuses", "focusing", "focus"],
    ),
    "G0862": (
        "Sunita Williams, a US astronaut, has gone on seven spacewalks. During _____ spacewalks, Williams "
        "performed important tasks outside the spacecraft, such as installing new equipment.\n\n"
        + STANDARD_PROMPT,
        ["that", "these", "this", "one"],
    ),
    "G0876": (
        "In their attempt to create a quantum random number generator, K. Muhammed Shafi et al. used a "
        "continuous-wave diode laser to fire photons at a periodically-poled potassium titanyl phosphate "
        "(PPKTP) nonlinear crystal. A plano-convex lens _____ the laser on the center of the "
        "10-millimeter-long crystal ensured a spot size (a measure of the beam's diameter) of 85 micrometers."
        "\n\n" + STANDARD_PROMPT,
        ["focused", "focuses", "focus", "focusing"],
    ),
    "G0919": (
        "Many works of the Greek mathematician Euclid (3rd century BCE) are _____ his Elements, a treatise of "
        "mathematical knowledge, is an extant work: it can still be read.\n\n" + STANDARD_PROMPT,
        ["lost and conversely,", "lost, conversely,", "lost. Conversely,", "lost, and conversely"],
    ),
    "G0920": (
        "Physical barriers, chemical defenses, and protein defenses are the three main categories of plant "
        "defense mechanisms. The poplar tree uses a _____ the trees produce chemicals that prevent certain "
        "herbivorous insects from feeding on the trees' leaves.\n\n" + STANDARD_PROMPT,
        ["chemical defense:", "chemical defense,", "chemical defense", "chemical defense and"],
    ),
    "G0922": (
        "Working on an unimaginably small scale of billionths of a meter, nanoengineers have found ways to "
        "leverage cerium oxide _____ to improve treatments for certain conditions related to oxidative stress."
        "\n\n" + STANDARD_PROMPT,
        [
            "nanoparticles' properties'",
            "nanoparticles properties",
            "nanoparticles' properties",
            "nanoparticle's properties",
        ],
    ),
    "G0974": (
        "NASA's Opportunity rover first touched down on Mars on January 25, 2004. The rover spent over fourteen "
        "years gathering information about Mars's rocky surface. Scientists playfully _____ one of the rocks "
        "it found Edmund.\n\n" + STANDARD_PROMPT,
        ["named", "is naming", "has named", "names"],
    ),
}

SURFACE_ALIASES = {
    # The linear practice-test page splits this question's body and choices
    # into separate source crops. G0472 is the complete copy of the same item.
    "G0283": "G0472",
    # Duplicate copies whose own crop contains only part of the question.
    "G0677": "G0663",
    "G0774": "G0411",
}

KNOWN_NON_QUESTION_RECORDS = {
    "G0115": "SAT framework introduction page",
    "G0116": "SAT framework domain-description page",
    "G0497": "SAT framework section-overview page",
    "G0233": "source scan contains choices but the question stem is erased",
    "G0591": "source record is a transitions item, not a Standard English Conventions item",
}


def apply_source_choice_overrides(
    surfaces: dict[str, tuple[str, list[str]]],
) -> int:
    applied = 0
    for item_id, choices in CHOICE_OVERRIDES.items():
        question_text, existing_choices = surfaces.get(item_id, ("", []))
        if question_text and len(existing_choices) != 4:
            surfaces[item_id] = (question_text, choices)
            applied += 1
        elif question_text and existing_choices != choices and item_id == "G0894":
            surfaces[item_id] = (question_text, choices)
            applied += 1
    for item_id, question_text in QUESTION_OVERRIDES.items():
        existing_question, choices = surfaces.get(item_id, ("", []))
        if existing_question and existing_question != question_text:
            surfaces[item_id] = (question_text, choices)
            applied += 1
    return applied


def apply_source_surface_overrides(
    surfaces: dict[str, tuple[str, list[str]]],
) -> int:
    for item_id, surface in SOURCE_SURFACE_OVERRIDES.items():
        surfaces[item_id] = surface
    return len(SOURCE_SURFACE_OVERRIDES)


def clean_question_text(value: str) -> str:
    value = compact_text(value)
    paragraphs = value.split("\n\n")
    while paragraphs and re.search(
        r"\bAssessment\b.*\bTest\b.*\bDomain\b.*\bSkill\b.*\bDifficulty\b",
        paragraphs[0],
        re.IGNORECASE | re.DOTALL,
    ):
        paragraphs.pop(0)
    value = "\n\n".join(paragraphs)
    value = re.sub(r"(?is)^Options\s*:.*?\n(?=[A-Z])", "", value)
    value = re.sub(r"^[A-Za-z]{1,2}\s*\n\n(?=[A-Z])", "", value)
    value = re.sub(r"^(?:[A-Za-z]\]|\[[A-Za-z]\])\s*", "", value)
    value = re.sub(r"\s*\|\s*", " ", value)
    value = re.sub(r"\s*_{3,}\s*", " _____ ", value)
    return compact_text(value)


def source_question_id(item: dict[str, Any]) -> str | None:
    original = str(item.get("original_question_id") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{8}", original):
        return original
    for source_line in item.get("ocr_lines") or []:
        line = str(source_line.get("text") or "")
        match = re.search(r"Question\s*ID\s*([0-9a-f]{8})", line, re.IGNORECASE)
        if match:
            return match.group(1).lower()
    raw_text = str(item.get("ocr_text") or "")
    match = re.search(r"Question\D{0,10}([0-9a-f]{8})", raw_text, re.IGNORECASE)
    return match.group(1).lower() if match else None


def surface_ngrams(value: str, size: int = 4) -> set[str]:
    passage = re.split(r"Which\s+choice\s+completes", value, flags=re.IGNORECASE)[0]
    normalized = "".join(character for character in passage.lower() if character.isalnum())
    return {
        normalized[index : index + size]
        for index in range(max(0, len(normalized) - size + 1))
    }


def ngram_similarity(left: set[str], right: set[str]) -> float:
    return len(left & right) / max(1, len(left | right))


def apply_official_surfaces(
    items: list[dict[str, Any]],
    surfaces: dict[str, tuple[str, list[str]]],
    catalog_path: Path,
) -> tuple[int, int]:
    """Prefer exact College Board HTML over OCR whenever a safe match exists."""
    if not catalog_path.exists():
        return 0, 0
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    official: dict[str, dict[str, Any]] = payload.get("items") or {}
    official_grams = {
        question_id: surface_ngrams(str(record.get("questionText") or ""))
        for question_id, record in official.items()
    }
    official_choice_grams = {
        question_id: surface_ngrams(
            " ".join(str(choice) for choice in record.get("choiceTexts") or [])
        )
        for question_id, record in official.items()
    }
    direct_matches = 0
    fuzzy_matches = 0
    for item in items:
        item_id = str(item["id"])
        question_id = source_question_id(item)
        matched_id: str | None = question_id if question_id in official else None
        if matched_id:
            direct_matches += 1
        else:
            source_grams = surface_ngrams(surfaces[item_id][0])
            ranked = sorted(
                (
                    (ngram_similarity(source_grams, candidate_grams), candidate_id)
                    for candidate_id, candidate_grams in official_grams.items()
                ),
                reverse=True,
            )
            if len(ranked) >= 2:
                best_score, best_id = ranked[0]
                score_margin = best_score - ranked[1][0]
                if best_score >= 0.58 and score_margin >= 0.20:
                    matched_id = best_id
                    fuzzy_matches += 1
            if not matched_id and len(surfaces[item_id][1]) == 4:
                choice_grams = surface_ngrams(" ".join(surfaces[item_id][1]))
                choice_ranked = sorted(
                    (
                        (
                            ngram_similarity(choice_grams, candidate_grams),
                            candidate_id,
                        )
                        for candidate_id, candidate_grams in official_choice_grams.items()
                    ),
                    reverse=True,
                )
                if len(choice_ranked) >= 2:
                    best_score, best_id = choice_ranked[0]
                    score_margin = best_score - choice_ranked[1][0]
                    if best_score >= 0.80 and score_margin >= 0.15:
                        matched_id = best_id
                        fuzzy_matches += 1
        if not matched_id:
            continue
        record = official[matched_id]
        surfaces[item_id] = (
            str(record["questionText"]),
            [str(choice) for choice in record["choiceTexts"]],
        )
    return direct_matches, fuzzy_matches


def normalize_surfaces(
    surfaces: dict[str, tuple[str, list[str]]],
) -> None:
    for item_id, (question_text, choices) in surfaces.items():
        surfaces[item_id] = (
            clean_question_text(question_text),
            [clean_option(choice) for choice in choices],
        )


def apply_surface_aliases(
    surfaces: dict[str, tuple[str, list[str]]],
) -> int:
    applied = 0
    for target_id, source_id in SURFACE_ALIASES.items():
        source_surface = surfaces.get(source_id)
        if source_surface and not validate_surface(source_id, *source_surface):
            surfaces[target_id] = source_surface
            applied += 1
    return applied


def is_gradable(item: dict[str, Any]) -> bool:
    return bool(
        item.get("answer_status") in RELIABLE_ANSWER_STATUSES
        and item.get("answer") in ANSWERS
    )


def explanation_for(item: dict[str, Any], gradable: bool) -> str:
    if gradable:
        return str(
            item.get("chinese_explanation")
            or f"正确答案：{item['answer']}。请结合本题所属知识点复盘句子结构与选项差异。"
        )
    if item.get("answer_status") == "conflict_review":
        candidates = "、".join(str(value) for value in item.get("answer_candidates") or [])
        suffix = f"（来源记录为 {candidates}）" if candidates else ""
        return f"源材料中的答案记录存在冲突{suffix}，本次选择只记录、不计入正确率。"
    return "源材料暂未提供可唯一核验的答案。本次选择已记录，不计入正确率。"


def build_record(
    item: dict[str, Any],
    question_text: str,
    choice_texts: list[str],
) -> dict[str, Any]:
    category = str(item.get("subtopic") or "综合语法")
    chapter_id = CATEGORY_TO_ENTRY.get(category, "syntax-completeness")
    gradable = is_gradable(item)
    answer = item.get("answer") if gradable else None
    return {
        "id": item["id"],
        "chapterId": chapter_id,
        "category": category,
        "officialSkill": item.get("official_skill") or "Form, Structure, and Sense",
        "difficulty": item.get("difficulty") or "Medium",
        "answer": answer,
        "answerStatus": item.get("answer_status") or "pending_verification",
        "answerCandidates": item.get("answer_candidates") or [],
        "gradable": gradable,
        "questionText": question_text,
        "choiceTexts": choice_texts,
        "explanation": explanation_for(item, gradable),
    }


def validate_surface(item_id: str, question_text: str, choices: list[str]) -> list[str]:
    issues: list[str] = []
    if len(question_text) < 45:
        issues.append("question text is too short")
    if not GRAMMAR_PROMPT.search(question_text):
        issues.append("standard prompt is missing")
    if question_text.lower().count("which choice") != 1:
        issues.append("question contains more than one prompt")
    passage = re.split(
        r"Which\s+choice\s+completes", question_text, flags=re.IGNORECASE
    )[0]
    if sum(character.isalpha() for character in passage) < 20:
        issues.append("question passage is missing")
    if "_____" not in passage:
        issues.append("question blank is missing")
    if any(token in question_text for token in ("答案：", "解析：")):
        issues.append("question contains answer or explanation text")
    if len(choices) != 4 or any(not choice for choice in choices):
        issues.append(f"expected four choices, received {len(choices)}")
    for index, choice in enumerate(choices):
        if len(choice) > 240:
            issues.append(f"choice {index + 1} is too long")
        if LOOSE_GRAMMAR_PROMPT.search(choice) or any(
            token.lower() in choice.lower()
            for token in (
                "Correct Answer",
                "Question ID",
                "Mark for Review",
                "Unauthorized copying",
                "Rationale",
                "答案：",
                "解析：",
            )
        ):
            issues.append(f"choice {index + 1} contains another question or answer")
        if re.search(r"\bID\s*:", choice, re.IGNORECASE):
            issues.append(f"choice {index + 1} contains a source ID")
        normalized_choice = re.sub(r"[^a-z]", "", choice.lower())
        if any(
            token in normalized_choice
            for token in (
                "markforreview",
                "whichchoicecompletesthetext",
                "conventionsofstandardenglish",
                "correctanswer",
                "rationale",
                "continue",
            )
        ):
            issues.append(f"choice {index + 1} contains interface or source text")
    forbidden = (
        "Mark for Review",
        "Question ID",
        "Correct Answer",
        "Property of Ekon",
        "Assessment _____ Test",
    )
    for token in forbidden:
        if token.lower() in question_text.lower() or any(token.lower() in choice.lower() for choice in choices):
            issues.append(f"contains interface/source noise: {token}")
    return [f"{item_id}: {issue}" for issue in issues]


TOKEN_STOPWORDS = {
    "which",
    "choice",
    "completes",
    "text",
    "that",
    "conforms",
    "conventions",
    "standard",
    "english",
    "answer",
    "options",
    "mark",
    "review",
    "question",
    "reading",
    "writing",
    "module",
    "section",
}


def content_tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z]{4,}", value.lower())
        if token not in TOKEN_STOPWORDS
    }


def repair_from_duplicate_surfaces(
    items: list[dict[str, Any]],
    surfaces: dict[str, tuple[str, list[str]]],
) -> int:
    complete_items = [
        item
        for item in items
        if not validate_surface(str(item["id"]), *surfaces[str(item["id"])])
    ]
    repaired = 0
    for item in items:
        item_id = str(item["id"])
        question_text, choices = surfaces[item_id]
        if not validate_surface(item_id, question_text, choices):
            continue
        source_tokens = content_tokens(
            f"{item.get('ocr_text') or ''} {question_text}"
        )
        best_score = 0.0
        best_overlap = 0
        best_surface: tuple[str, list[str]] | None = None
        for candidate in complete_items:
            candidate_surface = surfaces[str(candidate["id"])]
            candidate_tokens = content_tokens(candidate_surface[0])
            overlap = len(source_tokens & candidate_tokens)
            score = overlap / max(1, min(len(source_tokens), len(candidate_tokens)))
            if (overlap, score) > (best_overlap, best_score):
                best_score = score
                best_overlap = overlap
                best_surface = candidate_surface
        if best_surface and best_score >= 0.35 and best_overlap >= 6:
            surfaces[item_id] = best_surface
            repaired += 1
    return repaired


def extract_image_item(
    item: dict[str, Any],
    source_root: Path,
    tesseract: Path,
    cache_dir: Path,
    refresh: bool,
) -> tuple[str, str, list[str]]:
    crop = workbook_crop(source_root, item)
    if crop is None:
        raise ValueError(f"{item['id']} has no image crop")
    width, _, words = read_or_run_ocr(
        str(item["id"]), crop, tesseract, cache_dir, refresh, psm=6
    )
    question_text = ""
    choices: list[str] = []
    try:
        question_text, choices = image_question_surface(item, width, words)
    except ValueError:
        pass
    if len(choices) != 4 or not question_text:
        sparse_width, _, sparse_words = read_or_run_ocr(
            str(item["id"]), crop, tesseract, cache_dir, refresh, psm=11
        )
        try:
            sparse_question, sparse_choices = image_question_surface(
                item, sparse_width, sparse_words
            )
            if not question_text:
                question_text = sparse_question
            if len(sparse_choices) == 4:
                choices = sparse_choices
        except ValueError:
            pass
    for alternate_psm in (3, 4, 12):
        if len(choices) == 4 and question_text:
            break
        alternate_width, _, alternate_words = read_or_run_ocr(
            str(item["id"]),
            crop,
            tesseract,
            cache_dir,
            refresh,
            psm=alternate_psm,
        )
        try:
            alternate_question, alternate_choices = image_question_surface(
                item, alternate_width, alternate_words
            )
            if not question_text:
                question_text = alternate_question
            if len(alternate_choices) == 4:
                choices = alternate_choices
        except ValueError:
            pass
    return str(item["id"]), question_text, choices


def main() -> None:
    args = parse_args()
    source_catalog = args.source_root / "output/data/sat_grammar_items.json"
    items: list[dict[str, Any]] = json.loads(source_catalog.read_text(encoding="utf-8"))
    tesseract = resolve_tesseract(args.tesseract)

    extracted: dict[str, tuple[str, list[str]]] = {}
    image_items = [item for item in items if item.get("question_asset")]
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(
                extract_image_item,
                item,
                args.source_root,
                tesseract,
                args.cache_dir,
                args.refresh_ocr,
            ): item
            for item in image_items
        }
        for future in as_completed(futures):
            item = futures[future]
            try:
                item_id, question_text, choices = future.result()
                extracted[item_id] = (question_text, choices)
            except Exception as error:
                extracted[str(item["id"])] = ("", [])
                print(f"OCR failed for {item['id']}: {error}")

    surfaces = dict(extracted)
    for item in items:
        if not item.get("question_asset"):
            surfaces[str(item["id"])] = native_question_surface(item)

    # Resolve official items before expensive recovery passes.  A clean
    # official surface should never be sent back through OCR merely because
    # the source crop omitted a blank or was split across pages.
    normalize_surfaces(surfaces)
    official_direct_matches, official_fuzzy_matches = apply_official_surfaces(
        items, surfaces, args.official_catalog
    )
    normalize_surfaces(surfaces)

    recovered_from_source_assets = 0
    for item in items:
        item_id = str(item["id"])
        if not validate_surface(item_id, *surfaces[item_id]):
            continue
        recovered = alternate_asset_surface(
            item,
            args.source_root,
            tesseract,
            args.cache_dir,
            args.refresh_ocr,
        )
        if recovered:
            surfaces[item_id] = recovered
            recovered_from_source_assets += 1

    recovered_from_full_pages = 0
    for item in items:
        item_id = str(item["id"])
        if not validate_surface(item_id, *surfaces[item_id]):
            continue
        recovered = full_page_surface(
            item,
            args.source_root,
            tesseract,
            args.cache_dir,
            args.refresh_ocr,
        )
        if recovered:
            surfaces[item_id] = recovered
            recovered_from_full_pages += 1

    recovered_from_pdf_continuations = 0
    for item in items:
        item_id = str(item["id"])
        if not validate_surface(item_id, *surfaces[item_id]):
            continue
        recovered = pdf_continuation_surface(
            item,
            args.source_root,
            tesseract,
            args.cache_dir,
            args.refresh_ocr,
        )
        if recovered:
            surfaces[item_id] = recovered
            recovered_from_pdf_continuations += 1

    source_choice_overrides = apply_source_choice_overrides(surfaces)
    normalize_surfaces(surfaces)

    # Recovery can expose a complete official option set even when the first
    # crop contained only a passage or an answer-page fragment.
    official_direct_matches, official_fuzzy_matches = apply_official_surfaces(
        items, surfaces, args.official_catalog
    )
    normalize_surfaces(surfaces)

    # Apply full-page, source-verified transcriptions last so a fuzzy official
    # match or a neighboring crop can never overwrite the inspected source.
    source_surface_overrides = apply_source_surface_overrides(surfaces)
    normalize_surfaces(surfaces)

    duplicate_repairs = repair_from_duplicate_surfaces(items, surfaces)
    normalize_surfaces(surfaces)
    surface_aliases = apply_surface_aliases(surfaces)

    records: list[dict[str, Any]] = []
    validation_issues: list[str] = []
    excluded_non_questions: list[str] = []
    for item in items:
        question_text, choice_texts = surfaces[str(item["id"])]
        item_issues = validate_surface(str(item["id"]), question_text, choice_texts)
        if item_issues and str(item["id"]) in KNOWN_NON_QUESTION_RECORDS:
            excluded_non_questions.append(str(item["id"]))
            continue
        validation_issues.extend(item_issues)
        records.append(build_record(item, question_text, choice_texts))

    if validation_issues:
        debug_path = args.cache_dir / "validation-failures.json"
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        debug_path.write_text(
            json.dumps(
                {
                    item_id: {
                        "questionText": surfaces[item_id][0],
                        "choiceTexts": surfaces[item_id][1],
                    }
                    for item_id in sorted(
                        {issue.split(":", 1)[0] for issue in validation_issues}
                    )
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        report = "\n".join(validation_issues)
        raise RuntimeError(f"Embedded SAT question validation failed:\n{report}")

    # Screenshots are obsolete once every question has a validated text surface.
    if args.output_dir.exists():
        for stale_file in args.output_dir.glob("*.webp"):
            stale_file.unlink()

    category_counts: dict[str, int] = {}
    chapter_counts: dict[str, int] = {}
    for record in records:
        category_counts[record["category"]] = category_counts.get(record["category"], 0) + 1
        chapter_counts[record["chapterId"]] = chapter_counts.get(record["chapterId"], 0) + 1

    gradable_count = sum(bool(record["gradable"]) for record in records)
    pending_count = sum(record["answerStatus"] == "pending_verification" for record in records)
    conflict_count = sum(record["answerStatus"] == "conflict_review" for record in records)

    payload = {
        "version": "2026-08-03-embedded",
        "source": "SAT语法单项训练_全量版.pdf",
        "summary": {
            "sourceItemCount": len(items),
            "interactiveItemCount": len(records),
            "excludedItemCount": len(excluded_non_questions),
            "gradableItemCount": gradable_count,
            "pendingVerificationCount": pending_count,
            "conflictReviewCount": conflict_count,
            "embeddedItemCount": len(records),
            "officialTextItemCount": official_direct_matches + official_fuzzy_matches,
            "imageItemCount": 0,
            "textItemCount": len(records),
            "categoryCounts": dict(sorted(category_counts.items())),
            "chapterCounts": dict(sorted(chapter_counts.items())),
        },
        "items": records,
    }
    args.catalog.parent.mkdir(parents=True, exist_ok=True)
    args.catalog.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Built {len(records)} embedded SAT grammar questions from {len(items)} source records: "
        f"{gradable_count} gradable, {pending_count} pending, {conflict_count} conflict, "
        f"{recovered_from_source_assets} recovered from source crops, "
        f"{recovered_from_full_pages} recovered from full pages, and "
        f"{recovered_from_pdf_continuations} recovered across PDF pages, "
        f"{source_choice_overrides} choice corrections and "
        f"{source_surface_overrides} full-page source transcriptions, "
        f"{official_direct_matches} direct plus {official_fuzzy_matches} fuzzy official-text matches, "
        f"{duplicate_repairs} repaired from duplicate source records; "
        f"{surface_aliases} split-page alias repaired; "
        f"{len(excluded_non_questions)} non-question source pages excluded."
    )


if __name__ == "__main__":
    main()
