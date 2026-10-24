import { ClauseLibraryView } from '../features/clauses/ClauseLibraryView';
import { useTenant } from '../context/TenantContext';

export default function ClausesRoute() {
  const { activeTenantId } = useTenant();
  return <ClauseLibraryView key={activeTenantId} />;
}
