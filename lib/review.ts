import type {
  Annotation,
  ConflictGroup,
  ReviewAnnotationSnapshot,
  ReviewDraft,
  ReviewEvent,
  ReviewEventType,
  TextDocument
} from './types';

export function groupKeyOf(annotation: Pick<Annotation, 'anchorId' | 'kind'>) {
  return `${annotation.anchorId}:${annotation.kind}`;
}

/** 关联注释的内容指纹：归属目标、正文、标题、来源、引用任一变化都会失配。 */
export function annotationFingerprint(annotation: Annotation) {
  return [
    annotation.anchorId,
    annotation.anchorType,
    annotation.title.trim(),
    annotation.body.trim(),
    annotation.source.trim(),
    annotation.references.slice().sort().join('|')
  ].join('');
}

export function snapshotAnnotation(annotation: Annotation): ReviewAnnotationSnapshot {
  return {
    annotationId: annotation.id,
    title: annotation.title,
    body: annotation.body,
    source: annotation.source,
    references: annotation.references.slice()
  };
}

/** 待审稿是否已因关联内容（依据之外的正文/来源/引用）变动而失效。 */
export function isReviewStale(document: TextDocument, review: ReviewDraft): boolean {
  if (review.status !== 'pending') return false;
  if (review.snapshots.length !== review.memberIds.length) return true;
  for (const snapshot of review.snapshots) {
    const current = document.annotations.find((item) => item.id === snapshot.annotationId);
    if (!current) return true;
    if (groupKeyOf(current) !== review.groupKey) return true;
    if (current.conflictState === 'resolved') return true;
    const baseline: Annotation = {
      ...current,
      title: snapshot.title,
      body: snapshot.body,
      source: snapshot.source,
      references: snapshot.references
    };
    if (annotationFingerprint(current) !== annotationFingerprint(baseline)) return true;
  }
  return false;
}

function staleReason(document: TextDocument, review: ReviewDraft): string {
  const currentIds = new Set(
    document.annotations
      .filter((item) => groupKeyOf(item) === review.groupKey && item.conflictState === 'open')
      .map((item) => item.id)
  );
  if (review.memberIds.some((id) => !currentIds.has(id))) {
    return '同组注释被修改或删除、引用目标发生迁移';
  }
  return '同组出现新增来源';
}

function pushEvent(review: ReviewDraft, type: ReviewEventType, actor: string, comment: string, at: string) {
  const event: ReviewEvent = {
    id: `review-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    actor,
    comment,
    at
  };
  review.events.push(event);
}

/** 每次提交后执行：把已失效的待审稿标记为 invalidated，保证旧稿不能再通过。 */
export function syncPendingReviews(document: TextDocument, at: string = new Date().toISOString()) {
  for (const review of document.reviews ?? []) {
    if (review.status === 'pending' && isReviewStale(document, review)) {
      review.status = 'invalidated';
      review.decidedAt = at;
      pushEvent(review, 'invalidated', '系统', `关联注释或引用关系已变更：${staleReason(document, review)}，原待审稿自动失效。`, at);
    }
  }
}

export interface SubmitReviewInput {
  group: ConflictGroup;
  mode: ReviewDraft['mode'];
  sourceAnnotationId?: string;
  candidateTitle: string;
  candidateBody: string;
  basis: string;
  proposedBy: string;
}

/** 形成待审稿；同组已有待审稿时拒绝（调用方应保证 UI 互斥）。 */
export function createReviewDraft(input: SubmitReviewInput, now: string = new Date().toISOString()): ReviewDraft | null {
  const { group } = input;
  if (group.pendingReview) return null;
  const sourceAnnotation = group.annotations.find((item) => item.id === input.sourceAnnotationId);
  if (input.mode === 'source' && !sourceAnnotation) return null;
  if (!input.candidateBody.trim() || !input.candidateTitle.trim() || !input.basis.trim()) return null;

  const review: ReviewDraft = {
    id: `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    groupKey: group.key,
    anchorId: group.anchorId,
    anchorType: group.anchorType,
    kind: group.kind,
    anchorLabel: group.anchorLabel,
    mode: input.mode,
    sourceAnnotationId: input.mode === 'source' ? sourceAnnotation!.id : undefined,
    candidateTitle: input.candidateTitle.trim(),
    candidateBody: input.candidateBody.trim(),
    basis: input.basis.trim(),
    proposedBy: input.proposedBy.trim() || '整理者',
    status: 'pending',
    memberIds: group.annotations.map((item) => item.id),
    snapshots: group.annotations.map(snapshotAnnotation),
    createdAt: now,
    submittedAt: now,
    events: []
  };
  const modeLabel =
    input.mode === 'source' ? `取「${sourceAnnotation!.source}」文字为候选` : '合并各组来源形成候选';
  pushEvent(review, 'submitted', review.proposedBy, `${modeLabel}，依据：${review.basis}`, now);
  return review;
}

