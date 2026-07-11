export interface SnapshotQuestion {
  id: string;
  questionVersionId: string;
  answerKey: unknown;
  maxScore: number;
  scoringRule?: Record<string, unknown>;
}

export interface AutoGradeResult {
  score: number;
  maxScore: number;
  fullyAutoGradable: boolean;
  components: Array<{
    snapshotItemId: string;
    score: number;
    maxScore: number;
    correct: boolean | null;
  }>;
}

function normalized(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  if (typeof value === 'string') return value.trim().toLocaleLowerCase('en-US');
  return JSON.stringify(value);
}

function expectedAnswer(answerKey: unknown): unknown {
  if (!answerKey || typeof answerKey !== 'object' || Array.isArray(answerKey)) return answerKey;
  const key = answerKey as Record<string, unknown>;
  const optionIds = key.correct_option_ids;
  if (Array.isArray(optionIds)) return optionIds.length === 1 ? optionIds[0] : optionIds;
  if ('correct_value' in key) return key.correct_value;
  if ('accepted_answers' in key && Array.isArray(key.accepted_answers)) return key.accepted_answers;
  return answerKey;
}

export function autoGrade(
  questions: SnapshotQuestion[],
  responses: Record<string, unknown>,
): AutoGradeResult {
  let score = 0;
  let maxScore = 0;
  let fullyAutoGradable = true;
  const components = questions.map((question) => {
    maxScore += question.maxScore;
    if (question.answerKey === null || question.answerKey === undefined) {
      fullyAutoGradable = false;
      return {
        snapshotItemId: question.id,
        score: 0,
        maxScore: question.maxScore,
        correct: null,
      };
    }
    const response = responses[question.id] ?? responses[question.questionVersionId];
    const expected = expectedAnswer(question.answerKey);
    const correct =
      Array.isArray(expected) && !Array.isArray(response)
        ? expected.some((candidate) => normalized(candidate) === normalized(response))
        : normalized(response) === normalized(expected);
    const itemScore = correct ? question.maxScore : 0;
    score += itemScore;
    return {
      snapshotItemId: question.id,
      score: itemScore,
      maxScore: question.maxScore,
      correct,
    };
  });
  return { score, maxScore, fullyAutoGradable, components };
}
