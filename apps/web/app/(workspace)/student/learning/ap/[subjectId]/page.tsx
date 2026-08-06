import { ApCatalogView } from '@/components/ap-library/ap-library';
export default async function StudentApSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  return <ApCatalogView subjectId={subjectId} />;
}
