import { useEffect } from 'react';
import { PartnersView } from '../components/PartnersView';
import { useLanguage } from '../context/LanguageContext';
import { useNavigation } from '../context/NavigationContext';
import { useSnapshotDemand, useWorkspace } from '../features/workspace/WorkspaceContext';
import { LoadingState } from '../components/StateScreen';
import { useRecordLookup } from '../lib/useRecordLookup';
import type { Partner } from '@legalio/types';

/** `partners` (list, deep link `&id=P0001` opens the partner) and `partner-evaluation` (the evaluation sub-tab, `&id=` opens that evaluation). */
export default function PartnersRoute({ evaluation = false }: { evaluation?: boolean }) {
  const { t } = useLanguage();
  const { recordId, clearRecordId } = useNavigation();
  // Only the evaluation sub-tab cross-references every record type; the partner list reads its pages from the server.
  useSnapshotDemand(evaluation);
  const { partners, contracts, ios, spendings, evaluations, loadAllData, openEditor, actions, snapshotLoaded } = useWorkspace();

  // Deep link `&id=P0001`: the server finds the partner (and only answers for partners the caller may see).
  const linked = useRecordLookup<Partner>('partners', '/partners', 'partner_id', evaluation ? null : recordId);
  useEffect(() => {
    if (evaluation || !recordId || linked.isLoading) return;
    if (linked.data) openEditor({ kind: 'partner', record: linked.data });
    clearRecordId();
  }, [evaluation, recordId, linked.data, linked.isLoading, openEditor, clearRecordId]);

  if (evaluation && !snapshotLoaded) return <LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />;
  return (
    <PartnersView
      openEvaluationId={evaluation ? recordId ?? undefined : undefined}
      onEvaluationOpened={clearRecordId}
      // The evaluation sub-tab still cross-references every record type; the list reads its page from the server.
      partners={evaluation ? partners : undefined}
      contracts={evaluation ? contracts : undefined}
      ios={evaluation ? ios : undefined}
      spendings={evaluation ? spendings : undefined}
      evaluations={evaluation ? evaluations : undefined}
      onRefreshData={loadAllData}
      initialSubTab={evaluation ? 'evaluation' : 'list'}
      onAddPartner={() => openEditor({ kind: 'partner', record: null })}
      onEditPartner={(p) => openEditor({ kind: 'partner', record: p })}
      onDeletePartner={actions.deletePartner}
      onDeletePartners={(ids) => actions.bulkDelete('partners', ids, t('bulk.confirm_delete_partners', 'Hapus {count} partner terpilih? Kontrak, IO, adendum & notifikasi terkait ikut terhapus.', { count: ids.length }))}
      onUploadDDDoc={async () => { void loadAllData(); }}
    />
  );
}
