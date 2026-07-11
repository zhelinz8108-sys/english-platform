import { GradingPanel } from '@/components/grading-panel';

export default async function GradingDetailPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <GradingPanel attemptId={attemptId} />;
}
