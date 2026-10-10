import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Popover, PopoverContent, PopoverTrigger } from '@legalio/ui-components/popover';

/** Column preferences use native checkboxes inside a keyboard-accessible popover. */
export function TableViewMenu({ children, label, title, className = '' }: {
  children: React.ReactNode; label?: string; title?: string; className?: string;
}) {
  const { t } = useLanguage();
  const buttonLabel = label || t('io.view', 'View');
  const description = title || t('io.view_settings', 'Pengaturan Tampilan Kolom');
  return <div className={`relative flex-initial ${className}`}>
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title={description}
          className="ui-button ui-button-lg flex items-center justify-center cursor-pointer active:scale-[0.98] w-full ds-button ds-button-lg ds-button-outline">
          <SlidersHorizontal className="w-3.5 h-3.5 text-ink-soft" aria-hidden />
          <span>{buttonLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} aria-label={description}
        className="w-52 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-2xl py-2 px-0 shadow-xl">
        {children}
      </PopoverContent>
    </Popover>
  </div>;
}
