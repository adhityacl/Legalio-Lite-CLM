import { PrivacyPolicyView } from '../components/PrivacyPolicyView';
import { TermsOfServiceView } from '../components/TermsOfServiceView';
import { useNavigation } from '../context/NavigationContext';

export function PrivacyRoute() {
  const { setActiveTab } = useNavigation();
  return <PrivacyPolicyView onBack={() => setActiveTab('dashboard')} />;
}
export function TermsRoute() {
  const { setActiveTab } = useNavigation();
  return <TermsOfServiceView onBack={() => setActiveTab('dashboard')} />;
}
