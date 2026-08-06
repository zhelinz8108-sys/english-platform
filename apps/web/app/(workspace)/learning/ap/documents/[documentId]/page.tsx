import { ApDocumentView } from '@/components/ap-library/ap-library';
export default async function ApDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return <ApDocumentView documentId={documentId} />;
}
