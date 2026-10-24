import { DashboardView } from '../components/DashboardView';
import { useNavigation } from '../context/NavigationContext';
import { useDashboardAggregate } from '../features/aggregates/useAggregates';

export default function DashboardRoute() {
  const { setActiveTab } = useNavigation();
  const dashboard = useDashboardAggregate();
  return (
    <DashboardView
      data={dashboard.data}
      loading={dashboard.isLoading}
      onNavigateTab={(tab, recordId) => setActiveTab(tab, undefined, recordId ? { recordId } : undefined)}
    />
  );
}
