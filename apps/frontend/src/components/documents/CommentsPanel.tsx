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
import { Alert, AlertContent } from '@legalio/ui-components/alert';
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

const SMALL_BUTTON =
  'inline-flex items-center gap-1 px-2 min-h-10 sm:min-h-8 rounded-md text-xs font-bold border border-border  text-foreground  hover:bg-muted  disabled:opacity-50 cursor-pointer';
const STATUS_BADGE: Record<CommentStatus, string> = {
  open: 'bg-status-warning-soft text-status-warning border-status-warning-border   ',
  resolved: 'bg-muted text-foreground border-border   ',
  accepted: 'bg-status-success-soft text-status-success border-status-success-border   ',
  rejected: 'bg-status-danger-soft text-status-danger border-status-danger-border   ',
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
      <li key={comment.id} className="editor-panel-card p-4 rounded-xl border border-border bg-card space-y-1.5 text-xs" aria-busy={isBusy}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs">
            <span className="font-bold text-foreground ">{comment.author_name || '—'}</span>{' '}
            <span className="text-muted-foreground">
              · {isSuggestion ? t('documents.comments.suggestion', 'Usulan') : t('documents.comments.comment', 'Komentar')} ·{' '}
              <RelativeTime iso={comment.created_at} />
            </span>
          </p>
          <span className={`shrink-0 px-1.5 py-0.5 rounded-full border text-xs font-bold ${STATUS_BADGE[comment.status]}`}>{statusLabel(comment.status)}</span>
        </div>

        {comment.quote && (
          <button
            type="button"
            onClick={() => jumpTo(comment)}
            className="block w-full text-left border-l-2 border-status-warning-border pl-2 text-xs text-muted-foreground hover:bg-card rounded-r cursor-pointer"
            title={t('documents.comments.jump', 'Lompat ke teks di dokumen')}
          >
            {isSuggestion ? <del className="text-status-danger">{comment.quote}</del> : <q>{comment.quote}</q>}
          </button>
        )}
        {isSuggestion && (
          <p className="text-xs">
            →{' '}
            {comment.new_text ? (
              <ins className="text-status-success font-semibold">{comment.new_text}</ins>
            ) : (
              <em className="text-muted-foreground">{t('documents.comments.deletion', '(hapus teks)')}</em>
            )}
          </p>
        )}
        {comment.body && <p className="whitespace-pre-wrap text-foreground">{comment.body}</p>}
        {comment.resolved_at && (
          <p className="text-xs text-muted-foreground">
            {statusLabel(comment.status)} · {comment.resolved_by_name || '—'} · <RelativeTime iso={comment.resolved_at} />
          </p>
        )}

        {replies.length > 0 && (
          <ul className="space-y-1 pl-3 border-l border-border">
            {replies.map((reply) => (
              <li key={reply.id} className="text-xs">
                <span className="font-bold text-foreground ">{reply.author_name || '—'}</span>{' '}
                <span className="text-muted-foreground">
                  · <RelativeTime iso={reply.created_at} />
                </span>
                <p className="whitespace-pre-wrap text-foreground">{reply.body}</p>
              </li>
            ))}
          </ul>
        )}

        {replyTo?.id === comment.id ? (
          <form onSubmit={submitReply} className="space-y-1">
            <label htmlFor={`${idPrefix}-reply-${comment.id}`} className="sr-only">
              {t('documents.comments.reply', 'Balas')}
            </label>
            <Textarea
              id={`${idPrefix}-reply-${comment.id}`}
              autoFocus
              rows={2}
              value={replyTo.body}
              onChange={(e) => setReplyTo({ id: comment.id, body: e.target.value })}
            />
            <div className="flex gap-1">
              <Button type="submit" disabled={isBusy || !replyTo.body.trim()} className={`${SMALL_BUTTON} `}>
                {t('documents.comments.send', 'Kirim')}
              </Button>
              <Button variant="ghost" type="button" onClick={() => setReplyTo(null)} className={SMALL_BUTTON}>
                {t('common.cancel', 'Batal')}
              </Button>
            </div>
          </form>
        ) : (
          canEdit &&
          documentId && (
            <div className="flex flex-wrap gap-1">
              {comment.status === 'open' && isSuggestion && (
                <>
                  <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'accept')} className={SMALL_BUTTON}>
                    <Check className="w-3 h-3 text-status-success" aria-hidden /> {t('documents.comments.accept', 'Terima')}
                  </Button>
                  <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'reject')} className={SMALL_BUTTON}>
                    <X className="w-3 h-3 text-status-danger" aria-hidden /> {t('documents.comments.reject', 'Tolak')}
                  </Button>
                </>
              )}
              {comment.status === 'open' && !isSuggestion && (
                <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'resolve')} className={SMALL_BUTTON}>
                  <CheckCheck className="w-3 h-3" aria-hidden /> {t('documents.comments.resolve', 'Selesaikan')}
                </Button>
              )}
              {comment.status === 'resolved' && (
                <Button variant="ghost" type="button" disabled={isBusy} onClick={() => act(comment, 'reopen')} className={SMALL_BUTTON}>
                  <RotateCcw className="w-3 h-3" aria-hidden /> {t('documents.comments.reopen', 'Buka lagi')}
                </Button>
              )}
              <Button variant="ghost" type="button" onClick={() => setReplyTo({ id: comment.id, body: '' })} className={SMALL_BUTTON}>
                {t('documents.comments.reply', 'Balas')}
              </Button>
            </div>
          )
        )}
      </li>
    );
  };

  return (
    <div className="editor-comments space-y-4">
      {canEdit && !composer && (
        <div className="editor-comment-actions grid grid-cols-2 gap-2">
          <Button variant="ghost" type="button" onClick={() => startComposer('comment')} className={`${SMALL_BUTTON} `}>
            <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden /> {t('documents.comments.add_comment', 'Komentar')}
          </Button>
          <Button variant="ghost" type="button" onClick={() => startComposer('suggestion')} className={`${SMALL_BUTTON} `}>
            <PenLine className="w-3.5 h-3.5" aria-hidden /> {t('documents.comments.add_suggestion', 'Usulkan Perubahan')}
          </Button>
          <Button variant="outline"
            type="button"
            disabled={busy === 'ai-redline'}
            aria-busy={busy === 'ai-redline'}
            onClick={runAiRedlining}
            className={`${SMALL_BUTTON} col-span-2 `}
          >
            <AiIcon className={`w-3.5 h-3.5 ${busy === 'ai-redline' ? 'animate-pulse' : ''}`} />
            {busy === 'ai-redline' ? t('documents.comments.ai_redline_running', 'Meninjau dokumen…') : t('documents.comments.ai_redline', 'AI Redlining')}
          </Button>
        </div>
      )}

      {composer && (
        <form onSubmit={submitComposer} className="space-y-2 editor-panel-card p-4 rounded-xl border border-status-success-border bg-status-success-soft/30 " aria-busy={busy === 'composer'}>
          <p className="text-xs font-bold text-foreground">
            {composer.mode === 'suggestion' ? t('documents.comments.add_suggestion', 'Usulkan Perubahan') : t('documents.comments.add_comment', 'Komentar')}
          </p>
          {composer.range ? (
            <blockquote className="border-l-2 border-status-warning-border pl-2 text-xs text-muted-foreground line-clamp-3">{composer.range.text}</blockquote>
          ) : (
            <p className="text-xs text-muted-foreground">{t('documents.comments.general', 'Komentar umum (tanpa teks terpilih).')}</p>
          )}
          {composer.mode === 'suggestion' && (
            <label className="block space-y-1 text-xs font-semibold text-muted-foreground">
              <span>{t('documents.comments.replace_with', 'Ganti menjadi (kosongkan untuk menghapus)')}</span>
              <Textarea rows={2} value={composer.newText} onChange={(e) => setComposer({ ...composer, newText: e.target.value })} />
            </label>
          )}
          <label className="block space-y-1 text-xs font-semibold text-muted-foreground">
            <span>
              {composer.mode === 'suggestion' ? t('documents.comments.reason', 'Alasan (opsional)') : t('documents.comments.comment_text', 'Komentar')}
            </span>
            <Textarea
              autoFocus={composer.mode === 'comment'}
              required={composer.mode === 'comment'}
              rows={3}
              value={composer.body}
              onChange={(e) => setComposer({ ...composer, body: e.target.value })}
            />
          </label>
          <div className="flex gap-1">
            <Button type="submit" disabled={busy === 'composer'} className={`${SMALL_BUTTON} `}>
              {busy === 'composer' ? t('common.saving', 'Menyimpan…') : t('documents.comments.send', 'Kirim')}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setComposer(null)} className={SMALL_BUTTON}>
              {t('common.cancel', 'Batal')}
            </Button>
          </div>
        </form>
      )}

      {state.status === 'loading' && (
        <div role="status" className="space-y-2">
          <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
          {[0, 1].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <Alert status="error" role="alert">
          <AlertContent><p>{state.message}</p>
          <Button variant="ghost" type="button" onClick={reload} className={SMALL_BUTTON}>
            <RefreshCw className="w-3 h-3" aria-hidden /> {t('common.retry', 'Coba lagi')}
          </Button></AlertContent>
        </Alert>
      )}

      {state.status === 'ready' && (
        <>
          <section aria-labelledby={`${idPrefix}-summary`} className="editor-panel-card p-4 space-y-2">
            <h3 id={`${idPrefix}-summary`} className="text-xs font-bold text-foreground">
              {t('documents.comments.summary', 'Ringkasan Perubahan')}
            </h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-foreground">
              <dt>{t('documents.comments.total', 'Total')}</dt>
              <dd className="text-right font-bold">{topLevel.length}</dd>
              <dt>{statusLabel('open')}</dt>
              <dd className="text-right font-bold">{count('open')}</dd>
              <dt>{statusLabel('accepted')}</dt>
              <dd className="text-right font-bold">{count('accepted')}</dd>
              <dt>{statusLabel('rejected')}</dt>
              <dd className="text-right font-bold">{count('rejected')}</dd>
              <dt>{statusLabel('resolved')}</dt>
              <dd className="text-right font-bold">{count('resolved')}</dd>
            </dl>
            {canEdit && openSuggestions.length > 1 && (
              <div className="grid grid-cols-2 gap-1">
                <Button variant="ghost" type="button" disabled={busy === 'bulk'} onClick={() => bulk('accept')} className={`${SMALL_BUTTON} `}>
                  <Check className="w-3 h-3 text-status-success" aria-hidden /> {t('documents.comments.accept_all', 'Terima Semua')}
                </Button>
                <Button variant="ghost" type="button" disabled={busy === 'bulk'} onClick={() => bulk('reject')} className={`${SMALL_BUTTON} `}>
                  <X className="w-3 h-3 text-status-danger" aria-hidden /> {t('documents.comments.reject_all', 'Tolak Semua')}
                </Button>
              </div>
            )}
            {documentId && (
              <Button variant="ghost" type="button" onClick={() => onExportRedline(comments)} className={`${SMALL_BUTTON} w-full`}>
                <FileDown className="w-3 h-3" aria-hidden /> {t('documents.comments.export_redline', 'Unduh dengan Redline (.doc)')}
              </Button>
            )}
          </section>

          {open.length === 0 ? (
            <p className="text-xs text-muted-foreground editor-panel-empty text-center py-8 border border-dashed border-border rounded-lg">
              {t('documents.comments.empty', 'Tidak ada komentar atau usulan terbuka.')}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={statusLabel('open')}>
              {open.map(renderCard)}
            </ul>
          )}

          {closed.length > 0 && (
            <div className="space-y-2">
              <Button variant="link" size="sm"
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                aria-expanded={showClosed}
              >
                {showClosed
                  ? t('documents.comments.hide_closed', 'Sembunyikan yang selesai')
                  : t('documents.comments.show_closed', 'Tampilkan yang selesai ({n})', { n: closed.length })}
              </Button>
              {showClosed && <ul className="space-y-2 opacity-90">{closed.map(renderCard)}</ul>}
            </div>
          )}

          {topLevel.length > 0 && (
            <section className="space-y-1.5 pt-2 border-t border-border">
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setShowTimeline((v) => !v)}
                aria-expanded={showTimeline}
              >
                <History className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
                {t('documents.comments.timeline', 'Riwayat Redline')}
              </Button>
              {showTimeline && (
                <ol className="space-y-1 text-xs text-muted-foreground">
                  {[...topLevel]
                    .sort((a, b) => (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at))
                    .map((c) => (
                      <li key={c.id}>
                        <strong className="text-foreground">{c.author_name || '—'}</strong>:{' '}
                        {c.comment_type === 'suggestion'
                          ? `“${c.quote}” → “${c.new_text ?? ''}”`
                          : c.body.slice(0, 80)}{' '}
                        (<RelativeTime iso={c.created_at} />) — <strong>{statusLabel(c.status).toUpperCase()}</strong>
                        {c.resolved_by_name && ` · ${c.resolved_by_name}`}
                      </li>
                    ))}
                </ol>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};
