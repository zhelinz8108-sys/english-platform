import { AlevelCatalogView } from '@/components/alevel-library/alevel-library';

export default async function StudentAlevelSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  return <AlevelCatalogView subjectId={subjectId} />;
}
