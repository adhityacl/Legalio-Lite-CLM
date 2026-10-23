import { BulkImportView } from '../components/BulkImportView';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function BulkImportRoute() {
  const { partners, contracts, ios, loadAllData } = useWorkspace();
  return <BulkImportView partners={partners} contracts={contracts} ios={ios} onRefreshData={loadAllData} />;
}
