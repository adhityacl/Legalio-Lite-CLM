import { PartnerSpendingView } from '../components/PartnerSpendingView';
import { useNavigation } from '../context/NavigationContext';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function SpendingRoute() {
  const { recordId, clearRecordId } = useNavigation();
  const { partners, spendings, contracts, ios, loadAllData } = useWorkspace();
  return (
    <PartnerSpendingView
      openSpendingId={recordId ?? undefined}
      onSpendingOpened={clearRecordId}
      partners={partners}
      spendings={spendings}
      contracts={contracts}
      ios={ios}
      onRefreshData={loadAllData}
    />
  );
}
