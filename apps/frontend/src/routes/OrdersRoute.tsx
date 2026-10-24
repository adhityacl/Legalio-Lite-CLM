import { IOView } from '../components/IOView';
import { useLanguage } from '../context/LanguageContext';
import { useNavigation } from '../context/NavigationContext';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function OrdersRoute() {
  const { t } = useLanguage();
  const { recordId, clearRecordId } = useNavigation();
  const { openEditor, actions } = useWorkspace();
  return (
    <IOView
      openDocumentId={recordId ?? undefined}
      onDocumentOpened={clearRecordId}
      onAddIO={() => openEditor({ kind: 'io', record: null })}
      onEditIO={(io) => openEditor({ kind: 'io', record: io })}
      onDeleteIO={actions.deleteOrder}
      onDeleteIOs={(ids) => actions.bulkDelete('ios', ids, t('bulk.confirm_delete', 'Hapus {count} {noun} terpilih? Tindakan ini tidak dapat dibatalkan.', { count: ids.length, noun: t('bulk.noun_io', 'IO') }))}
    />
  );
}
