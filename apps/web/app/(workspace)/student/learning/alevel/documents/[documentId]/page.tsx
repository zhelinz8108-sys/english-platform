import { AlevelDocumentView } from '@/components/alevel-library/alevel-library';

export default async function StudentAlevelDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return <AlevelDocumentView documentId={documentId} />;
}
