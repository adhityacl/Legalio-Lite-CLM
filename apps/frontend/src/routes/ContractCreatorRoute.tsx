import { ContractCreatorView } from '../components/ContractCreatorView';
import { useNavigation } from '../context/NavigationContext';
import { useTenant } from '../context/TenantContext';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function ContractCreatorRoute() {
  const { activeTenantId } = useTenant();
  const { setActiveTab } = useNavigation();
  const { partners, contracts, actions } = useWorkspace();
  return (
    <ContractCreatorView
      key={activeTenantId}
      partners={partners}
      contracts={contracts}
      onSaveToSystem={async (data) => { await actions.saveContract(data, null); }}
      onNavigateToContracts={() => setActiveTab('contracts')}
    />
  );
}
