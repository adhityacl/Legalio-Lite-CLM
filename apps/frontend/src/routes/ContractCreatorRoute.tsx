import { useLanguage } from '../context/LanguageContext';
import { ContractCreatorView } from '../components/ContractCreatorView';
import { useNavigation } from '../context/NavigationContext';
import { useTenant } from '../context/TenantContext';
import { useSnapshotDemand, useWorkspace } from '../features/workspace/WorkspaceContext';
import { LoadingState } from '../components/StateScreen';

export default function ContractCreatorRoute() {
  const { activeTenantId } = useTenant();
  const { setActiveTab } = useNavigation();
  const { t } = useLanguage();
  useSnapshotDemand(true);
  const { partners, contracts, actions, snapshotLoaded } = useWorkspace();
  if (!snapshotLoaded) return <LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />;
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
