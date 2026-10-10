import React, { useEffect, useState } from 'react';
import { Eye, GitCompare, History, RefreshCw, RotateCcw, Tag } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { documentsApi, errorMessage } from '../../lib/documentsApi';
import { formatBytes, type DraftVersion } from '@legalio/types/documents';
import { RelativeTime } from './RelativeTime';
import { INPUT_CLASS } from './documentLabels';

interface DraftHistoryPanelProps {
  documentId: string | null;
  currentVersion: number | null;
  /** Bumped by the editor after every save so the list stays current. */
  refreshKey: number;
  canEdit: boolean;
  viewingVersion: number | null;
  onView: (version: number) => void;
  onCompare: (version: number) => void;
  onRestore: (version: number) => void;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; drafts: DraftVersion[] };

const ACTION_BUTTON =
  'ui-button ui-button-sm inline-flex items-center gap-1 font-bold border border-hairline  text-ink  hover:bg-surface-2 dark:hover:bg-surface-2 cursor-pointer';

export const DraftHistoryPanel: React.FC<DraftHistoryPanelProps> = ({
  documentId,
  currentVersion,
  refreshKey,
  canEdit,
  viewingVersion,
  onView,
  onCompare,
  onRestore,
}) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<{ version: number; name: string; labels: string } | null>(null);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    documentsApi
      .listDrafts(documentId)
      .then((drafts) => !cancelled && setState({ status: 'ready', drafts }))
      .catch((err) => !cancelled && setState({ status: 'error', message: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [documentId, refreshKey, reloadKey]);

  if (!documentId) {
    return (
      <p className="text-xs text-ink-soft p-3 border border-dashed border-hairline rounded-lg">
        {t('documents.history.unsaved', 'Dokumen ini belum disimpan. Riwayat versi muncul setelah penyimpanan pertama (otomatis tiap 30 detik setelah ada perubahan).')}
      </p>
    );
  }

  const saveLabel = async () => {
    if (!editing) return;
    try {
      await documentsApi.updateDraft(documentId, editing.version, {
        draft_name: editing.name,
        labels: editing.labels.split(',').map((l) => l.trim()).filter(Boolean),
      });
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      showAlert({ title: t('documents.msg.action_failed', 'Aksi gagal'), description: errorMessage(err), variant: 'destructive' });
    }
  };

  const kindLabel = (draft: DraftVersion) =>
    draft.save_kind === 'restore'
      ? t('documents.history.kind_restore', 'Dipulihkan dari v{v}', { v: draft.restored_from ?? '?' })
      : draft.save_kind === 'auto'
        ? t('documents.history.kind_auto', 'Simpan otomatis')
        : t('documents.history.kind_manual', 'Simpan manual');

  return (
    <section className="space-y-2" aria-labelledby="draft-history-heading" aria-busy={state.status === 'loading'}>
      <h3 id="draft-history-heading" className="text-xs font-bold text-ink flex items-center gap-1.5">
        <History className="w-3.5 h-3.5 text-ink-soft" aria-hidden />
        {t('documents.history.title', 'Riwayat Draf')}
      </h3>

      {state.status === 'loading' && (
        <div role="status" className="space-y-2">
          <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-surface-2 animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="ds-alert ds-status-danger border">
          <p>{state.message}</p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={ACTION_BUTTON}>
            <RefreshCw className="w-3 h-3" aria-hidden /> {t('common.retry', 'Coba lagi')}
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <ol className="space-y-2">
          {state.drafts.map((draft) => {
            const isCurrent = draft.version_number === currentVersion;
            const isViewing = draft.version_number === viewingVersion;
            return (
              <li
                key={draft.version_number}
                className={`editor-panel-card p-4 rounded-xl border text-xs space-y-1.5 ${
                  isViewing
                    ? 'border-status-info-border bg-status-info-soft/60 dark:bg-status-info-soft/30'
                    : 'border-hairline bg-surface '
                }`}
              >
                {/* Centered so the Restore button lines up with the title; the panel's card rule top-aligns headers. */}
                <div className="flex items-center! justify-between gap-2">
                  <span className="font-bold text-ink dark:text-white">
                    {t('documents.history.version', 'Versi {v}', { v: draft.version_number })}
                    {draft.draft_name && <span className="font-semibold text-status-success"> · {draft.draft_name}</span>}
                  </span>
                  {isCurrent ? (
                    <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded-sm bg-status-success-soft text-status-success">
                      {t('documents.history.current', 'Terkini')}
                    </span>
                  ) : canEdit && (
                    <button type="button" onClick={() => onRestore(draft.version_number)} className={ACTION_BUTTON}>
                      <RotateCcw className="w-3 h-3" aria-hidden /> {t('documents.history.restore', 'Pulihkan')}
                    </button>
                  )}
                </div>
                {draft.labels.length > 0 && (
                  <ul className="flex flex-wrap gap-1" aria-label={t('documents.history.labels', 'Label')}>
                    {draft.labels.map((label) => (
                      <li key={label} className="text-xs font-semibold px-1.5 py-0.5 rounded-full border border-status-success-border text-status-success">
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-ink-soft">
                  {kindLabel(draft)} · {draft.saved_by_name || '—'} · <RelativeTime iso={draft.saved_at} /> · {formatBytes(draft.file_size)}
                </p>

                {editing?.version === draft.version_number ? (
                  <form
                    className="space-y-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveLabel();
                    }}
                  >
                    <label className="block text-xs font-semibold text-ink-soft">
                      {t('documents.history.name_label', 'Nama versi')}
                      <input
                        autoFocus
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        placeholder="final-before-signature"
                        className={INPUT_CLASS}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-ink-soft">
                      {t('documents.history.labels_label', 'Label (pisahkan dengan koma)')}
                      <input
                        value={editing.labels}
                        onChange={(e) => setEditing({ ...editing, labels: e.target.value })}
                        placeholder={t('documents.legal_review_cfo_approved', 'Legal Review, CFO Approved')}
                        className={INPUT_CLASS}
                      />
                    </label>
                    <div className="flex gap-1">
                      <button type="submit" className={`${ACTION_BUTTON} theme-action border-transparent`}>
                        {t('common.save', 'Simpan')}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={ACTION_BUTTON}>
                        {t('common.cancel', 'Batal')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => onView(draft.version_number)} className={ACTION_BUTTON} aria-pressed={isViewing}>
                      <Eye className="w-3 h-3" aria-hidden /> {t('documents.history.view', 'Lihat')}
                    </button>
                    <button type="button" onClick={() => onCompare(draft.version_number)} className={ACTION_BUTTON}>
                      <GitCompare className="w-3 h-3" aria-hidden /> {t('documents.history.compare', 'Bandingkan')}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ version: draft.version_number, name: draft.draft_name || '', labels: draft.labels.join(', ') })
                        }
                        className={ACTION_BUTTON}
                      >
                        <Tag className="w-3 h-3" aria-hidden /> {t('documents.history.name_action', 'Beri nama')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
