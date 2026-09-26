import type {
  Annotation,
  AnnotationKind,
  CollationReview,
  ConflictGroup,
  EditorState,
  ReviewMode,
  SearchResult,
  Sentence,
  TextDocument,
  WorkspaceState
} from './types';

export const STORAGE_KEY = 'sologsb-1022/public-text-annotator/v1';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createInitialWorkspace(document: TextDocument): WorkspaceState {
  return {
    document: clone(document),
    mode: 'reading',
    selectedChapterId: document.chapters[0]?.id ?? '',
    selectedSentenceId: document.chapters[0]?.sentences[0]?.id ?? '',
    selectedAnnotationId: null,
    query: '',
    dirty: false
  };
}

export function createInitialEditorState(document: TextDocument): EditorState {
  return {
    workspace: createInitialWorkspace(document),
    past: [],
    future: [],
    lastAction: '已载入整理底本'
  };
}

function pushHistory(state: EditorState, next: WorkspaceState, label: string): EditorState {
  return {
    workspace: next,
    past: [...state.past.slice(-39), clone(state.workspace)],
    future: [],
    lastAction: label
  };
}

export type EditorAction =
  | { type: 'hydrate'; workspace: WorkspaceState }
  | { type: 'commit'; label: string; mutate: (document: TextDocument) => void }
  | { type: 'selectChapter'; chapterId: string }
  | { type: 'selectSentence'; chapterId: string; sentenceId: string }
  | { type: 'selectAnnotation'; annotationId: string | null }
  | { type: 'setMode'; mode: WorkspaceState['mode'] }
  | { type: 'setQuery'; query: string }
  | { type: 'undo' }
  | { type: 'redo' };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'hydrate':
      return {
        workspace: action.workspace,
        past: [],
        future: [],
        lastAction: '已恢复离线草稿'
      };
    case 'commit': {
      const next = clone(state.workspace);
      action.mutate(next.document);
      next.document.updatedAt = new Date().toISOString();
      next.dirty = true;
      return pushHistory(state, next, action.label);
    }
    case 'selectChapter': {
      const chapter = state.workspace.document.chapters.find((item) => item.id === action.chapterId);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedChapterId: action.chapterId,
          selectedSentenceId: chapter?.sentences[0]?.id ?? '',
          selectedAnnotationId: null
        }
      };
    }
    case 'selectSentence':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedChapterId: action.chapterId,
          selectedSentenceId: action.sentenceId,
          selectedAnnotationId: null
        }
      };
    case 'selectAnnotation':
      return {
        ...state,
        workspace: { ...state.workspace, selectedAnnotationId: action.annotationId }
      };
    case 'setMode':
      return { ...state, workspace: { ...state.workspace, mode: action.mode } };
    case 'setQuery':
      return { ...state, workspace: { ...state.workspace, query: action.query } };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        workspace: clone(previous),
        past: state.past.slice(0, -1),
        future: [clone(state.workspace), ...state.future].slice(0, 40),
        lastAction: '已撤销上一步操作'
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        workspace: clone(next),
        past: [...state.past, clone(state.workspace)].slice(-40),
        future: state.future.slice(1),
        lastAction: '已重做上一步操作'
      };
    }
    default:
      return state;
  }
}

export function getSentence(document: TextDocument, sentenceId: string): Sentence | undefined {
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (sentence) return sentence;
  }
  return undefined;
}

export function getTargetLabel(document: TextDocument, annotation: Annotation): string {
  if (annotation.anchorType === 'chapter') {
    return document.chapters.find((chapter) => chapter.id === annotation.anchorId)?.title ?? '未知章节';
  }

  for (const chapter of document.chapters) {
    if (annotation.anchorType === 'sentence') {
      const sentence = chapter.sentences.find((item) => item.id === annotation.anchorId);
      if (sentence) return `${chapter.title} · 第 ${sentence.order} 句`;
    } else {
      for (const sentence of chapter.sentences) {
        const token = sentence.tokens.find((item) => item.id === annotation.anchorId);
        if (token) return `${chapter.title} · “${token.text.trim()}”`;
      }
    }
  }

  return '引用目标已迁移到所属句';
}

