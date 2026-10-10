import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@legalio/ui-components/alert-dialog';
import { useLanguage } from './LanguageContext';

export interface ConfirmOptions {
  title?: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' renders the confirm button in the destructive (red) style — use for delete/ban/irreversible actions. */
  tone?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | undefined>(undefined);

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    const normalized: ConfirmOptions = typeof opts === 'string' ? { description: opts } : opts;
    setOptions(normalized);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOpen(false);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const isDanger = options?.tone === 'danger';
  // Icon always signals the nature of the action (UX Planet: "confirmation dialogs" —
  // an icon is a visual cue for severity, so it's never omitted, only its color/glyph changes).
  const Icon = isDanger ? AlertTriangle : Info;

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader className="gap-2">
            <div className="relative mb-1 flex h-16 w-16 items-center justify-center shrink-0">
              <span
                className={`absolute h-16 w-16 rounded-full ${
                  isDanger ? 'bg-status-danger-soft dark:bg-status-danger-soft/30' : 'bg-surface-2 dark:bg-surface-2/60'
                }`}
              />
              <span
                className={`absolute h-10 w-10 rounded-full ${
                  isDanger ? 'bg-status-danger-soft dark:bg-status-danger-soft/40' : 'bg-surface-2/80 dark:bg-surface-2/60'
                }`}
              />
              <Icon
                className={`relative h-6 w-6 ${isDanger ? 'text-status-danger ' : 'text-ink-soft dark:text-ink'}`}
              />
            </div>
            <AlertDialogTitle className="text-center">
              {options?.title || t('confirm.default_title', 'Konfirmasi')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center whitespace-pre-line">
              {options?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Cancel is first in DOM so it receives default focus on open (safe default per UX Planet). */}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {options?.cancelLabel || t('confirm.cancel', 'Batal')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={isDanger ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel || t('confirm.continue', 'Lanjutkan')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  }
  return context;
};
