'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  GrammarLevelId,
  GrammarPracticeResult,
  GrammarPracticeSessionEnvelope,
  GrammarProgressEnvelope,
} from '@english/shared';
import { useWorkspace } from '@/components/workspace-provider';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  normalizeProblem,
  tenantPath,
} from '@/lib/api';

async function localRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (body) headers.set('Content-Type', 'application/json');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const response = await fetch(path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // normalizeProblem supplies a safe fallback.
    }
    throw new ApiProblemError(normalizeProblem(payload, response.status));
  }
  return (await response.json()) as T;
}

export function grammarBasePath(pathname: string): string {
  return pathname.startsWith('/student/')
    ? '/student/learning/english/grammar'
    : '/learning/english/grammar';
}

export function useGrammarPracticeApi() {
  const { currentTenant } = useWorkspace();
  const demo = isDemoMode();
  const base = tenantPath(currentTenant.id, '/learning/grammar');

  return useMemo(
    () => ({
      progress() {
        return demo
          ? localRequest<GrammarProgressEnvelope>(
              'GET',
              '/api/local-grammar-practice?action=progress',
            )
          : apiRequest<GrammarProgressEnvelope>(`${base}/progress`);
      },
      create(topicId: string, level: GrammarLevelId) {
        return demo
          ? localRequest<GrammarPracticeSessionEnvelope>(
              'POST',
              '/api/local-grammar-practice',
              { action: 'create', topicId, level },
              createIdempotencyKey('grammar-practice-create'),
            )
          : apiRequest<GrammarPracticeSessionEnvelope>(`${base}/practice-sessions`, {
              method: 'POST',
              json: { topicId, level },
              idempotencyKey: createIdempotencyKey('grammar-practice-create'),
            });
      },
      get(sessionId: string) {
        return demo
          ? localRequest<GrammarPracticeSessionEnvelope>(
              'GET',
              `/api/local-grammar-practice?sessionId=${encodeURIComponent(sessionId)}`,
            )
          : apiRequest<GrammarPracticeSessionEnvelope>(
              `${base}/practice-sessions/${encodeURIComponent(sessionId)}`,
            );
      },
      answer(sessionId: string, questionId: string, value: string) {
        return demo
          ? localRequest<GrammarPracticeSessionEnvelope>(
              'POST',
              '/api/local-grammar-practice',
              { action: 'answer', sessionId, questionId, value },
              createIdempotencyKey('grammar-practice-answer'),
            )
          : apiRequest<GrammarPracticeSessionEnvelope>(
              `${base}/practice-sessions/${encodeURIComponent(sessionId)}/responses`,
              {
                method: 'POST',
                json: { questionId, value },
                idempotencyKey: createIdempotencyKey('grammar-practice-answer'),
              },
            );
      },
      submit(sessionId: string) {
        return demo
          ? localRequest<GrammarPracticeResult>(
              'POST',
              '/api/local-grammar-practice',
              { action: 'submit', sessionId },
              createIdempotencyKey('grammar-practice-submit'),
            )
          : apiRequest<GrammarPracticeResult>(
              `${base}/practice-sessions/${encodeURIComponent(sessionId)}/submit`,
              {
                method: 'POST',
                idempotencyKey: createIdempotencyKey('grammar-practice-submit'),
              },
            );
      },
    }),
    [base, demo],
  );
}

export function useGrammarProgress() {
  const api = useGrammarPracticeApi();
  const [progress, setProgress] = useState<GrammarProgressEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProgress(await api.progress());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取语法学习进度。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { progress, loading, error, refresh };
}
