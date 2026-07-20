# Question-bank schema

Use schemaVersion 1 and skillVersion 1.0.0.

## Author bank

    {
      "schemaVersion": 1,
      "skillVersion": "1.0.0",
      "generatedAt": "ISO-8601 timestamp",
      "sets": [{
        "sourceId": "minute-earth-001",
        "collection": "minute-earth",
        "profile": "minute-earth-academic-talk",
        "sourceHash": "64 lowercase hex characters",
        "label": "TOEFL Academic Listening Practice",
        "exactSimulation": true,
        "status": "draft",
        "audioDifficulty": {"level": "medium", "basis": "provisional-content-analysis"},
        "questions": [{
          "id": "minute-earth-001-q01",
          "position": 1,
          "type": "main_idea",
          "difficulty": "medium",
          "public": {
            "prompt": "What is the main topic of the talk?",
            "options": [
              {"id": "a", "text": "..."},
              {"id": "b", "text": "..."},
              {"id": "c", "text": "..."},
              {"id": "d", "text": "..."}
            ]
          },
          "private": {
            "answer": "a",
            "evidence": [{"start": 0, "end": 42, "quote": "exact transcript substring"}],
            "explanationZh": "中文解析",
            "optionRationalesZh": {"a": "...", "b": "...", "c": "...", "d": "..."}
          }
        }]
      }]
    }

Allowed statuses are draft, reviewed, needs_adjudication, adjudicated, and approved. An approved
set must include humanApproval with nonempty approvedBy and approvedAt fields.

## Blind review result

    {
      "schemaVersion": 1,
      "mode": "review-result",
      "reviews": [{
        "sourceId": "minute-earth-001",
        "sourceHash": "...",
        "answers": [{
          "questionId": "minute-earth-001-q01",
          "answer": "a",
          "ambiguous": false,
          "reasonZh": "中文复核理由"
        }]
      }]
    }

An adjudication result uses mode adjudication-result. For every disputed question, replace
answer, evidence, explanationZh, and all four optionRationalesZh together. Never replace only
the answer letter.
