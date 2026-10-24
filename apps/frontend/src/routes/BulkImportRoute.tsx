import { useLanguage } from '../context/LanguageContext';
import { BulkImportView } from '../components/BulkImportView';
import { useSnapshotDemand, useWorkspace } from '../features/workspace/WorkspaceContext';
import { LoadingState } from '../components/StateScreen';

export default function BulkImportRoute() {
  const { t } = useLanguage();
  useSnapshotDemand(true);
  const { partners, contracts, ios, loadAllData, snapshotLoaded } = useWorkspace();
  if (!snapshotLoaded) return <LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />;
  return <BulkImportView partners={partners} contracts={contracts} ios={ios} onRefreshData={loadAllData} />;
}
