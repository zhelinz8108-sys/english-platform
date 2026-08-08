import { AlevelCatalogView } from '@/components/alevel-library/alevel-library';

export default async function AlevelSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  return <AlevelCatalogView subjectId={subjectId} />;
}
