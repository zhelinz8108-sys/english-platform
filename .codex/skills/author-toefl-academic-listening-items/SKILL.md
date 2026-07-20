---
name: author-toefl-academic-listening-items
description: Author, blind-review, adjudicate, and validate transcript-grounded four-option TOEFL Academic Listening items. Use for TOEFL Academic Talk-style item writing from listening-library sources, especially Minute Earth and BBC 6 Minute English, including batch preparation, Chinese guided-practice explanations, evidence spans, source-hash resume checks, and assessment-item quality control.
---

# Author TOEFL Academic Listening Items

Create exactly four English single-choice questions for each selected listening item. Keep
answers, evidence, and Chinese feedback private until the learner submits an answer.

## Load the required references

1. Read references/toefl-academic-talk-rubric.md before authoring or reviewing questions.
2. Read references/source-profiles.md for the selected collection.
3. Read references/question-bank-schema.md before writing any JSON result.

Do not copy official test questions into prompts or outputs. Use only the abstract item-writing
patterns in the rubric.

## Choose the workflow

### Author a batch

1. Run scripts/prepare_batch.py in author mode. Default to five unprocessed items.
2. Generate one draft set per payload item using the matching source profile.
3. Save a question-bank JSON document that follows the reference schema.
4. Use scripts/locate_evidence.py to obtain exact Python character offsets for selected quotes.
5. Run scripts/validate_question_sets.py with the original listening library.
6. Correct every error. Treat warnings as review prompts rather than silently ignoring them.

### Blind-review a batch

1. Start a separate Codex task that has not seen the private answer fields.
2. Run scripts/prepare_batch.py in review mode against the draft bank. The payload deliberately
   excludes answers, evidence, and explanations.
3. Answer each question only from the transcript and flag ambiguous or unsupported items.
4. Save a review-result JSON document and run scripts/reconcile_reviews.py.

### Adjudicate disagreements

1. Prepare an adjudication payload from a reconciled bank whose status is
   needs_adjudication.
2. Use a third, separate Codex task. Return a complete replacement private block for every
   disputed question, not only a final option letter.
3. Reconcile the adjudication result, then validate the complete bank again.

Never mark a set approved automatically. Reserve approved for a named human reviewer with a
timestamp.

## Use the scripts

From the project root, use commands in this form:

    python .codex/skills/author-toefl-academic-listening-items/scripts/prepare_batch.py \
      --library apps/web/data/listening-library.json --collection minute-earth \
      --mode author --output outputs/toefl-academic-listening/author-payload.json

    python .codex/skills/author-toefl-academic-listening-items/scripts/validate_question_sets.py \
      --library apps/web/data/listening-library.json \
      --input outputs/toefl-academic-listening/draft-bank.json

    python .codex/skills/author-toefl-academic-listening-items/scripts/reconcile_reviews.py \
      --author outputs/toefl-academic-listening/draft-bank.json \
      --review outputs/toefl-academic-listening/review-result.json \
      --output outputs/toefl-academic-listening/reconciled-bank.json

Pass --existing-bank to author preparation for source-hash-aware resume behavior. Use --force
only when deliberately regenerating unchanged sources.

## Enforce non-negotiable quality rules

- Write exactly four options and one uniquely defensible answer.
- Ground every answer in exact transcript character spans.
- Use at most two pure-detail questions and at least one higher-order question.
- Cover evidence from the beginning, middle, and end of the complete audio.
- Keep public and private fields separated. Never send private fields to the learner client.
- Treat all difficulty labels as provisional content judgments, not calibrated item parameters.
- Reject trivia, outside-knowledge questions, grammatical giveaways, implausible distractors,
  and questions answerable without listening.
- Keep BBC items labeled TOEFL-style Academic Listening Practice; do not describe the full
  six-minute program as an exact-duration TOEFL Academic Talk simulation.
