import { ApprovalView } from '../features/approvals/ApprovalView';
import { useTenant } from '../context/TenantContext';

export default function ApprovalRoute() {
  const { activeTenantId } = useTenant();
  return <ApprovalView key={activeTenantId} />;
}
