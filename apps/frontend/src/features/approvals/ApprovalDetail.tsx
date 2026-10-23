import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, Calendar, Check, CheckCircle2, Circle, Download, ExternalLink, FileText, Pencil, X, XCircle } from 'lucide-react';
import { formatBytes } from '@legalio/types/documents';
import type { ApprovalDetail as Detail } from '@legalio/types/approvals';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { DialogBody, DialogCloseIcon, DialogHeader, DialogTitle, ModalFrame } from '@legalio/ui-components/dialog';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { APP_PATH } from '../../context/NavigationContext';
import { usePermissions } from '../../lib/permissions';
import { documentsApi } from '../../lib/documentsApi';
import { approvalsApi } from './approvalsApi';
import type { ApprovalDraft } from './ApprovalForm';
import { LOCALE, PersonAvatar, StatusBadge, categoryLabel, formatDateTime } from './approvalUi';

interface Props {
  id: string;
  onBack: () => void;
  onRevise: (draft: ApprovalDraft) => void;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

function downloadHistory(detail: Detail) {
  const rows = [['time', 'actor', 'event', 'message'], ...detail.events.map(e => [e.created_at, e.actor_name ?? e.actor_id, e.kind, e.message])];
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${detail.code}-history.csv` });
  link.click();
  URL.revokeObjectURL(url);
}

export const ApprovalDetail: React.FC<Props> = ({ id, onBack, onRevise }) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const { data: detail, error } = useQuery({ queryKey: ['approval', id], queryFn: () => approvalsApi.get(id) });
  const locale = LOCALE[language];

  if (error) return <Text size="sm" tone="destructive" role="alert">{(error as Error).message}</Text>;
  if (!detail) return <Text size="sm" tone="muted" role="status">{t('common.loading', 'Loading…')}</Text>;

  const currentStep = detail.steps.find(s => s.step_no === detail.current_step);
  const myTurn = detail.status === 'pending' && currentStep?.approver_id === user?.id;
  const approvedSteps = detail.steps.filter(s => s.status === 'approved').length;

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !comment.trim()) {
      showAlert({ title: t('approval.detail.reject_needs_comment', 'Add a comment explaining the rejection.'), variant: 'destructive' });
      return;
    }
    setDeciding(decision);
    try {
      await approvalsApi.decide(id, decision, comment);
      setComment('');
      showAlert({ title: decision === 'approve' ? t('approval.detail.approved_toast', 'Approval granted') : t('approval.detail.rejected_toast', 'Approval rejected'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['approval', id] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      showAlert({ title: t('approval.detail.decision_failed', 'Decision failed'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setDeciding(null);
    }
  };

  const openFile = async () => {
    try {
      if (detail.source === 'document' && detail.document_id) {
        // My Documents (the editor tab) needs document.create; viewers get a read-only preview instead.
        if (hasPermission('document.create')) {
          // No noopener: a same-origin opener lets the new tab inherit this tab's organization (sessionStorage).
          window.open(`${APP_PATH}?${new URLSearchParams({ tab: 'create-contract', document: detail.document_id })}`, '_blank');
          return;
        }
        const doc = await documentsApi.get(detail.document_id);
        setPreview({ name: doc.name, content: doc.content });
        return;
      }
      const res = await fetch(approvalsApi.fileUrl(id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      showAlert({ title: t('approval.detail.open_failed', 'Could not open the file'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const durationMinutes = detail.decided_at ? Math.round((new Date(detail.decided_at).getTime() - new Date(detail.created_at).getTime()) / 60000) : null;
  const eventText = (kind: string, role: string | null) =>
    kind === 'submitted' ? t('approval.event.submitted', 'Request submitted')
      : kind === 'approved' ? t('approval.event.approved', 'Approved as {role}', { role: role ?? '' })
      : t('approval.event.rejected', 'Rejected');
  const roleOf = (actorId: string) => detail.steps.find(s => s.approver_id === actorId)?.approver_role ?? null;

  return (
    <section className="w-full min-w-0 space-y-g21" aria-labelledby="approval-detail-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
        <div className="flex flex-wrap items-center gap-g13">
          <Heading as="h2" size="md" weight="semibold" id="approval-detail-heading">{t('approval.detail.title', 'Approval detail')}</Heading>
          <StatusBadge t={t} status={detail.status} mine={myTurn} />
        </div>
        <Text size="sm" tone="muted">
          {detail.code} • {detail.decided_at
            ? t('approval.detail.finished_at', 'Finished {date}', { date: formatDateTime(detail.decided_at, locale) })
            : t('approval.detail.submitted_at', 'Submitted {date}', { date: formatDateTime(detail.created_at, locale) })}
        </Text>
        </div>
        <Button variant="link" size="sm" type="button" onClick={onBack} className="no-underline hover:underline"><ArrowLeft className="size-g13" aria-hidden />{t('approval.back', 'Back to approvals')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-g21 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-g21">
          <Card className="space-y-g13 p-g21">
            <Heading as="h3" size="sm" weight="semibold">{detail.title}</Heading>
            <div className="flex flex-wrap items-center justify-between gap-g13">
              <div className="flex items-center gap-g8">
                <PersonAvatar name={detail.created_by_name} size="md" />
                <div>
                  <Text size="xs" tone="muted">{t('approval.detail.submitted_by', 'Submitted by')}</Text>
                  <Text size="sm" weight="semibold">{detail.created_by_name}</Text>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-g13 text-muted-foreground">
                <Text size="xs" className="flex items-center gap-g5"><Briefcase className="size-g13" aria-hidden />{categoryLabel(t, detail.category)}</Text>
                <Text size="xs" className="flex items-center gap-g5"><Calendar className="size-g13" aria-hidden />{formatDateTime(detail.created_at, locale)}</Text>
              </div>
            </div>
            {detail.note && <div className="rounded-lg bg-status-info-soft p-g13"><Text size="sm" className="whitespace-pre-wrap">{detail.note}</Text></div>}
            <div className="flex items-center gap-g13 rounded-lg bg-muted/40 p-g13">
              <span className="flex size-g34 shrink-0 items-center justify-center rounded-md bg-status-danger-soft text-status-danger"><FileText className="size-g16" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <Text size="sm" weight="semibold" className="truncate">{detail.file_name}</Text>
                <Text size="xs" tone="muted">
                  {detail.source === 'document' ? t('approval.detail.from_my_documents', 'My Documents') : detail.file_name.split('.').pop()?.toUpperCase()} • {formatBytes(detail.file_size)}
                </Text>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={openFile}><ExternalLink className="size-g13" aria-hidden />{t('approval.detail.open', 'Open')}</Button>
            </div>
          </Card>

          <Card className="space-y-g13 p-g21">
            <div className="flex items-center justify-between">
              <Heading as="h3" size="sm" weight="semibold">{t('approval.detail.history', 'Approval history')}</Heading>
              <Text size="xs" tone="muted">{t('approval.detail.activity_count', '{count} activities', { count: detail.events.length })}</Text>
            </div>
            <ol className="relative space-y-g21 before:absolute before:bottom-g13 before:left-[1.05rem] before:top-g13 before:w-px before:bg-border">
              {[...detail.events.map(e => ({ key: e.id, name: e.actor_name, title: e.kind === 'submitted' ? eventText(e.kind, null) : e.actor_name, sub: e.kind === 'submitted' ? null : eventText(e.kind, roleOf(e.actor_id)), message: e.message, at: e.created_at })),
                ...detail.steps.filter(s => s.status === 'waiting' && detail.status === 'pending').map(s => ({ key: `wait-${s.step_no}`, name: s.approver_name, title: s.approver_name, sub: t('approval.event.waiting', 'Waiting for approval'), message: '', at: null as string | null }))]
                .map(item => (
                  <li key={item.key} className="relative flex gap-g13">
                    <PersonAvatar name={item.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-g8">
                        <Text size="sm" weight="semibold">{item.title}</Text>
                        {item.at && <Text size="xs" tone="muted" className="shrink-0">{formatDateTime(item.at, locale)}</Text>}
                      </div>
                      {item.sub && <Text size="xs" tone="muted">{item.sub}</Text>}
                      {item.message && <div className="mt-g5 rounded-md bg-status-info-soft px-g13 py-g8"><Text size="xs" className="whitespace-pre-wrap">{item.message}</Text></div>}
                    </div>
                  </li>
                ))}
            </ol>
          </Card>
        </div>

        {myTurn ? (
          <Card className="flex flex-col gap-g13 p-g21">
            <div>
              <Heading as="h3" size="sm" weight="semibold">{t('approval.detail.your_decision', 'Your decision')}</Heading>
              <Text size="xs" tone="muted">{t('approval.detail.step_of', 'You are approver {step} of {total}.', { step: detail.current_step, total: detail.steps.length })}</Text>
            </div>
            <div className="flex items-center gap-g8 rounded-lg bg-muted/40 p-g13">
              <PersonAvatar name={currentStep?.approver_name ?? null} size="md" />
              <div className="min-w-0 flex-1">
                <Text size="sm" weight="semibold">{currentStep?.approver_name}</Text>
                <Text size="xs" tone="muted" className="capitalize">{currentStep?.approver_role}</Text>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor="approval-comment">{t('approval.detail.comment', 'Decision comment')}</FieldLabel>
              <Textarea id="approval-comment" rows={5} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)}
                placeholder={t('approval.detail.comment_placeholder', 'Add a note for the requester…')} />
            </Field>
            <div className="mt-auto space-y-g8 pt-g13">
              <Button variant="destructive-outline" className="w-full" type="button" loading={deciding === 'reject'} disabled={Boolean(deciding)} onClick={() => decide('reject')}>
                <X className="size-g16" aria-hidden />{t('approval.detail.reject', 'Reject approval')}
              </Button>
              <Button className="w-full" type="button" loading={deciding === 'approve'} disabled={Boolean(deciding)} onClick={() => decide('approve')}>
                <Check className="size-g16" aria-hidden />{t('approval.detail.approve', 'Approve')}
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-g13">
            <Card className="space-y-g8 p-g21">
              <Heading as="h3" size="sm" weight="semibold">{t('approval.detail.info', 'Approval information')}</Heading>
              <dl className="grid grid-cols-2 gap-g8 text-sm">
                <dt className="text-muted-foreground">{t('approval.detail.status', 'Status')}</dt>
                <dd className="text-right"><StatusBadge t={t} status={detail.status} /></dd>
                {durationMinutes !== null && <>
                  <dt className="text-muted-foreground">{t('approval.detail.duration', 'Duration')}</dt>
                  <dd className="text-right font-semibold">{t('approval.detail.minutes', '{n} min', { n: durationMinutes })}</dd>
                </>}
                <dt className="text-muted-foreground">{t('approval.detail.steps', 'Steps')}</dt>
                <dd className="text-right font-semibold">{t('approval.detail.steps_done', '{done} of {total} done', { done: approvedSteps, total: detail.steps.length })}</dd>
              </dl>
            </Card>
            <Card className="space-y-g13 p-g21">
              <Heading as="h3" size="sm" weight="semibold">{t('approval.detail.approvers', 'Approvers')}</Heading>
              {detail.steps.map(s => (
                <div key={s.step_no} className="flex items-center gap-g8">
                  <PersonAvatar name={s.approver_name} size="md" />
                  <div className="min-w-0 flex-1">
                    <Text size="sm" weight="semibold">{s.approver_name}</Text>
                    <Text size="xs" tone="muted" className="capitalize">{s.approver_role}</Text>
                  </div>
                  {s.status === 'approved' ? <CheckCircle2 className="size-g16 text-status-success" aria-label={t('approval.status.approved', 'Approved')} />
                    : s.status === 'rejected' ? <XCircle className="size-g16 text-status-danger" aria-label={t('approval.status.rejected', 'Rejected')} />
                    : <Circle className="size-g16 text-muted-foreground" aria-label={t('approval.status.pending', 'Waiting')} />}
                </div>
              ))}
            </Card>
            {detail.created_by === user?.id && detail.status !== 'pending' && (
              <Button variant="outline" className="w-full" type="button"
                onClick={() => onRevise({ title: detail.title, category: detail.category, note: detail.note, approverIds: detail.steps.map(s => s.approver_id), documentId: detail.document_id ?? undefined })}>
                <Pencil className="size-g16" aria-hidden />{t('approval.detail.revise', 'Create revision')}
              </Button>
            )}
            <Button variant="outline" className="w-full" type="button" onClick={() => downloadHistory(detail)}>
              <Download className="size-g16" aria-hidden />{t('approval.detail.download', 'Download history')}
            </Button>
          </div>
        )}
      </div>

      {preview && (
        <ModalFrame size="lg" onClose={() => setPreview(null)}>
          <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
            <DialogTitle>{preview.name}</DialogTitle>
            <DialogCloseIcon aria-label={t('common.close', 'Close')} />
          </DialogHeader>
          <DialogBody className="mt-0 p-0">
            {/* sandbox with no allowances: stored document HTML can never run script here. */}
            <iframe title={preview.name} sandbox="" srcDoc={preview.content} className="h-[70vh] w-full bg-white" />
          </DialogBody>
        </ModalFrame>
      )}
    </section>
  );
};
