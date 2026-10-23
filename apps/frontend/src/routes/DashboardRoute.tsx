import { DashboardView } from '../components/DashboardView';
import { useNavigation } from '../context/NavigationContext';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function DashboardRoute() {
  const { setActiveTab } = useNavigation();
  const { contracts, ios, partners, spendings, notifications } = useWorkspace();
  return (
    <DashboardView
      contracts={contracts}
      ios={ios}
      partners={partners}
      spendings={spendings}
      notifications={notifications}
      onNavigateTab={setActiveTab}
      onSelectContract={() => setActiveTab('contracts')}
      onSelectPartner={() => setActiveTab('partners')}
    />
  );
}
