import { TaskWorkspace } from '@/components/task-workspace';

export default async function StudentTaskDetailPage({
  params,
}: {
  params: Promise<{ taskItemId: string }>;
}) {
  const { taskItemId } = await params;
  return <TaskWorkspace taskItemId={taskItemId} />;
}
