'use client';

import { Button, Card, CardBody, Chip, Divider, Input, Textarea } from '@heroui/react';
import {
  AlertTriangle,
  Check,
  FileSignature,
  GitMerge,
  History,
  Send,
  Undo2,
  XCircle
} from 'lucide-react';
import { useState } from 'react';
import { kindLabel } from '@/lib/editor';
import { buildMergedBody, buildMergedTitle, isReviewStale } from '@/lib/review';
import type {
  ConflictGroup,
  ReviewDraft,
  ReviewEventType,
  ReviewStatus,
  TextDocument
} from '@/lib/types';

export interface SubmitReviewPayload {
  group: ConflictGroup;
  mode: ReviewDraft['mode'];
  sourceAnnotationId?: string;
  candidateTitle: string;
  candidateBody: string;
  basis: string;
  proposedBy: string;
}

interface ReviewPanelProps {
  document: TextDocument;
  groups: ConflictGroup[];
  history: ReviewDraft[];
  onSubmit: (payload: SubmitReviewPayload) => void;
  onApprove: (reviewId: string, reviewer: string, note: string) => void;
  onReject: (reviewId: string, reviewer: string, reason: string) => void;
  onWithdraw: (reviewId: string, actor: string, reason: string) => void;
}

const STATUS_META: Record<ReviewStatus, { label: string; color: 'warning' | 'success' | 'danger' | 'default' }> = {
  pending: { label: '待审中', color: 'warning' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已退回', color: 'danger' },
  invalidated: { label: '已失效', color: 'default' },
  withdrawn: { label: '已撤回', color: 'default' }
};

const EVENT_LABEL: Record<ReviewEventType, string> = {
  submitted: '送审',
  approved: '通过',
  rejected: '退回',
  invalidated: '失效',
  withdrawn: '撤回'
};

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}

function EventTimeline({ events }: { events: ReviewDraft['events'] }) {
  return (
    <ol className="space-y-1.5 border-l-2 border-stone-200 pl-3">
      {events.map((event) => (
        <li key={event.id} className="text-[11px] leading-4 text-stone-500">
          <span className="font-semibold text-stone-700">{EVENT_LABEL[event.type]}</span>
          <span className="mx-1">·</span>
          {event.actor}
          <span className="mx-1">·</span>
          {formatTime(event.at)}
          <p className="mt-0.5 text-stone-600">{event.comment}</p>
        </li>
      ))}
    </ol>
  );
}

