import { notFound } from 'next/navigation';
import { ToeflReadingPage } from '../../page';

export default async function GradeReadingPage({
  params,
}: {
  params: Promise<{ grade: string }>;
}) {
  const { grade: rawGrade } = await params;
  const grade = Number(rawGrade);

  if (!Number.isInteger(grade) || grade < 3 || grade > 12) {
    notFound();
  }

  return <ToeflReadingPage initialGrade={grade} />;
}
