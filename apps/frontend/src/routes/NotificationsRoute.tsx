import { NotificationsView } from '../components/NotificationsView';
import { useWorkspace } from '../features/workspace/WorkspaceContext';

export default function NotificationsRoute() {
  const { notifications, loadAllData, actions } = useWorkspace();
  return (
    <NotificationsView
      notifications={notifications}
      // Reminder generation is a platform system job; tenant users only refresh their scoped view.
      onTriggerCheck={async () => { void loadAllData(); }}
      onMarkRead={actions.markNotificationsRead}
      onDeleteNotif={actions.deleteNotifications}
    />
  );
}
