import { HierarchyTreemapView } from '../components/HierarchyTreemapView';
import { useNavigation } from '../context/NavigationContext';
import { useSnapshotDemand, useWorkspace } from '../features/workspace/WorkspaceContext';

export default function HierarchyRoute() {
  const { setActiveTab } = useNavigation();
  // The hierarchy cross-references every record type, so it works on the full workspace snapshot.
  useSnapshotDemand(true);
  const { partners, contracts, ios, evaluations, spendings, workspaceLoading, workspaceError, loadAllData, openEditor } = useWorkspace();
  return (
    <HierarchyTreemapView
      loading={workspaceLoading}
      error={workspaceError}
      onRetry={() => void loadAllData()}
      onOpenCalendarDocument={(kind, id) => setActiveTab(kind === 'contract' ? 'contracts' : 'ios', undefined, { recordId: id })}
      partners={partners}
      contracts={contracts}
      ios={ios}
      evaluations={evaluations}
      spendings={spendings}
      onOpenAddPartner={() => openEditor({ kind: 'partner', record: null })}
      onOpenAddContract={(partnerId) => openEditor({ kind: 'contract', record: partnerId ? ({ partner_id: partnerId } as any) : null })}
      onOpenAddIO={(contractId, partnerId) => openEditor({ kind: 'io', record: contractId || partnerId ? ({ contract_id: contractId, partner_id: partnerId } as any) : null })}
      onSelectPartner={(p) => openEditor({ kind: 'partner', record: p })}
      onSelectContract={(ctr) => openEditor({ kind: 'contract', record: ctr })}
      onSelectIO={(io) => openEditor({ kind: 'io', record: io })}
    />
  );
}
