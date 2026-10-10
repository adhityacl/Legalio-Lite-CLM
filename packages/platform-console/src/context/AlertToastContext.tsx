import React, { createContext, useCallback, useContext } from 'react';
import { ToastToaster, createToaster } from '@legalio/ui-components/toast';

export type AlertToastVariant = 'default' | 'success' | 'destructive' | 'warning';

export interface AlertToastOptions {
  title: string;
  description?: string;
  variant?: AlertToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4500ms. */
  durationMs?: number;
}

type ShowAlertFn = (options: AlertToastOptions | string) => void;

const AlertToastContext = createContext<ShowAlertFn | undefined>(undefined);

const toaster = createToaster({ placement: 'top', overlap: true, gap: 12 });
const TOAST_TYPE: Record<AlertToastVariant, 'info' | 'success' | 'error' | 'warning'> = {
  default: 'info',
  success: 'success',
  destructive: 'error',
  warning: 'warning',
};

/** moduix Toast notifications behind the existing `useAlertToast()` contract. */
export const AlertToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const showAlert = useCallback<ShowAlertFn>((opts) => {
    const { title, description, variant = 'default', durationMs } = typeof opts === 'string' ? { title: opts } as AlertToastOptions : opts;
    toaster.create({ title, description, type: TOAST_TYPE[variant], duration: durationMs ?? 4500 });
  }, []);

  return (
    <AlertToastContext.Provider value={showAlert}>
      {children}
      <ToastToaster toaster={toaster} />
    </AlertToastContext.Provider>
  );
};

export const useAlertToast = (): ShowAlertFn => {
  const context = useContext(AlertToastContext);
  if (!context) {
    throw new Error('useAlertToast must be used within an AlertToastProvider');
  }
  return context;
};
