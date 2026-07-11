import { AssignmentForm } from '@/components/assignment-form';
import { PageHeader } from '@/components/ui';

export default function NewAssignmentPage() {
  return (
    <>
      <PageHeader
        description="选择已发布版本、真实受众与时间规则，发布后系统会确定性物化学生任务。"
        eyebrow="教师工作台"
        title="布置任务"
      />
      <AssignmentForm />
    </>
  );
}