export function collectSearchResults(document: TextDocument, query: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];

  const results: SearchResult[] = [];
  for (const chapter of document.chapters) {
    if (chapter.title.toLocaleLowerCase().includes(normalized)) {
      results.push({
        chapterId: chapter.id,
        title: chapter.title,
        excerpt: chapter.summary,
        kind: 'text'
      });
    }
    for (const sentence of chapter.sentences) {
      if (sentence.text.toLocaleLowerCase().includes(normalized)) {
        results.push({
          chapterId: chapter.id,
          sentenceId: sentence.id,
          title: `${chapter.title} · 第 ${sentence.order} 句`,
          excerpt: sentence.text,
          kind: 'text'
        });
      }
    }
  }

  for (const annotation of document.annotations) {
    const searchable = `${annotation.title} ${annotation.body} ${annotation.source}`.toLocaleLowerCase();
    if (searchable.includes(normalized)) {
      const sentence = getSentence(document, annotation.anchorType === 'sentence' ? annotation.anchorId : '');
      results.push({
        chapterId: findChapterIdForAnnotation(document, annotation),
        sentenceId: sentence?.id,
        annotationId: annotation.id,
        title: annotation.title,
        excerpt: `${annotation.source} · ${annotation.body}`,
        kind: 'annotation'
      });
    }
  }

  return results.slice(0, 24);
}

function findChapterIdForAnnotation(document: TextDocument, annotation: Annotation) {
  if (annotation.anchorType === 'chapter') return annotation.anchorId;
  for (const chapter of document.chapters) {
    if (chapter.sentences.some((sentence) => sentence.id === annotation.anchorId)) return chapter.id;
    if (
      annotation.anchorType === 'word' &&
      chapter.sentences.some((sentence) => sentence.tokens.some((token) => token.id === annotation.anchorId))
    ) {
      return chapter.id;
    }
  }
  return document.chapters[0]?.id ?? '';
}

