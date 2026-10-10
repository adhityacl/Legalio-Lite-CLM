import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogPositioner,
  DialogTitle,
} from '@legalio/ui-components/dialog';
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
      <Dialog
        role="alertdialog"
        open={open}
        onOpenChange={(details) => {
          if (!details.open) settle(false);
        }}
      >
        <DialogBackdrop />
        <DialogPositioner>
          <DialogContent className="flex flex-col items-center text-center">
            <span
              className={`mb-4 inline-flex size-12 items-center justify-center rounded-full ${isDanger ? 'bg-status-danger-soft text-status-danger' : 'bg-muted text-muted-foreground'}`}
              aria-hidden="true"
            >
              <Icon className="size-6" />
            </span>
            <DialogTitle>{options?.title || t('confirm.default_title', 'Konfirmasi')}</DialogTitle>
            <DialogDescription className="mt-2 whitespace-pre-line">{options?.description}</DialogDescription>
            {/* Cancel is first in DOM so it receives default focus on open (safe default per UX Planet). */}
            <DialogFooter className="w-full justify-center">
              <Button variant="outline" onClick={() => settle(false)}>
                {options?.cancelLabel || t('confirm.cancel', 'Batal')}
              </Button>
              <Button variant={isDanger ? 'destructive' : 'default'} onClick={() => settle(true)}>
                {options?.confirmLabel || t('confirm.continue', 'Lanjutkan')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </DialogPositioner>
      </Dialog>
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
