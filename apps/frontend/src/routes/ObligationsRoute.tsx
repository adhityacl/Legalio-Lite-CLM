import { ObligationsView } from '../features/obligations/ObligationsView';
import { useTenant } from '../context/TenantContext';

export default function ObligationsRoute() {
  const { activeTenantId } = useTenant();
  return <ObligationsView key={activeTenantId} />;
}
