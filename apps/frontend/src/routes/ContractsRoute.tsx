import { ContractsView } from '../components/ContractsView';
import { useLanguage } from '../context/LanguageContext';
import { useNavigation } from '../context/NavigationContext';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function ContractsRoute() {
  const { t } = useLanguage();
  const { recordId, clearRecordId } = useNavigation();
  const { contracts, partners, ios, openEditor, openAmendment, actions } = useWorkspace();
  return (
    <ContractsView
      openDocumentId={recordId ?? undefined}
      onDocumentOpened={clearRecordId}
      contracts={contracts}
      partners={partners}
      ios={ios}
      onAddContract={() => openEditor({ kind: 'contract', record: null })}
      onEditContract={(ctr) => openEditor({ kind: 'contract', record: ctr })}
      onDeleteContract={actions.deleteContract}
      onDeleteContracts={(ids) => actions.bulkDelete('contracts', ids, t('bulk.confirm_delete', 'Hapus {count} {noun} terpilih? Tindakan ini tidak dapat dibatalkan.', { count: ids.length, noun: t('bulk.noun_contract', 'kontrak') }))}
      onOpenAddendumModal={(ctr) => openAmendment(ctr)}
    />
  );
}
