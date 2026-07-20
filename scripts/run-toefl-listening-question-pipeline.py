#!/usr/bin/env python3
"""Run resumable Codex author/review/adjudication batches for the listening library."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "apps" / "web" / "data" / "listening-library.json"
WEB_BANK = (
    ROOT
    / "apps"
    / "web"
    / "data"
    / "toefl-academic-listening-questions"
    / "question-bank.json"
)
OUTPUT_ROOT = ROOT / "outputs" / "toefl-academic-listening" / "pipeline"
MASTER_BANK = OUTPUT_ROOT / "master-question-bank.json"
PROGRESS_FILE = OUTPUT_ROOT / "progress.json"
RUNNER_LOG = OUTPUT_ROOT / "runner.log"
SKILL_ROOT = ROOT / ".codex" / "skills" / "author-toefl-academic-listening-items"
SKILL_SCRIPTS = SKILL_ROOT / "scripts"
PREPARE = SKILL_SCRIPTS / "prepare_batch.py"
VALIDATE = SKILL_SCRIPTS / "validate_question_sets.py"
RECONCILE = SKILL_SCRIPTS / "reconcile_reviews.py"
READY_STATUSES = {"reviewed", "adjudicated", "approved"}
COLLECTIONS = ("minute-earth", "bbc-6-minute-english")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compact_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def source_hash(item: dict[str, Any]) -> str:
    canonical = {
        "sourceId": compact_text(item.get("id")),
        "collection": compact_text(item.get("collection")),
        "title": compact_text(item.get("title")),
        "durationSeconds": item.get("durationSeconds"),
        "transcript": str(item.get("transcript") or ""),
    }
    payload = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def append_log(message: str) -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    line = f"[{utc_now()}] {message}"
    with RUNNER_LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    print(line, flush=True)


def run_tool(arguments: list[str], *, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, *arguments]
    result = subprocess.run(
        command,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode:
        output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
        raise RuntimeError(output or f"Command failed: {' '.join(command)}")
    return result


def extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip().lstrip("\ufeff")
    if cleaned.startswith("```"):
        first_line_end = cleaned.find("\n")
        final_fence = cleaned.rfind("```")
        if first_line_end >= 0 and final_fence > first_line_end:
            cleaned = cleaned[first_line_end + 1 : final_fence].strip()
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        value = json.loads(cleaned[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("Codex response JSON root must be an object")
    return value


def codex_executable(explicit: str | None) -> str:
    if explicit:
        path = shutil.which(explicit) or explicit
    else:
        path = shutil.which("codex.cmd") or shutil.which("codex.exe") or shutil.which("codex")
    if not path:
        raise SystemExit("Codex CLI was not found on PATH")
    return path


def stage_prompt(stage: str, feedback: str | None) -> str:
    shared = (
        "Use $author-toefl-academic-listening-items and follow its required references exactly. "
        "Read input.json as the only source payload. Do not browse the web or use outside facts. "
        "Return only one valid JSON object with no markdown fences and no commentary."
    )
    if stage == "author":
        instruction = (
            " Work in author mode. Return a schemaVersion 1, skillVersion 1.0.0 author bank. "
            "Create exactly four English A-D single-choice items per payload source, preserve every "
            "sourceId and sourceHash, keep status draft, include at least one higher-order item, use "
            "at most two detail items, and cover beginning, middle, and end evidence. Every private "
            "block must contain one answer, exact Python character-offset evidence, a substantive "
            "Chinese explanation, and Chinese rationales for all four options."
        )
    elif stage == "review":
        instruction = (
            " Work in blind-review mode. Do not inspect parent directories or look for an author "
            "bank. Independently answer all four questions for every source from the included "
            "transcript. Return schemaVersion 1, mode review-result, with one review per source and "
            "one answer entry per question containing questionId, answer, ambiguous, and reasonZh."
        )
    elif stage == "adjudicate":
        instruction = (
            " Work in adjudication mode. Resolve every included disputed question independently. "
            "Return schemaVersion 1, mode adjudication-result. Each answer entry must include "
            "questionId, answer, ambiguous false, reasonZh, exact evidence spans, explanationZh, "
            "and optionRationalesZh with a, b, c, and d."
        )
    else:
        raise ValueError(f"Unsupported stage: {stage}")
    repair = ""
    if feedback:
        repair = (
            " A previous response is available as previous-output.json and failed deterministic "
            f"checks. Correct every issue listed here: {feedback[:6000]}"
        )
    return shared + instruction + repair


def invoke_codex(
    *,
    executable: str,
    stage: str,
    payload: Path,
    output: Path,
    log_path: Path,
    model: str,
    reasoning_effort: str,
    timeout_seconds: int,
    feedback: str | None = None,
    previous_output: Path | None = None,
) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f"aurelis-{stage}-",
        ignore_cleanup_errors=True,
    ) as temporary_name:
        workdir = Path(temporary_name)
        shutil.copy2(payload, workdir / "input.json")
        if previous_output and previous_output.is_file():
            shutil.copy2(previous_output, workdir / "previous-output.json")
        raw_response = workdir / "response.txt"
        command = [
            executable,
            "exec",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--color",
            "never",
            "-m",
            model,
            "-c",
            f'model_reasoning_effort="{reasoning_effort}"',
            "-C",
            str(workdir),
            "-o",
            str(raw_response),
            stage_prompt(stage, feedback),
        ]
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with log_path.open("w", encoding="utf-8") as log_handle:
            result = subprocess.run(
                command,
                cwd=workdir,
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
                creationflags=creation_flags,
                check=False,
            )
        if result.returncode:
            diagnostic = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
            raise RuntimeError(f"Codex {stage} task failed ({result.returncode}):\n{diagnostic}")
        if not raw_response.is_file():
            raise RuntimeError(f"Codex {stage} task did not produce a final response")
        value = extract_json(raw_response.read_text(encoding="utf-8", errors="replace"))
        write_json(output, value)
        return value


def prepare_payload(stage: str, bank: Path | None, items: list[dict[str, Any]], output: Path) -> None:
    arguments = [
        str(PREPARE),
        "--library",
        str(LIBRARY),
        "--mode",
        stage,
        "--limit",
        "0",
        "--output",
        str(output),
    ]
    if stage == "author":
        for item in items:
            arguments.extend(["--id", str(item["id"])])
    else:
        if bank is None:
            raise ValueError(f"{stage} requires a question bank")
        arguments.extend(["--question-bank", str(bank)])
    run_tool(arguments)


def validate_bank(path: Path, *, strict_warnings: bool = True) -> None:
    arguments = [str(VALIDATE), "--library", str(LIBRARY), "--input", str(path)]
    if strict_warnings:
        arguments.append("--warnings-as-errors")
    run_tool(arguments)


def ensure_expected_sources(bank: dict[str, Any], payload: dict[str, Any]) -> None:
    expected = {str(item["sourceId"]) for item in payload.get("items", [])}
    actual = {str(item.get("sourceId")) for item in bank.get("sets", []) if isinstance(item, dict)}
    if actual != expected:
        raise ValueError(
            f"Codex output source ids differ; missing={sorted(expected - actual)}, "
            f"extra={sorted(actual - expected)}"
        )


def author_batch(
    *,
    items: list[dict[str, Any]],
    batch_dir: Path,
    executable: str,
    args: argparse.Namespace,
) -> Path:
    payload_path = batch_dir / "author-payload.json"
    prepare_payload("author", None, items, payload_path)
    payload = read_json(payload_path)
    for existing in sorted(batch_dir.glob("author-bank.attempt-*.json"), reverse=True):
        try:
            value = read_json(existing)
            ensure_expected_sources(value, payload)
            validate_bank(existing)
            final = batch_dir / "author-bank.json"
            shutil.copy2(existing, final)
            append_log(f"Reused validated author output: {existing.name}")
            return final
        except Exception:
            continue
    feedback: str | None = None
    previous: Path | None = None
    for attempt in range(1, args.attempts + 1):
        candidate = batch_dir / f"author-bank.attempt-{attempt}.json"
        try:
            value = invoke_codex(
                executable=executable,
                stage="author",
                payload=payload_path,
                output=candidate,
                log_path=batch_dir / f"author.attempt-{attempt}.log",
                model=args.model,
                reasoning_effort=args.reasoning_effort,
                timeout_seconds=args.timeout_seconds,
                feedback=feedback,
                previous_output=previous,
            )
            ensure_expected_sources(value, payload)
            validate_bank(candidate)
            final = batch_dir / "author-bank.json"
            shutil.copy2(candidate, final)
            return final
        except Exception as error:
            feedback = str(error)
            previous = candidate if candidate.is_file() else None
            append_log(f"Author attempt {attempt}/{args.attempts} failed: {error}")
    raise RuntimeError("Author stage exhausted all attempts")


def review_batch(
    *,
    author_bank: Path,
    batch_dir: Path,
    executable: str,
    args: argparse.Namespace,
) -> Path:
    payload_path = batch_dir / "review-payload.json"
    prepare_payload("review", author_bank, [], payload_path)
    feedback: str | None = None
    previous: Path | None = None
    for attempt in range(1, args.attempts + 1):
        result_path = batch_dir / f"review-result.attempt-{attempt}.json"
        reconciled = batch_dir / f"reconciled-review.attempt-{attempt}.json"
        try:
            invoke_codex(
                executable=executable,
                stage="review",
                payload=payload_path,
                output=result_path,
                log_path=batch_dir / f"review.attempt-{attempt}.log",
                model=args.model,
                reasoning_effort=args.reasoning_effort,
                timeout_seconds=args.timeout_seconds,
                feedback=feedback,
                previous_output=previous,
            )
            run_tool(
                [
                    str(RECONCILE),
                    "--author",
                    str(author_bank),
                    "--review",
                    str(result_path),
                    "--output",
                    str(reconciled),
                ]
            )
            validate_bank(reconciled)
            shutil.copy2(result_path, batch_dir / "review-result.json")
            shutil.copy2(reconciled, batch_dir / "reconciled-review.json")
            return batch_dir / "reconciled-review.json"
        except Exception as error:
            feedback = str(error)
            previous = result_path if result_path.is_file() else None
            append_log(f"Review attempt {attempt}/{args.attempts} failed: {error}")
    raise RuntimeError("Review stage exhausted all attempts")


def adjudicate_batch(
    *,
    reviewed_bank: Path,
    batch_dir: Path,
    executable: str,
    args: argparse.Namespace,
) -> Path:
    document = read_json(reviewed_bank)
    if not any(item.get("status") == "needs_adjudication" for item in document.get("sets", [])):
        return reviewed_bank
    payload_path = batch_dir / "adjudication-payload.json"
    prepare_payload("adjudicate", reviewed_bank, [], payload_path)
    feedback: str | None = None
    previous: Path | None = None
    for attempt in range(1, args.attempts + 1):
        result_path = batch_dir / f"adjudication-result.attempt-{attempt}.json"
        reconciled = batch_dir / f"reconciled-adjudication.attempt-{attempt}.json"
        try:
            invoke_codex(
                executable=executable,
                stage="adjudicate",
                payload=payload_path,
                output=result_path,
                log_path=batch_dir / f"adjudication.attempt-{attempt}.log",
                model=args.model,
                reasoning_effort=args.reasoning_effort,
                timeout_seconds=args.timeout_seconds,
                feedback=feedback,
                previous_output=previous,
            )
            run_tool(
                [
                    str(RECONCILE),
                    "--author",
                    str(reviewed_bank),
                    "--adjudication",
                    str(result_path),
                    "--output",
                    str(reconciled),
                ]
            )
            validate_bank(reconciled)
            final_document = read_json(reconciled)
            remaining = [
                item.get("sourceId")
                for item in final_document.get("sets", [])
                if item.get("status") in {"draft", "needs_adjudication"}
            ]
            if remaining:
                raise ValueError(f"Unresolved sets remain after adjudication: {remaining}")
            shutil.copy2(result_path, batch_dir / "adjudication-result.json")
            shutil.copy2(reconciled, batch_dir / "reconciled-adjudication.json")
            return batch_dir / "reconciled-adjudication.json"
        except Exception as error:
            feedback = str(error)
            previous = result_path if result_path.is_file() else None
            append_log(f"Adjudication attempt {attempt}/{args.attempts} failed: {error}")
    raise RuntimeError("Adjudication stage exhausted all attempts")


def current_master() -> dict[str, Any]:
    source = WEB_BANK if WEB_BANK.is_file() else MASTER_BANK
    if source.is_file():
        return read_json(source)
    return {
        "schemaVersion": 1,
        "skillVersion": "1.0.0",
        "generatedAt": utc_now(),
        "sets": [],
    }


def merge_master(batch_bank: Path, order: dict[str, int]) -> dict[str, Any]:
    master = current_master()
    merged = {
        str(item.get("sourceId")): item
        for item in master.get("sets", [])
        if isinstance(item, dict) and item.get("sourceId")
    }
    batch = read_json(batch_bank)
    for item in batch.get("sets", []):
        if not isinstance(item, dict) or item.get("status") not in READY_STATUSES:
            raise ValueError(f"Refusing to publish non-reviewed set: {item.get('sourceId')}")
        merged[str(item["sourceId"])] = item
    master["schemaVersion"] = 1
    master["skillVersion"] = "1.0.0"
    master.setdefault("generatedAt", utc_now())
    master["updatedAt"] = utc_now()
    master["sets"] = sorted(merged.values(), key=lambda item: order.get(str(item["sourceId"]), 10**9))
    write_json(MASTER_BANK, master)
    write_json(WEB_BANK, master)
    return master


def write_progress(
    *,
    master: dict[str, Any],
    eligible_count: int,
    missing_items: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    running_batch: list[str] | None,
) -> None:
    statuses: dict[str, int] = {}
    for item in master.get("sets", []):
        status = str(item.get("status"))
        statuses[status] = statuses.get(status, 0) + 1
    ready_count = sum(statuses.get(status, 0) for status in READY_STATUSES)
    write_json(
        PROGRESS_FILE,
        {
            "updatedAt": utc_now(),
            "eligibleCount": eligible_count,
            "readyCount": ready_count,
            "remainingCount": max(0, eligible_count - ready_count),
            "statuses": statuses,
            "runningBatch": running_batch,
            "missingTranscript": [
                {"id": item["id"], "collection": item["collection"], "title": item["title"]}
                for item in missing_items
            ],
            "failures": failures,
        },
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collection",
        choices=("all", *COLLECTIONS),
        default="all",
    )
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--model", default="gpt-5.4")
    parser.add_argument(
        "--reasoning-effort",
        choices=("low", "medium", "high", "xhigh"),
        default="medium",
    )
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--codex")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stop-on-error", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 1 <= args.batch_size <= 5:
        raise SystemExit("--batch-size must be between 1 and 5")
    if args.attempts < 1:
        raise SystemExit("--attempts must be at least 1")
    library = read_json(LIBRARY)
    items = [item for item in library.get("items", []) if isinstance(item, dict)]
    selected = [
        item
        for item in items
        if args.collection == "all" or item.get("collection") == args.collection
    ]
    missing_items = [
        item
        for item in selected
        if not str(item.get("transcript") or "").strip() or int(item.get("transcriptWordCount") or 0) < 20
    ]
    eligible = [item for item in selected if item not in missing_items]
    order = {str(item["id"]): index for index, item in enumerate(items)}
    master = current_master()
    source_by_id = {str(item["id"]): item for item in items}
    ready_ids = set()
    for question_set in master.get("sets", []):
        if not isinstance(question_set, dict) or question_set.get("status") not in READY_STATUSES:
            continue
        source_id = str(question_set.get("sourceId") or "")
        source = source_by_id.get(source_id)
        if source and question_set.get("sourceHash") == source_hash(source):
            ready_ids.add(source_id)
    remaining = [item for item in eligible if str(item["id"]) not in ready_ids]
    batches = [remaining[index : index + args.batch_size] for index in range(0, len(remaining), args.batch_size)]
    if args.max_batches > 0:
        batches = batches[: args.max_batches]
    failures: list[dict[str, Any]] = []
    write_progress(
        master=master,
        eligible_count=len(eligible),
        missing_items=missing_items,
        failures=failures,
        running_batch=None,
    )
    append_log(
        f"Pipeline selected {len(eligible)} eligible source(s), {len(missing_items)} missing, "
        f"{len(ready_ids)} already ready, {len(batches)} batch(es) scheduled"
    )
    if args.dry_run or not batches:
        return
    executable = codex_executable(args.codex)
    for batch_index, batch in enumerate(batches, start=1):
        ids = [str(item["id"]) for item in batch]
        collection = str(batch[0]["collection"])
        first_sequence = int(batch[0].get("sequence") or 0)
        last_sequence = int(batch[-1].get("sequence") or 0)
        batch_dir = OUTPUT_ROOT / "batches" / collection / f"{first_sequence:04d}-{last_sequence:04d}"
        batch_dir.mkdir(parents=True, exist_ok=True)
        write_progress(
            master=master,
            eligible_count=len(eligible),
            missing_items=missing_items,
            failures=failures,
            running_batch=ids,
        )
        append_log(f"Starting batch {batch_index}/{len(batches)}: {', '.join(ids)}")
        try:
            author = author_batch(
                items=batch,
                batch_dir=batch_dir,
                executable=executable,
                args=args,
            )
            reviewed = review_batch(
                author_bank=author,
                batch_dir=batch_dir,
                executable=executable,
                args=args,
            )
            final = adjudicate_batch(
                reviewed_bank=reviewed,
                batch_dir=batch_dir,
                executable=executable,
                args=args,
            )
            shutil.copy2(final, batch_dir / "final-bank.json")
            master = merge_master(final, order)
            append_log(
                f"Completed batch {batch_index}/{len(batches)}; master now has "
                f"{len(master.get('sets', []))} ready set(s)"
            )
        except Exception as error:
            failure = {"sourceIds": ids, "error": str(error), "failedAt": utc_now()}
            failures.append(failure)
            (batch_dir / "failure.txt").write_text(
                f"{error}\n\n{traceback.format_exc()}",
                encoding="utf-8",
            )
            append_log(f"Batch failed: {', '.join(ids)}: {error}")
            if args.stop_on_error:
                raise
        write_progress(
            master=master,
            eligible_count=len(eligible),
            missing_items=missing_items,
            failures=failures,
            running_batch=None,
        )
        time.sleep(2)


if __name__ == "__main__":
    main()