/** 审定通过：候选文字统一切换到同组，冲突全部标记已解决，审签记录留存。 */
export function approveReview(
  document: TextDocument,
  reviewId: string,
  reviewer: string,
  note: string,
  now: string = new Date().toISOString()
): boolean {
  const review = document.reviews.find((item) => item.id === reviewId);
  if (!review || review.status !== 'pending') return false;
  // 兜底再校验：送审后关联内容改过则拒绝通过
  syncPendingReviews(document, now);
  if (review.status !== 'pending') return false;

  const members = document.annotations.filter((item) => review.memberIds.includes(item.id));
  for (const annotation of members) {
    annotation.title = review.candidateTitle;
    annotation.body = review.candidateBody;
    annotation.conflictState = 'resolved';
    annotation.status = 'resolved';
    annotation.conflictResolution = `${now} · 审签通过（审签单 ${review.id}）：${review.basis}`;
    annotation.updatedAt = now;
  }
  review.status = 'approved';
  review.reviewer = reviewer.trim() || '审定人';
  review.decidedAt = now;
  pushEvent(
    review,
    'approved',
    review.reviewer,
    note.trim() || '候选稿通过，已统一切换同组文字并标记冲突解决。',
    now
  );
  return true;
}

/** 退回：必须填写原因；原内容一字不动。 */
export function rejectReview(
  document: TextDocument,
  reviewId: string,
  reviewer: string,
  reason: string,
  now: string = new Date().toISOString()
): boolean {
  const review = document.reviews.find((item) => item.id === reviewId);
  if (!review || review.status !== 'pending' || !reason.trim()) return false;
  review.status = 'rejected';
  review.reviewer = reviewer.trim() || '审定人';
  review.rejectReason = reason.trim();
  review.decidedAt = now;
  pushEvent(review, 'rejected', review.reviewer, `退回原因：${reason.trim()}`, now);
  return true;
}

/** 整理者撤回待审稿（可用于改据另拟），旧稿保留但不再可通过。 */
export function withdrawReview(
  document: TextDocument,
  reviewId: string,
  actor: string,
  reason: string,
  now: string = new Date().toISOString()
): boolean {
  const review = document.reviews.find((item) => item.id === reviewId);
  if (!review || review.status !== 'pending') return false;
  review.status = 'withdrawn';
  review.decidedAt = now;
  pushEvent(review, 'withdrawn', actor.trim() || review.proposedBy, reason.trim() || '整理者撤回调改。', now);
  return true;
}

/** 合并候选的默认文字：逐来源标注拼合。 */
export function buildMergedBody(group: ConflictGroup) {
  return group.annotations.map((item) => `【${item.source}】${item.body}`).join('\n\n');
}

export function buildMergedTitle(group: ConflictGroup) {
  return `${group.annotations[0]?.title ?? '合并校记'}（会校）`;
}

/** 历史审签记录（非待审状态），按定案时间倒序。 */
export function visibleReviewHistory(document: TextDocument): ReviewDraft[] {
  return (document.reviews ?? [])
    .filter((review) => review.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.submittedAt).localeCompare(a.decidedAt ?? a.submittedAt));
}