function CandidateBuilder({
  group,
  onSubmit
}: {
  group: ConflictGroup;
  onSubmit: (payload: SubmitReviewPayload) => void;
}) {
  const [mode, setMode] = useState<ReviewDraft['mode']>('source');
  const [sourceId, setSourceId] = useState(group.annotations[0]?.id ?? '');
  const [title, setTitle] = useState(group.annotations[0]?.title ?? '');
  const [body, setBody] = useState(group.annotations[0]?.body ?? '');
  const [basis, setBasis] = useState('');
  const [proposedBy, setProposedBy] = useState('整理者');
  const [error, setError] = useState('');

  function pickSource(id: string) {
    const annotation = group.annotations.find((item) => item.id === id);
    if (!annotation) return;
    setMode('source');
    setSourceId(id);
    setTitle(annotation.title);
    setBody(annotation.body);
    setError('');
  }

  function mergeAll() {
    setMode('merge');
    setTitle(buildMergedTitle(group));
    setBody(buildMergedBody(group));
    setError('');
  }

  function submit() {
    if (!title.trim() || !body.trim()) {
      setError('候选标题与候选文字不能为空。');
      return;
    }
    if (!basis.trim()) {
      setError('送审前必须填写校勘依据，供审定人核查。');
      return;
    }
    onSubmit({
      group,
      mode,
      sourceAnnotationId: mode === 'source' ? sourceId : undefined,
      candidateTitle: title,
      candidateBody: body,
      basis,
      proposedBy
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-4 text-stone-500">
        第一步：从各来源取文字，或合并为一份候选；第二步：填写依据送审。送审期间各来源原文保持不动，审定通过后才会统一切换。
      </p>
      {group.annotations.map((annotation) => (
        <div
          key={annotation.id}
          className={`rounded-lg border p-3 ${
            mode === 'source' && sourceId === annotation.id ? 'border-amber-400 bg-amber-50/60' : 'border-stone-200 bg-stone-50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <b className="text-sm text-stone-900">{annotation.source}</b>
            <Chip size="sm" variant="flat">{annotation.title}</Chip>
          </div>
          <p className="mt-2 text-xs leading-5 text-stone-600">{annotation.body}</p>
          <div className="mt-2">
            <Button size="sm" variant="flat" color="primary" onPress={() => pickSource(annotation.id)}>
              取此来源文字
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="flat" startContent={<GitMerge className="h-4 w-4" />} onPress={mergeAll}>
        合并各来源为候选
      </Button>

      <Divider />
      <Input size="sm" label="候选标题" value={title} onValueChange={setTitle} />
      <Textarea
        size="sm"
        minRows={3}
        label="候选文字（通过后将统一切换到同组）"
        value={body}
        onValueChange={setBody}
      />
      <Textarea
        size="sm"
        minRows={2}
        label="校勘依据（必填）"
        placeholder="说明取舍或合并的理由，供审定人核查"
        value={basis}
        onValueChange={setBasis}
      />
      <Input size="sm" label="送审人" value={proposedBy} onValueChange={setProposedBy} />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <Button color="primary" className="w-full" size="sm" onPress={submit} startContent={<Send className="h-4 w-4" />}>
        填写依据后送审
      </Button>
    </div>
  );
}

function PendingReviewCard({
  group,
  review,
  document,
  onApprove,
  onReject,
  onWithdraw
}: {
  group: ConflictGroup;
  review: ReviewDraft;
  document: TextDocument;
  onApprove: (reviewId: string, reviewer: string, note: string) => void;
  onReject: (reviewId: string, reviewer: string, reason: string) => void;
  onWithdraw: (reviewId: string, actor: string, reason: string) => void;
}) {
  const [reviewer, setReviewer] = useState('审定人');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const stale = isReviewStale(document, review);

  function approve() {
    if (stale) return;
    onApprove(review.id, reviewer, note);
  }

  function reject() {
    if (!reason.trim()) {
      setError('退回必须填写原因，供整理者修改。');
      return;
    }
    setError('');
    onReject(review.id, reviewer, reason);
  }

  function withdraw() {
    if (!window.confirm('撤回该待审稿？撤回后旧稿不再可通过，可重新拟稿送审。')) return;
    onWithdraw(review.id, review.proposedBy, '整理者撤回，拟修改候选或依据后重新送审。');
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" color="warning" variant="flat">待审稿</Chip>
          <Chip size="sm" variant="bordered">{review.mode === 'source' ? '取单来源' : '合并候选'}</Chip>
          <span className="ml-auto text-[11px] text-stone-500">
            {review.proposedBy} · {formatTime(review.submittedAt)} 送审
          </span>
        </div>
        <h4 className="mt-2 text-sm font-semibold text-stone-900">{review.candidateTitle}</h4>
        <p className="mt-1 whitespace-pre-line text-xs leading-5 text-stone-700">{review.candidateBody}</p>
        <div className="mt-2 rounded-md bg-white/80 p-2 text-xs leading-5 text-stone-600">
          <b className="text-stone-800">校勘依据：</b>
          {review.basis}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-amber-800">
          送审期间同组 {review.memberIds.length} 条来源原文保持不动；审定通过后才统一切换为候选文字。
        </p>
      </div>

      {stale ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          关联注释或引用关系在送审后已变更，本待审稿失效，不能再通过；请重新拟稿送审。
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Input size="sm" label="审定人" value={reviewer} onValueChange={setReviewer} />
        <Input size="sm" label="通过意见（可选）" value={note} onValueChange={setNote} />
      </div>
      <Button
        color="success"
        size="sm"
        className="w-full text-white"
        isDisabled={stale}
        onPress={approve}
        startContent={<Check className="h-4 w-4" />}
      >
        审定通过并统一切换
      </Button>

      <Textarea
        size="sm"
        minRows={2}
        label="退回原因（退回必填）"
        placeholder="说明不通过的理由，原内容保持不动"
        value={reason}
        onValueChange={setReason}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button color="danger" variant="flat" size="sm" className="flex-1" onPress={reject} startContent={<XCircle className="h-4 w-4" />}>
          退回（原内容不动）
        </Button>
        <Button variant="light" size="sm" onPress={withdraw} startContent={<Undo2 className="h-4 w-4" />}>
          撤回重拟
        </Button>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          <History className="h-3 w-3" />审签记录
        </div>
        <EventTimeline events={review.events} />
      </div>
    </div>
  );
}

function HistoryItem({ review }: { review: ReviewDraft }) {
  const meta = STATUS_META[review.status];
  return (
    <Card shadow="none" className="border border-stone-200">
      <CardBody className="gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" color={meta.color} variant="flat">{meta.label}</Chip>
          <span className="text-xs font-semibold text-stone-800">{review.candidateTitle}</span>
          <span className="ml-auto text-[11px] text-stone-400">{formatTime(review.decidedAt ?? review.submittedAt)}</span>
        </div>
        <p className="line-clamp-1 font-serif text-xs text-stone-500">{review.anchorLabel}</p>
        <p className="whitespace-pre-line text-xs leading-5 text-stone-600">{review.candidateBody}</p>
        <p className="text-xs leading-5 text-stone-500">
          <b className="text-stone-700">依据：</b>
          {review.basis}
        </p>
        {review.status === 'rejected' && review.rejectReason ? (
          <p className="rounded-md bg-red-50 p-2 text-xs leading-5 text-red-700">
            <b>退回原因：</b>
            {review.rejectReason}
          </p>
        ) : null}
        <EventTimeline events={review.events} />
      </CardBody>
    </Card>
  );
}

export function ReviewPanel({ document, groups, history, onSubmit, onApprove, onReject, onWithdraw }: ReviewPanelProps) {
  return (
    <div className="space-y-4 pr-1">
      <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        校勘审签流程：拟候选 → 填依据送审 → 审定。送审期间原文不动，同组仅一份待审稿；通过后统一切换并标记冲突已解决，退回须写明原因。关联注释之后再被修改，旧待审稿自动失效。
      </div>

      {groups.map((group) => (
        <Card key={group.key} shadow="none" className="border border-amber-200">
          <CardBody className="gap-3 p-3">
            <div>
              <div className="flex items-center gap-2">
                <Chip size="sm" color="warning" variant="flat">{kindLabel(group.kind)}</Chip>
                <span className="text-xs text-stone-500">{group.annotations.length} 个来源</span>
                {group.pendingReview ? <Chip size="sm" color="warning" variant="bordered">待审中</Chip> : null}
              </div>
              <p className="mt-2 line-clamp-2 font-serif text-sm text-stone-800">{group.anchorLabel}</p>
            </div>

            {group.pendingReview ? (
              <PendingReviewCard
                group={group}
                review={group.pendingReview}
                document={document}
                onApprove={onApprove}
                onReject={onReject}
                onWithdraw={onWithdraw}
              />
            ) : (
              <>
                {group.latestReview ? (
                  <div className="rounded-lg bg-stone-50 p-2 text-[11px] leading-4 text-stone-500">
                    上次审签：{STATUS_META[group.latestReview.status].label}
                    {group.latestReview.reviewer ? ` · ${group.latestReview.reviewer}` : ''}
                    {group.latestReview.rejectReason ? ` · ${group.latestReview.rejectReason}` : ''}
                  </div>
                ) : null}
                <CandidateBuilder group={group} onSubmit={onSubmit} />
              </>
            )}
          </CardBody>
        </Card>
      ))}

      {!groups.length ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-green-200 bg-green-50 p-8 text-center">
          <Check className="h-8 w-8 text-green-600" />
          <p className="mt-2 text-sm font-medium text-green-800">当前没有待审的冲突组</p>
          <p className="mt-1 text-xs text-green-700">已通过的审签记录见下方列表，并随 JSON 一并导出。</p>
        </div>
      ) : null}

      {history.length ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500">
            <FileSignature className="h-3.5 w-3.5" />审签记录（{history.length}）
          </div>
          {history.map((review) => (
            <HistoryItem key={review.id} review={review} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
