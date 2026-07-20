import {
  getLocalListeningItem,
  getLocalListeningQuestionBankStatus,
  getLocalListeningQuestionSet,
  localListeningEnabled,
} from '@/lib/local-listening-library.server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localListeningEnabled()) {
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  }
  const { id } = await context.params;
  const item = getLocalListeningItem(id);
  if (!item) return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  const [questionSet, questionBankStatus] = await Promise.all([
    getLocalListeningQuestionSet(id),
    getLocalListeningQuestionBankStatus(id),
  ]);
  const studyAidsLocked = questionBankStatus === 'ready';
  const encodedId = encodeURIComponent(item.id);
  return Response.json(
    {
      id: item.id,
      sequence: item.sequence,
      title: item.title,
      publishedAt: item.publishedAt,
      durationSeconds: item.durationSeconds,
      transcriptWordCount: item.transcriptWordCount,
      transcript: studyAidsLocked ? '' : item.transcript,
      vocabulary: studyAidsLocked ? [] : item.vocabulary,
      studyAidsLocked,
      questionBankStatus,
      questionSet,
      playbackUrl: item.audioPath ? `/api/local-listening/${encodedId}/media?type=audio` : null,
      documentUrl: item.documentPath
        ? `/api/local-listening/${encodedId}/media?type=document`
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
