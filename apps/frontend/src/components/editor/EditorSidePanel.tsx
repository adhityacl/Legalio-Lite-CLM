import React from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useLanguage } from '../../context/LanguageContext';
import { Drawer, DrawerBackdrop, DrawerCloseIcon, DrawerContent, DrawerHeader, DrawerPositioner, DrawerTitle } from '@legalio/ui-components/drawer';

/** Editor assistant panel: docked beside the paper on desktop, a moduix Drawer from the end edge on smaller screens. */
export function EditorSidePanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const { t } = useLanguage();
  if (desktop) return <aside className="editor-side-panel z-10 flex min-h-0 w-100 shrink-0 overflow-hidden border-s border-border bg-card xl:w-108">{children}</aside>;
  return (
    <Drawer open swipeDirection="end" onOpenChange={details => { if (!details.open) onClose(); }}>
      <DrawerBackdrop />
      <DrawerPositioner>
        <DrawerContent className="editor-side-panel flex w-[min(27rem,100vw)] flex-col p-0">
          <DrawerHeader className="border-b border-border px-4 py-3">
            <DrawerTitle>{t('contract_creator.panel_title', 'Panel Asisten Kontrak')}</DrawerTitle>
            <DrawerCloseIcon aria-label={t('common.close', 'Close')} />
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
        </DrawerContent>
      </DrawerPositioner>
    </Drawer>
  );
}
