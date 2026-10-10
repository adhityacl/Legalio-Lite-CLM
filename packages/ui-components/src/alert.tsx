import * as React from 'react';
import { Alert as ModuixAlert, AlertTitle, AlertDescription } from '@moduix/react-tailwind/alert';
import { cn } from './utils';
export { AlertTitle, AlertDescription };
export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' | 'warning' | 'success' }>(
  ({ className, variant = 'default', role = 'alert', ...props }, ref) => <ModuixAlert ref={ref} role={role} status={variant === 'default' ? 'info' : variant === 'destructive' ? 'error' : variant} className={cn('ds-alert', className)} {...props} />,
);
