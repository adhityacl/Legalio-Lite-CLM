import { SettingsView } from '../components/SettingsView';
import { useNavigation } from '../context/NavigationContext';
import type { SettingsTabId } from '../lib/appRoutes';

export default function SettingsRoute() {
  const { activeTab } = useNavigation();
  return <SettingsView tab={activeTab as SettingsTabId} />;
}
