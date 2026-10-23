import { useEffect } from 'react';
import { PartnersView } from '../components/PartnersView';
import { useLanguage } from '../context/LanguageContext';
import { useNavigation } from '../context/NavigationContext';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

/** `partners` (list, deep link `&id=P0001` opens the partner) and `partner-evaluation` (the evaluation sub-tab, `&id=` opens that evaluation). */
export default function PartnersRoute({ evaluation = false }: { evaluation?: boolean }) {
  const { t } = useLanguage();
  const { recordId, clearRecordId } = useNavigation();
  const { partners, contracts, ios, spendings, evaluations, loadAllData, openEditor, actions } = useWorkspace();

  useEffect(() => {
    if (evaluation || !recordId) return;
    const partner = partners.find((p) => p.partner_id === recordId);
    if (!partner) return;
    openEditor({ kind: 'partner', record: partner });
    clearRecordId();
  }, [evaluation, recordId, partners, openEditor, clearRecordId]);

  return (
    <PartnersView
      openEvaluationId={evaluation ? recordId ?? undefined : undefined}
      onEvaluationOpened={clearRecordId}
      partners={partners}
      contracts={contracts}
      ios={ios}
      spendings={spendings}
      evaluations={evaluations}
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
