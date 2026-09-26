export type ViewMode = 'reading' | 'editing' | 'critical';
export type AnchorType = 'chapter' | 'sentence' | 'word';
export type AnnotationKind = 'footnote' | 'variant' | 'background' | 'crossref';
export type AnnotationStatus = 'open' | 'resolved';

export interface TextToken {
  id: string;
  text: string;
}

export interface Sentence {
  id: string;
  order: number;
  text: string;
  tokens: TextToken[];
}

export interface Chapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  sentences: Sentence[];
}

export interface Annotation {
  id: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  status: AnnotationStatus;
  tags: string[];
  conflictState: 'open' | 'resolved';
  conflictResolution?: string;
  updatedAt: string;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  note: string;
  createdAt: string;
  chapters: Chapter[];
  annotations: Annotation[];
  reviews: ReviewDraft[];
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'invalidated' | 'withdrawn';
export type ReviewMode = 'source' | 'merge';
export type ReviewEventType = 'submitted' | 'approved' | 'rejected' | 'invalidated' | 'withdrawn';

export interface ReviewAnnotationSnapshot {
  annotationId: string;
  title: string;
  body: string;
  source: string;
  references: string[];
}

export interface ReviewEvent {
  id: string;
  type: ReviewEventType;
  actor: string;
  comment: string;
  at: string;
}

export interface ReviewDraft {
  id: string;
  groupKey: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  anchorLabel: string;
  mode: ReviewMode;
  sourceAnnotationId?: string;
  candidateTitle: string;
  candidateBody: string;
  basis: string;
  proposedBy: string;
  status: ReviewStatus;
  memberIds: string[];
  snapshots: ReviewAnnotationSnapshot[];
  reviewer?: string;
  rejectReason?: string;
  createdAt: string;
  submittedAt: string;
  decidedAt?: string;
  events: ReviewEvent[];
}

export interface TextDocument {
  id: string;
  title: string;
  author: string;
  edition: string;
  chapters: Chapter[];
  annotations: Annotation[];
  reviews: ReviewDraft[];
  snapshots: VersionSnapshot[];
  updatedAt: string;
}

export interface WorkspaceState {
  document: TextDocument;
  mode: ViewMode;
  selectedChapterId: string;
  selectedSentenceId: string;
  selectedAnnotationId: string | null;
  query: string;
  dirty: boolean;
}

export interface EditorState {
  workspace: WorkspaceState;
  past: WorkspaceState[];
  future: WorkspaceState[];
  lastAction: string;
}

export interface SearchResult {
  chapterId: string;
  sentenceId?: string;
  annotationId?: string;
  title: string;
  excerpt: string;
  kind: 'text' | 'annotation';
}

export interface ConflictGroup {
  key: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  anchorLabel: string;
  annotations: Annotation[];
  pendingReview: ReviewDraft | null;
  latestReview: ReviewDraft | null;
}
