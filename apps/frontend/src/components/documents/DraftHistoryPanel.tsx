import React, { useEffect, useState } from 'react';
import { Eye, GitCompare, History, RefreshCw, RotateCcw, Tag as TagIcon } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { documentsApi, errorMessage } from '../../lib/documentsApi';
import { formatBytes, type DraftVersion } from '@legalio/types/documents';
import { RelativeTime } from './RelativeTime';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Card } from '@legalio/ui-components/card';
import { Badge } from '@legalio/ui-components/badge';
import { Text } from '@legalio/ui-components/text';
import { Tag } from '@legalio/ui-components/tag';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Heading } from '@legalio/ui-components/heading';
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
      <p className="text-xs text-muted-foreground p-3 border border-dashed border-border rounded-lg">
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
    <section className="flex flex-col gap-3" aria-labelledby="draft-history-heading" aria-busy={state.status === 'loading'}>
      <Heading as="h3" size="xs" weight="semibold" id="draft-history-heading" className="flex items-center gap-1.5">
        <History className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {t('documents.history.title', 'Riwayat Draf')}
      </Heading>

      {state.status === 'loading' && (
        <div role="status" className="grid gap-2">
          <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
          {[0, 1, 2].map(i => <Skeleton key={i} height={80} />)}
        </div>
      )}

      {state.status === 'error' && (
        <Alert status="error" role="alert">
          <AlertIndicator />
          <AlertContent><AlertDescription>{state.message}</AlertDescription></AlertContent>
          <AlertActions>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}><RefreshCw aria-hidden="true" />{t('common.retry', 'Coba lagi')}</Button>
          </AlertActions>
        </Alert>
      )}

      {state.status === 'ready' && (
        <ol className="flex flex-col gap-2">
          {state.drafts.map((draft) => {
            const isCurrent = draft.version_number === currentVersion;
            const isViewing = draft.version_number === viewingVersion;
            return (
              <li key={draft.version_number}>
                <Card size="sm" className={`gap-2 p-4 ${isViewing ? 'border-status-info-border bg-status-info-soft' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Text as="span" size="sm" weight="semibold">
                      {t('documents.history.version', 'Versi {v}', { v: draft.version_number })}
                      {draft.draft_name && <span className="text-status-success"> · {draft.draft_name}</span>}
                    </Text>
                    {isCurrent ? (
                      <Badge tone="success">{t('documents.history.current', 'Terkini')}</Badge>
                    ) : canEdit && (
                      <Button variant="outline" size="sm" onClick={() => onRestore(draft.version_number)}>
                        <RotateCcw aria-hidden="true" />{t('documents.history.restore', 'Pulihkan')}
                      </Button>
                    )}
                  </div>
                  {draft.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1" aria-label={t('documents.history.labels', 'Label')}>
                      {draft.labels.map(label => <Tag key={label} size="sm" variant="outline">{label}</Tag>)}
                    </div>
                  )}
                  <Text size="xs" tone="muted">
                    {kindLabel(draft)} · {draft.saved_by_name || '—'} · <RelativeTime iso={draft.saved_at} /> · {formatBytes(draft.file_size)}
                  </Text>

                  {editing?.version === draft.version_number ? (
                    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); saveLabel(); }}>
                      <Field>
                        <FieldLabel>{t('documents.history.name_label', 'Nama versi')}</FieldLabel>
                        <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="final-before-signature" />
                      </Field>
                      <Field>
                        <FieldLabel>{t('documents.history.labels_label', 'Label (pisahkan dengan koma)')}</FieldLabel>
                        <Input value={editing.labels} onChange={(e) => setEditing({ ...editing, labels: e.target.value })} placeholder={t('documents.legal_review_cfo_approved', 'Legal Review, CFO Approved')} />
                      </Field>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">{t('common.save', 'Simpan')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t('common.cancel', 'Batal')}</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button variant={isViewing ? 'secondary' : 'outline'} size="sm" onClick={() => onView(draft.version_number)} aria-pressed={isViewing}>
                        <Eye aria-hidden="true" />{t('documents.history.view', 'Lihat')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => onCompare(draft.version_number)}>
                        <GitCompare aria-hidden="true" />{t('documents.history.compare', 'Bandingkan')}
                      </Button>
                      {canEdit && (
                        <Button variant="outline" size="sm" onClick={() => setEditing({ version: draft.version_number, name: draft.draft_name || '', labels: draft.labels.join(', ') })}>
                          <TagIcon aria-hidden="true" />{t('documents.history.name_action', 'Beri nama')}
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
