import React, { useEffect, useId, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Check, CheckCheck, FileDown, History, MessageSquarePlus, PenLine, RefreshCw, RotateCcw, X } from 'lucide-react';
import { AiIcon } from '../icons/AiIcon';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { documentsApi, errorMessage } from '../../lib/documentsApi';
import type { CommentAction, CommentStatus, CommentType, DocumentComment } from '@legalio/types/documents';
import {
  addCommentAnchor,
  applySuggestion,
  findTextRange,
  focusComment,
  getSelectionQuote,
  removeCommentAnchor,
  type SelectionQuote,
} from '../../lib/tiptapCommentMark';
import { RelativeTime } from './RelativeTime';

import { Textarea } from '@legalio/ui-components/textarea';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Heading } from '@legalio/ui-components/heading';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Card } from '@legalio/ui-components/card';
import { Empty, EmptyContent, EmptyDescription } from '@legalio/ui-components/empty';
import { Text } from '@legalio/ui-components/text';
import { List, ListItem } from '@legalio/ui-components/list';
import { Skeleton } from '@legalio/ui-components/skeleton';
interface CommentsPanelProps {
  editor: Editor | null;
  documentId: string | null;
  canEdit: boolean;
  /** Saves the document (creating it when new); resolves to its id, or null if saving failed. */
  ensureSaved: () => Promise<string | null>;
  /** Persists editor changes made here (anchors added/removed, suggestions applied). */
  onContentChanged: (kind: 'auto' | 'manual') => void;
  onExportRedline: (comments: DocumentComment[]) => void;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; comments: DocumentComment[] };

interface Composer {
  mode: CommentType;
  range: SelectionQuote | null;
  body: string;
  newText: string;
}

