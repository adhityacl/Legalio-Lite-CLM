import React, { useRef } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useLanguage } from '../../context/LanguageContext';

export function EditorSidePanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const restore = useRef<HTMLElement | null>(null);
  const { t } = useLanguage();
  if (desktop) return <aside className="editor-side-panel w-[25rem] xl:w-[27rem] min-h-0 bg-card border-l border-border flex shrink-0 z-10 overflow-hidden">{children}</aside>;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/60 animate-in" />
    <Dialog.Content aria-describedby={undefined}
      onOpenAutoFocus={() => { restore.current = document.activeElement as HTMLElement; }}
      onCloseAutoFocus={event => { event.preventDefault(); restore.current?.focus(); }}
      className="fixed inset-y-0 right-0 z-50 editor-side-panel w-[min(27rem,100vw)] flex flex-col bg-card shadow-xl animate-in">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <Dialog.Title className="flex items-center gap-2">{t('contract_creator.panel_title', 'Panel Asisten Kontrak')}</Dialog.Title>
        <Dialog.Close className="min-w-10 min-h-10 inline-flex items-center justify-center rounded-lg" aria-label={t('common.close', 'Close')}><X className="w-5 h-5" /></Dialog.Close>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
