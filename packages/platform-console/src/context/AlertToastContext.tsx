import React, { createContext, useCallback, useContext, useState } from 'react';
import { useLanguage } from './LanguageContext';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@legalio/ui-components/alert';

export type AlertToastVariant = 'default' | 'success' | 'destructive' | 'warning';

export interface AlertToastOptions {
  title: string;
  description?: string;
  variant?: AlertToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4500ms. */
  durationMs?: number;
}

interface AlertToastItem {
  id: string;
  title: string;
  description?: string;
  variant: AlertToastVariant;
}

type ShowAlertFn = (options: AlertToastOptions | string) => void;

const AlertToastContext = createContext<ShowAlertFn | undefined>(undefined);

const VARIANT_ICON: Record<AlertToastVariant, React.ComponentType<{ className?: string }>> = {
  default: Info,
  success: CheckCircle2,
  destructive: XCircle,
  warning: AlertTriangle,
};

export const AlertToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  const [items, setItems] = useState<AlertToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showAlert = useCallback<ShowAlertFn>(
    (opts) => {
      const normalized: AlertToastOptions = typeof opts === 'string' ? { title: opts } : opts;
      const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const variant = normalized.variant || 'default';
      setItems((prev) => [...prev, { id, title: normalized.title, description: normalized.description, variant }]);
      window.setTimeout(() => dismiss(id), normalized.durationMs ?? 4500);
    },
    [dismiss]
  );

  return (
    <AlertToastContext.Provider value={showAlert}>
      {children}
      <div className="pointer-events-none fixed top-4 left-1/2 z-100 flex w-full max-w-sm -translate-x-1/2 flex-col items-stretch gap-2 px-4">
        {items.map((item) => {
          const Icon = VARIANT_ICON[item.variant];
          return (
            <div key={item.id} className="pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-200">
              <Alert variant={item.variant} className="bg-surface shadow-lg pr-8">
                <Icon className="h-4 w-4" />
                <AlertTitle>{item.title}</AlertTitle>
                {item.description && <AlertDescription>{item.description}</AlertDescription>}
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label={t('common.tutup_notifikasi', 'Tutup notifikasi')}
                  className="absolute right-2 top-2.5 text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Alert>
            </div>
          );
        })}
      </div>
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