export function getConflictGroups(document: TextDocument): ConflictGroup[] {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of document.annotations) {
    if (annotation.conflictState === 'resolved') continue;
    const key = `${annotation.anchorId}:${annotation.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), annotation]);
  }

  return Array.from(groups.entries())
    .filter(([, items]) => {
      const bodies = new Set(items.map((item) => item.body.trim()));
      return bodies.size > 1;
    })
    .map(([key, items]) => {
      const first = items[0];
      const sentence = first.anchorType === 'sentence' ? getSentence(document, first.anchorId) : undefined;
      const tokenText = findTokenText(document, first.anchorId);
      return {
        key,
        anchorId: first.anchorId,
        anchorType: first.anchorType,
        kind: first.kind,
        anchorLabel: sentence ? `“${sentence.text}”` : tokenText ? `“${tokenText}”` : '文本片段',
        annotations: items
      };
    });
}

function findTokenText(document: TextDocument, tokenId: string) {
  for (const chapter of document.chapters) {
    for (const sentence of chapter.sentences) {
      const token = sentence.tokens.find((item) => item.id === tokenId);
      if (token) return token.text.trim();
    }
  }
  return '';
}

export function kindLabel(kind: AnnotationKind) {
  return {
    footnote: '脚注',
    variant: '异文',
    background: '背景',
    crossref: '互见'
  }[kind];
}

export function computeReviewFingerprint(annotations: Annotation[]): string {
  const material = annotations
    .map((item) => `${item.id}${item.title}${item.body}${item.source}@${item.updatedAt}`)
    .sort()
    .join('|');
  let hash = 5381;
  for (let index = 0; index < material.length; index += 1) {
    hash = (hash * 33) ^ material.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function getReviewGroupAnnotations(
  document: TextDocument,
  review: Pick<CollationReview, 'anchorId' | 'kind'>
): Annotation[] {
  return document.annotations.filter(
    (item) => item.anchorId === review.anchorId && item.kind === review.kind
  );
}

export function isReviewStale(document: TextDocument, review: CollationReview): boolean {
  const related = getReviewGroupAnnotations(document, review);
  const currentIds = related.map((item) => item.id).sort();
  const storedIds = [...review.relatedAnnotationIds].sort();
  if (currentIds.length !== storedIds.length) return true;
  if (currentIds.some((id, index) => id !== storedIds[index])) return true;
  return computeReviewFingerprint(related) !== review.fingerprint;
}

export function invalidateStaleReviews(document: TextDocument): number {
  const now = new Date().toISOString();
  let count = 0;
  for (const review of document.reviews) {
    if (review.status !== 'pending') continue;
    if (isReviewStale(document, review)) {
      review.status = 'invalidated';
      review.reviewedAt = now;
      review.reviewNote = '依据或关联注释在送审后被修改，待审稿自动失效，不能再通过';
      count += 1;
    }
  }
  return count;
}

export function getPendingReview(document: TextDocument, groupKey: string): CollationReview | undefined {
  return document.reviews.find((review) => review.groupKey === groupKey && review.status === 'pending');
}

export interface SubmitReviewInput {
  group: ConflictGroup;
  mode: ReviewMode;
  winnerId: string;
  candidateBody: string;
  candidateSource: string;
  basis: string;
  submittedBy: string;
}

export function submitCollationReview(document: TextDocument, input: SubmitReviewInput): CollationReview {
  const now = new Date().toISOString();
  for (const review of document.reviews) {
    if (review.groupKey === input.group.key && review.status === 'pending') {
      review.status = 'superseded';
      review.reviewedAt = now;
      review.reviewNote = '同组只保留一份待审稿：提交了新待审稿，此稿被取代';
    }
  }

  const related = getReviewGroupAnnotations(document, input.group);
  const review: CollationReview = {
    id: `review-${Date.now().toString(36)}-${document.reviews.length}`,
    groupKey: input.group.key,
    anchorId: input.group.anchorId,
    anchorType: input.group.anchorType,
    kind: input.group.kind,
    anchorLabel: input.group.anchorLabel,
    mode: input.mode,
    winnerId: input.winnerId,
    candidateBody: input.candidateBody,
    candidateSource: input.candidateSource,
    basis: input.basis,
    fingerprint: computeReviewFingerprint(related),
    relatedAnnotationIds: related.map((item) => item.id),
    status: 'pending',
    submittedBy: input.submittedBy,
    submittedAt: now
  };
  document.reviews.push(review);
  return review;
}

export type ApproveReviewResult = 'approved' | 'invalid' | 'missing';

export function approveCollationReview(
  document: TextDocument,
  reviewId: string,
  reviewer: string
): ApproveReviewResult {
  const review = document.reviews.find((item) => item.id === reviewId);
  if (!review || review.status !== 'pending') return 'missing';

  const now = new Date().toISOString();
  if (isReviewStale(document, review)) {
    review.status = 'invalidated';
    review.reviewedAt = now;
    review.reviewNote = '依据或关联注释在送审后被修改，待审稿失效，不能通过';
    return 'invalid';
  }

  const winner = document.annotations.find((item) => item.id === review.winnerId);
  for (const item of document.annotations) {
    if (item.anchorId !== review.anchorId || item.kind !== review.kind) continue;
    item.conflictState = 'resolved';
    item.conflictResolution = `${now} · ${reviewer} 审签通过，统一采用${
      review.mode === 'merge' ? '合并条文' : `来源「${review.candidateSource}」`
    }。依据：${review.basis}`;
    item.updatedAt = now;
  }
  if (winner) winner.body = review.candidateBody;

  review.status = 'approved';
  review.reviewedBy = reviewer;
  review.reviewedAt = now;
  review.reviewNote = `已统一切换同组 ${review.relatedAnnotationIds.length} 条注释并标记冲突解决。依据：${review.basis}`;
  return 'approved';
}

export function rejectCollationReview(
  document: TextDocument,
  reviewId: string,
  reviewer: string,
  reason: string
): boolean {
  const review = document.reviews.find((item) => item.id === reviewId);
  if (!review || review.status !== 'pending') return false;
  review.status = 'rejected';
  review.reviewedBy = reviewer;
  review.reviewedAt = new Date().toISOString();
  review.reviewNote = reason;
  return true;
}

export function updateSentenceText(
  document: TextDocument,
  sentenceId: string,
  text: string,
  tokenize: (value: string, id: string, existing: Sentence['tokens']) => Sentence['tokens']
) {
  let remappedAnnotations = 0;
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (!sentence) continue;
    const previousIds = new Set(sentence.tokens.map((token) => token.id));
    sentence.text = text;
    sentence.tokens = tokenize(text, sentence.id, sentence.tokens);
    const remainingIds = new Set(sentence.tokens.map((token) => token.id));

    for (const annotation of document.annotations) {
      if (annotation.anchorType === 'word' && previousIds.has(annotation.anchorId) && !remainingIds.has(annotation.anchorId)) {
        annotation.anchorId = sentence.id;
        annotation.anchorType = 'sentence';
        annotation.title = `${annotation.title}（引用已随修订迁移）`;
        remappedAnnotations += 1;
      }
    }
    break;
  }
  return remappedAnnotations;
}

export function removeAnnotationReferences(document: TextDocument, removedId: string) {
  for (const annotation of document.annotations) {
    annotation.references = annotation.references.filter((id) => id !== removedId);
  }
}

export function toWorkspace(document: TextDocument, fallback: WorkspaceState): WorkspaceState {
  const chapter = document.chapters.find((item) => item.id === fallback.selectedChapterId) ?? document.chapters[0];
  const sentence = chapter?.sentences.find((item) => item.id === fallback.selectedSentenceId) ?? chapter?.sentences[0];
  return {
    document,
    mode: fallback.mode,
    selectedChapterId: chapter?.id ?? '',
    selectedSentenceId: sentence?.id ?? '',
    selectedAnnotationId: fallback.selectedAnnotationId,
    query: fallback.query,
    dirty: false
  };
}
