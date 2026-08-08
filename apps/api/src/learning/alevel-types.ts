export type AlevelDocumentType =
  | 'question'
  | 'mark_scheme'
  | 'grade_threshold'
  | 'examiner_report'
  | 'insert'
  | 'confidential_instructions'
  | 'prerelease_material'
  | 'supporting_file'
  | 'topic_question'
  | 'topic_answer'
  | 'syllabus'
  | 'reference';

export type AlevelSession = 'feb-mar' | 'may-june' | 'oct-nov';
export type AlevelLevel = 'AS' | 'A2';

export interface AlevelSubject {
  id: string;
  label: string;
  category: string;
  syllabusCodes: string[];
  years: number[];
  questionDocumentCount: number;
  topicDocumentCount: number;
  markSchemeCount: number;
  resourceCount: number;
  indexStorageKey: string;
}

export interface AlevelDocumentSummary {
  id: string;
  subjectId: string;
  syllabusCode: string | null;
  relativePath: string;
  title: string;
  year: number | null;
  session: AlevelSession | null;
  level: AlevelLevel | null;
  levelConfidence: 'explicit' | 'inferred' | null;
  paper: number | null;
  variant: number | null;
  documentType: AlevelDocumentType;
  collectionType: 'past-paper' | 'topic' | 'support';
  sizeBytes: number;
  sha256: string;
  mediaType: string;
  relatedResourceIds: string[];
  duplicatePaths: string[];
  originalStorageKey: string;
  metadataStorageKey: string;
  textStatus?: 'native' | 'scan' | 'error';
  pageCount?: number | null;
  questionCount?: number;
}

export interface AlevelCatalog {
  schemaVersion: number;
  releaseVersion: string;
  storagePrefix: string;
  source: string;
  subjects: AlevelSubject[];
  summary: {
    sourceFileCount: number;
    indexedFileCount: number;
    uniqueResourceCount: number;
    duplicateResourceCount: number;
    questionDocumentCount: number;
    topicDocumentCount: number;
    markSchemeCount: number;
    totalBytes: number;
  };
}

export interface AlevelNativeDocument {
  documentId: string;
  title: string;
  textStatus: 'native' | 'scan' | 'error';
  pages: Array<{
    number: number;
    width: number;
    height: number;
    blocks: Array<{
      type: 'text';
      text: string;
      bbox: [number, number, number, number];
    }>;
    questions: Array<{
      number: number;
      prompt: string;
      options: Array<{ label: string; text: string }>;
    }>;
  }>;
}

export interface AlevelDocumentPayload {
  schemaVersion: number;
  document: AlevelDocumentSummary;
  content: AlevelNativeDocument;
  relatedDocuments: AlevelDocumentSummary[];
}

export interface AlevelSubjectIndex {
  schemaVersion: number;
  subject: AlevelSubject;
  documents: AlevelDocumentSummary[];
}
