export type ApDocumentType = 'question' | 'answer' | 'combined' | 'reference';

export interface ApSubject {
  id: string;
  label: string;
  category: string;
  questionDocumentCount: number;
  answerDocumentCount: number;
  referenceDocumentCount: number;
  mediaCount: number;
}

export interface ApDocumentSummary {
  id: string;
  subjectId: string;
  relativePath: string;
  title: string;
  year: number | null;
  sizeBytes: number;
  sha256: string;
  mediaType: string;
  originalStorageKey: string;
  nativeStorageKey?: string;
  documentType: ApDocumentType;
  answerDocumentIds: string[];
  duplicatePaths?: string[];
  hasEmbeddedAnswers?: boolean;
  pageCount?: number;
  questionCount?: number;
  textStatus?: 'native' | 'ocr' | 'scan' | 'error';
}

export interface ApMediaSummary {
  id: string;
  subjectId: string;
  relativePath: string;
  title: string;
  year: number | null;
  sizeBytes: number;
  sha256: string;
  mediaType: string;
  originalStorageKey: string;
}

export interface ApCatalog {
  schemaVersion: number;
  source: string;
  subjects: ApSubject[];
  documents: ApDocumentSummary[];
  media: ApMediaSummary[];
  summary: {
    sourceFileCount: number;
    uniqueDocumentCount: number;
    mediaFileCount: number;
    questionDocumentCount: number;
    answerDocumentCount: number;
    referenceDocumentCount: number;
    duplicateDocumentCount: number;
    totalBytes: number;
  };
}

export interface ApNativeBlock {
  type: 'text';
  text: string;
  bbox: [number, number, number, number];
}

export interface ApNativeQuestion {
  number: number;
  prompt: string;
  options: Array<{ label: string; text: string }>;
}

export interface ApNativeDocument {
  schemaVersion: number;
  documentId: string;
  title: string;
  documentType: ApDocumentType;
  textStatus: 'native' | 'ocr' | 'scan' | 'error';
  pages: Array<{
    number: number;
    width: number;
    height: number;
    blocks: ApNativeBlock[];
    questions: ApNativeQuestion[];
  }>;
}