const STATUS_TONE: Record<CommentStatus, StatusTone> = {
  open: 'warning',
  resolved: 'neutral',
  accepted: 'success',
  rejected: 'danger',
};

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  editor,
  documentId,
  canEdit,
  ensureSaved,
  onContentChanged,
  onExportRedline,
}) => {
  const { t } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const idPrefix = useId();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setState({ status: 'ready', comments: [] });
      return;
    }
    let cancelled = false;
    documentsApi
      .listComments(documentId)
      .then((comments) => !cancelled && setState({ status: 'ready', comments }))
      .catch((err) => !cancelled && setState({ status: 'error', message: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [documentId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const fail = (err: unknown) =>
    showAlert({ title: t('documents.msg.action_failed', 'Aksi gagal'), description: errorMessage(err), variant: 'destructive' });

  const comments = state.status === 'ready' ? state.comments : [];
  const topLevel = comments.filter((c) => !c.parent_id);
  const open = topLevel.filter((c) => c.status === 'open');
  const closed = topLevel.filter((c) => c.status !== 'open');
  const openSuggestions = open.filter((c) => c.comment_type === 'suggestion');
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);
  const count = (status: CommentStatus) => topLevel.filter((c) => c.status === status).length;

  const statusLabel = (status: CommentStatus) =>
    ({
      open: t('documents.comments.status_open', 'Terbuka'),
      resolved: t('documents.comments.status_resolved', 'Selesai'),
      accepted: t('documents.comments.status_accepted', 'Diterima'),
      rejected: t('documents.comments.status_rejected', 'Ditolak'),
    })[status];

  const startComposer = (mode: CommentType) => {
    if (!editor) return;
    const range = getSelectionQuote(editor);
    if (mode === 'suggestion' && !range) {
      showAlert({ title: t('documents.comments.select_first', 'Blok teks di dokumen terlebih dahulu'), variant: 'warning' });
      return;
    }
    setComposer({ mode, range, body: '', newText: range?.text ?? '' });
  };

  const submitComposer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composer || !editor) return;
    setBusy('composer');
    try {
      const docId = documentId ?? (await ensureSaved());
      if (!docId) return;
      const created = await documentsApi.addComment(docId, {
        comment_type: composer.mode,
        body: composer.body,
        quote: composer.range?.text,
        new_text: composer.mode === 'suggestion' ? composer.newText : undefined,
      });
      const anchored =
        composer.range !== null &&
        addCommentAnchor(editor, composer.range, { commentId: created.id, kind: created.comment_type, suggestion: created.new_text });
      if (composer.range && !anchored) {
        showAlert({ title: t('documents.comments.anchor_moved', 'Teks yang dipilih berubah; komentar disimpan tanpa penanda di dokumen.'), variant: 'warning' });
      }
      setComposer(null);
      if (anchored) onContentChanged('auto');
      reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const applyToEditor = (comment: DocumentComment, action: CommentAction) => {
    if (!editor || action === 'reopen') return false;
    return action === 'accept' ? applySuggestion(editor, comment.id, comment.new_text ?? '') : removeCommentAnchor(editor, comment.id);
  };

  const act = async (comment: DocumentComment, action: CommentAction) => {
    if (!documentId) return;
    setBusy(comment.id);
    try {
      await documentsApi.commentAction(documentId, comment.id, action);
      const changed = applyToEditor(comment, action);
      if (action === 'accept' && !changed) {
        showAlert({ title: t('documents.comments.accept_missing', 'Teks asli tidak ditemukan lagi di dokumen — terapkan perubahan secara manual.'), variant: 'warning' });
      }
      if (changed) onContentChanged(action === 'accept' ? 'manual' : 'auto');
      reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const bulk = async (action: 'accept' | 'reject') => {
    if (!documentId || openSuggestions.length === 0) return;
    const ok = await confirmDialog({
      description:
        action === 'accept'
          ? t('documents.comments.accept_all_confirm', 'Terima semua {n} usulan terbuka dan terapkan ke dokumen?', { n: openSuggestions.length })
          : t('documents.comments.reject_all_confirm', 'Tolak semua {n} usulan terbuka?', { n: openSuggestions.length }),
      tone: action === 'reject' ? 'danger' : undefined,
    });
    if (!ok) return;
    setBusy('bulk');
    let changed = false;
    let failed = 0;
    for (const suggestion of openSuggestions) {
      try {
        await documentsApi.commentAction(documentId, suggestion.id, action);
        changed = applyToEditor(suggestion, action) || changed;
      } catch {
        failed++;
      }
    }
    setBusy(null);
    if (changed) onContentChanged(action === 'accept' ? 'manual' : 'auto');
    if (failed) showAlert({ title: t('documents.comments.bulk_partial', '{n} usulan gagal diproses.', { n: failed }), variant: 'warning' });
    reload();
  };

  const runAiRedlining = async () => {
    if (!editor) return;
    setBusy('ai-redline');
    try {
      const docId = documentId ?? (await ensureSaved());
      if (!docId) return;
      const plainText = editor.getText({ blockSeparator: ' ' }).trim();
      if (!plainText) return;
      const { created } = await documentsApi.aiRedline(docId, plainText);
      let anchored = 0;
      for (const item of created) {
        const range = findTextRange(editor, item.quote);
        if (range && addCommentAnchor(editor, range, { commentId: item.id, kind: 'suggestion', suggestion: item.new_text })) {
          anchored++;
        }
      }
      if (anchored) onContentChanged('auto');
      reload();
      showAlert(
        created.length > 0
          ? { title: t('documents.comments.ai_redline_done', 'AI added {n} suggestion(s).', { n: created.length }), variant: 'success' }
          : { title: t('documents.comments.ai_redline_none', "AI didn't find any new suggestions."), variant: 'default' },
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyTo || !documentId || !replyTo.body.trim()) return;
    setBusy(replyTo.id);
    try {
      await documentsApi.addComment(documentId, { body: replyTo.body, parent_id: replyTo.id });
      setReplyTo(null);
      reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const jumpTo = (comment: DocumentComment) => {
    if (editor && !focusComment(editor, comment.id)) {
      showAlert({ title: t('documents.comments.not_in_document', 'Penanda komentar ini tidak ada lagi di dokumen.'), variant: 'warning' });
    }
  };

  const renderCard = (comment: DocumentComment) => {
    const isSuggestion = comment.comment_type === 'suggestion';
    const isBusy = busy === comment.id || busy === 'bulk';
    const replies = repliesOf(comment.id);
    return (
      <Card asChild key={comment.id}><li className="p-g13 space-y-g5 text-xs" aria-busy={isBusy}>
        <div className="flex items-start justify-between gap-g8">
          <Text size="xs">
            <span className="font-bold text-foreground ">{comment.author_name || '—'}</span>{' '}
            <span className="text-muted-foreground">
              · {isSuggestion ? t('documents.comments.suggestion', 'Usulan') : t('documents.comments.comment', 'Komentar')} ·{' '}
              <RelativeTime iso={comment.created_at} />
            </span>
          </Text>
          <Badge tone={STATUS_TONE[comment.status]} className="shrink-0">{statusLabel(comment.status)}</Badge>
        </div>

        {comment.quote && (
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm"
            onClick={() => jumpTo(comment)}
            className="h-auto w-full justify-start whitespace-normal rounded-s-none border-s-2 border-status-warning-border py-g3 text-start text-xs font-normal text-muted-foreground"
          >
            {isSuggestion ? <del className="text-status-danger">{comment.quote}</del> : <q>{comment.quote}</q>}
          </Button></TooltipTrigger><TooltipBody>{t('documents.comments.jump', 'Lompat ke teks di dokumen')}</TooltipBody></Tooltip>
        )}
        {isSuggestion && (
          <Text size="xs">
            →{' '}
            {comment.new_text ? (
              <ins className="text-status-success font-semibold">{comment.new_text}</ins>
            ) : (
              <em className="text-muted-foreground">{t('documents.comments.deletion', '(hapus teks)')}</em>
            )}
          </Text>
        )}
        {comment.body && <Text size="sm" className="whitespace-pre-wrap">{comment.body}</Text>}
        {comment.resolved_at && (
          <Text size="xs" tone="muted">
            {statusLabel(comment.status)} · {comment.resolved_by_name || '—'} · <RelativeTime iso={comment.resolved_at} />
          </Text>
        )}

        {replies.length > 0 && (
          <List marker="none" className="space-y-g3 pl-g13 border-l border-border">
            {replies.map((reply) => (
              <ListItem key={reply.id} className="text-xs">
                <span className="font-bold text-foreground ">{reply.author_name || '—'}</span>{' '}
                <span className="text-muted-foreground">
                  · <RelativeTime iso={reply.created_at} />
                </span>
                <Text size="sm" className="whitespace-pre-wrap">{reply.body}</Text>
              </ListItem>
            ))}
          </List>
        )}

        {replyTo?.id === comment.id ? (
          <form onSubmit={submitReply} className="space-y-g3">
            <Textarea aria-label={t('documents.comments.reply', 'Balas')}
              id={`${idPrefix}-reply-${comment.id}`}
              autoFocus
              rows={2}
              value={replyTo.body}
              onChange={(e) => setReplyTo({ id: comment.id, body: e.target.value })}
            />
            <div className="flex gap-g3">
              <Button type="submit" size="sm" disabled={isBusy || !replyTo.body.trim()}>
                {t('documents.comments.send', 'Kirim')}
              </Button>
              <Button variant="ghost" type="button" onClick={() => setReplyTo(null)} size="sm">
                {t('common.cancel', 'Batal')}
              </Button>
            </div>
          </form>
        ) : (
          canEdit &&
          documentId && (
            <div className="flex flex-wrap gap-g3">
              {comment.status === 'open' && isSuggestion && (
                <>
                  <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'accept')} size="sm">
                    <Check className="w-g13 h-g13 text-status-success" aria-hidden /> {t('documents.comments.accept', 'Terima')}
                  </Button>
                  <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'reject')} size="sm">
                    <X className="w-g13 h-g13 text-status-danger" aria-hidden /> {t('documents.comments.reject', 'Tolak')}
                  </Button>
                </>
              )}
              {comment.status === 'open' && !isSuggestion && (
                <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'resolve')} size="sm">
                  <CheckCheck className="w-g13 h-g13" aria-hidden /> {t('documents.comments.resolve', 'Selesaikan')}
                </Button>
              )}
              {comment.status === 'resolved' && (
                <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'reopen')} size="sm">
                  <RotateCcw className="w-g13 h-g13" aria-hidden /> {t('documents.comments.reopen', 'Buka lagi')}
                </Button>
              )}
              <Button variant="ghost" type="button" onClick={() => setReplyTo({ id: comment.id, body: '' })} size="sm">
                {t('documents.comments.reply', 'Balas')}
              </Button>
            </div>
          )
        )}
      </li></Card>
    );
  };

  return (
    <div className="space-y-g13">
      {canEdit && !composer && (
        <div className="grid grid-cols-2 gap-g8">
          <Button variant="outline" type="button" onClick={() => startComposer('comment')}>
            <MessageSquarePlus className="size-g16" aria-hidden /> {t('documents.comments.add_comment', 'Komentar')}
          </Button>
          <Button variant="outline" type="button" onClick={() => startComposer('suggestion')}>
            <PenLine className="size-g16" aria-hidden /> {t('documents.comments.suggest_button', 'Suggest')}
          </Button>
          <Button variant="outline"
            type="button"
            disabled={busy === 'ai-redline'}
            aria-busy={busy === 'ai-redline'}
            onClick={runAiRedlining}
            className="col-span-2"
          >
            <AiIcon className={`size-g16 ${busy === 'ai-redline' ? 'animate-pulse' : ''}`} />
            {busy === 'ai-redline' ? t('documents.comments.ai_redline_running', 'Meninjau dokumen…') : t('documents.comments.ai_redline', 'AI Redlining')}
          </Button>
        </div>
      )}

      {composer && (
        <Card asChild><form onSubmit={submitComposer} className="space-y-g8 p-g13" aria-busy={busy === 'composer'}>
          <Text size="xs" weight="bold">
            {composer.mode === 'suggestion' ? t('documents.comments.add_suggestion', 'Usulkan Perubahan') : t('documents.comments.add_comment', 'Komentar')}
          </Text>
          {composer.range ? (
            <blockquote className="border-l-2 border-status-warning-border pl-g8 text-xs text-muted-foreground line-clamp-3">{composer.range.text}</blockquote>
          ) : (
            <Text size="xs" tone="muted">{t('documents.comments.general', 'Komentar umum (tanpa teks terpilih).')}</Text>
          )}
          {composer.mode === 'suggestion' && (
            <Field>
              <FieldLabel>{t('documents.comments.replace_with', 'Ganti menjadi (kosongkan untuk menghapus)')}</FieldLabel>
              <Textarea rows={2} value={composer.newText} onChange={(e) => setComposer({ ...composer, newText: e.target.value })} />
            </Field>
          )}
          <Field required={composer.mode === 'comment'}>
            <FieldLabel>
              {composer.mode === 'suggestion' ? t('documents.comments.reason', 'Alasan (opsional)') : t('documents.comments.comment_text', 'Komentar')}
            </FieldLabel>
            <Textarea
              autoFocus={composer.mode === 'comment'}
              required={composer.mode === 'comment'}
              rows={3}
              value={composer.body}
              onChange={(e) => setComposer({ ...composer, body: e.target.value })}
            />
          </Field>
          <div className="flex gap-g3">
            <Button type="submit" disabled={busy === 'composer'} size="sm">
              {busy === 'composer' ? t('common.saving', 'Menyimpan…') : t('documents.comments.send', 'Kirim')}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setComposer(null)} size="sm">
              {t('common.cancel', 'Batal')}
            </Button>
          </div>
        </form></Card>
      )}

      {state.status === 'loading' && (
        <div role="status" className="space-y-g8">
          <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-g89 w-full" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <Alert status="error" role="alert"><AlertIndicator />
          <AlertContent><AlertDescription><p>{state.message}</p>
          <Button variant="ghost" type="button" onClick={reload} size="sm">
            <RefreshCw className="w-g13 h-g13" aria-hidden /> {t('common.retry', 'Coba lagi')}
          </Button></AlertDescription></AlertContent>
        </Alert>
      )}

      {state.status === 'ready' && (
        <>
          <Card asChild><section aria-labelledby={`${idPrefix}-summary`} className="gap-g13 p-g13">
            <Heading as="h3" size="sm" weight="bold" id={`${idPrefix}-summary`}>
              {t('documents.comments.summary', 'Ringkasan Perubahan')}
            </Heading>
            <dl className="grid grid-cols-2 gap-x-g13 gap-y-g8 text-sm text-foreground">
              <dt>{t('documents.comments.total', 'Total')}</dt>
              <dd className="text-right font-semibold tabular-nums">{topLevel.length}</dd>
              <dt>{statusLabel('open')}</dt>
              <dd className="text-right font-semibold tabular-nums">{count('open')}</dd>
              <dt>{statusLabel('accepted')}</dt>
              <dd className="text-right font-semibold tabular-nums">{count('accepted')}</dd>
              <dt>{statusLabel('rejected')}</dt>
              <dd className="text-right font-semibold tabular-nums">{count('rejected')}</dd>
              <dt>{statusLabel('resolved')}</dt>
              <dd className="text-right font-semibold tabular-nums">{count('resolved')}</dd>
            </dl>
            {canEdit && openSuggestions.length > 1 && (
              <div className="grid grid-cols-2 gap-g8">
                <Button variant="outline" type="button" disabled={busy === 'bulk'} onClick={() => bulk('accept')}>
                  <Check className="w-g13 h-g13 text-status-success" aria-hidden /> {t('documents.comments.accept_all', 'Terima Semua')}
                </Button>
                <Button variant="outline" type="button" disabled={busy === 'bulk'} onClick={() => bulk('reject')}>
                  <X className="w-g13 h-g13 text-status-danger" aria-hidden /> {t('documents.comments.reject_all', 'Tolak Semua')}
                </Button>
              </div>
            )}
            {documentId && (
              <Button variant="outline" type="button" onClick={() => onExportRedline(comments)} className="w-full">
                <FileDown className="size-g16" aria-hidden /> {t('documents.comments.export_redline', 'Unduh dengan Redline (.doc)')}
              </Button>
            )}
          </section></Card>

          {open.length === 0 ? (
            <Empty>
              <EmptyContent><EmptyDescription>{t('documents.comments.empty', 'Tidak ada komentar atau usulan terbuka.')}</EmptyDescription></EmptyContent>
            </Empty>
          ) : (
            <List marker="none" className="space-y-g8" aria-label={statusLabel('open')}>
              {open.map(renderCard)}
            </List>
          )}

          {closed.length > 0 && (
            <div className="space-y-g8">
              <Button variant="link" size="sm"
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                aria-expanded={showClosed}
              >
                {showClosed
                  ? t('documents.comments.hide_closed', 'Sembunyikan yang selesai')
                  : t('documents.comments.show_closed', 'Tampilkan yang selesai ({n})', { n: closed.length })}
              </Button>
              {showClosed && <List marker="none" className="space-y-g8 opacity-90">{closed.map(renderCard)}</List>}
            </div>
          )}

          {topLevel.length > 0 && (
            <section className="space-y-g5 pt-g8 border-t border-border">
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setShowTimeline((v) => !v)}
                aria-expanded={showTimeline}
              >
                <History className="w-g13 h-g13 text-muted-foreground" aria-hidden />
                {t('documents.comments.timeline', 'Riwayat Redline')}
              </Button>
              {showTimeline && (
                <List as="ol" size="xs" tone="muted" marker="none" className="space-y-g3">
                  {[...topLevel]
                    .sort((a, b) => (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at))
                    .map((c) => (
                      <ListItem key={c.id}>
                        <strong className="text-foreground">{c.author_name || '—'}</strong>:{' '}
                        {c.comment_type === 'suggestion'
                          ? `“${c.quote}” → “${c.new_text ?? ''}”`
                          : c.body.slice(0, 80)}{' '}
                        (<RelativeTime iso={c.created_at} />) — <strong>{statusLabel(c.status).toUpperCase()}</strong>
                        {c.resolved_by_name && ` · ${c.resolved_by_name}`}
                      </ListItem>
                    ))}
                </List>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};
