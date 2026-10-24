import { NotificationsView } from '../components/NotificationsView';
import { useWorkspace } from '../features/workspace/WorkspaceContext';
import { useNotifications } from '../features/notifications/useNotifications';

export default function NotificationsRoute() {
  const { loadAllData, actions } = useWorkspace();
  const { notifications } = useNotifications();
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
