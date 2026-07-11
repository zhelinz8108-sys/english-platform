import { TeacherStudentDetail } from '@/components/teacher-student-detail';

export default async function TeacherStudentDetailPage({
  params,
}: {
  params: Promise<{ studentMembershipId: string }>;
}) {
  const { studentMembershipId } = await params;
  return <TeacherStudentDetail studentMembershipId={studentMembershipId} />;
}
