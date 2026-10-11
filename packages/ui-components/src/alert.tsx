import * as React from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Alert as ModuixAlert, AlertIndicator as ModuixAlertIndicator } from './moduix/ui/alert';

export * from './moduix/ui/alert';

type AlertStatus = NonNullable<React.ComponentProps<typeof ModuixAlert>['status']>;
const AlertStatusContext = React.createContext<AlertStatus | undefined>(undefined);
const statusIcons: Partial<Record<string, LucideIcon>> = { error: CircleAlert, warning: TriangleAlert, success: CircleCheck, info: Info };

/** moduix Alert that shares its status so the indicator can show the matching icon. */
export const Alert = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof ModuixAlert>>(({ status, ...props }, ref) => (
  <AlertStatusContext.Provider value={status}>
    <ModuixAlert ref={ref} status={status} {...props} />
  </AlertStatusContext.Provider>
));
Alert.displayName = 'Alert';

/** moduix AlertIndicator; without children it renders the status icon (product decision). */
export const AlertIndicator = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<typeof ModuixAlertIndicator>>(({ children, ...props }, ref) => {
  const status = React.useContext(AlertStatusContext);
  const Icon = statusIcons[status ?? 'info'] ?? Info;
  return <ModuixAlertIndicator ref={ref} {...props}>{children ?? <Icon />}</ModuixAlertIndicator>;
});
AlertIndicator.displayName = 'AlertIndicator';
