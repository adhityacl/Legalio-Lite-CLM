import React from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { CardHeader } from '@legalio/ui-components/card';
import { DialogTitle } from '@legalio/ui-components/dialog';

/** Title bar of the settings dialogs (same look as the Members & Access dialogs). */
export const DialogHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => {
  const { t } = useLanguage();
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-g13 border-b border-border pb-g13">
      <DialogTitle className="flex items-center gap-g8">{title}</DialogTitle>
      <Button type="button" variant="ghost" size="icon-md" onClick={onClose} aria-label={t('common.close', 'Close')}><X className="h-g16 w-g16" aria-hidden="true" /></Button>
    </CardHeader>
  );
};

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const formatTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
