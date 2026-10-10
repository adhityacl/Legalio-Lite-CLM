import React, { useState } from 'react';
import { Check, Palette, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { accentPalettes, findAccentPalette, organizationThemeTokens } from '../../lib/organizationColors';
import { Button } from '@legalio/ui-components/button';
import { ModalFrame } from '../ui/modal-frame';

import { DialogTitle } from '@legalio/ui-components/dialog';
export function OrganizationColorPicker({ id, value, onChange, disabled }: {
  id: string;
  value: string;
  onChange: (color: string) => void;
  disabled: boolean;
}) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const palette = findAccentPalette(value);
  const chosen = findAccentPalette(draft);
  const preview = organizationThemeTokens(draft, theme === 'dark');
  const title = t('tb.choose_palette', 'Choose color palette');
  return (
    <>
      <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={title} onClick={() => { setDraft(value); setOpen(true); }}>
        <span className="h-6 w-6 rounded-md border border-black/10" style={{ backgroundColor: value }} aria-hidden="true" />
        <span>{palette?.label || value.toUpperCase()}</span>
        <Palette className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <ModalFrame onClose={() => setOpen(false)} className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border p-5">
            <div>
              <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">{t('tb.radix_palette_hint', 'Radix Colors · 12 shades · Light and dark themes')}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-md" aria-label={t('common.close', 'Close')} onClick={() => setOpen(false)}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
          <div className="min-h-0 overflow-y-auto p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={title}>
              {accentPalettes.map(item => {
                const selected = chosen?.name === item.name;
                return (
                  <button key={item.name} type="button" aria-pressed={selected} onClick={() => setDraft(item.light[8].toUpperCase())}
                    className={`rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected ? 'border-primary bg-accent' : 'border-border hover:border-border '}`}>
                    <span className="mb-2 flex items-center justify-between text-sm font-medium"><span>{item.label}</span>{selected && <Check className="h-4 w-4 text-accent-foreground" aria-hidden="true" />}</span>
                    <span className="flex h-6 overflow-hidden rounded-md" aria-hidden="true">{item[theme].map((color, index) => <span key={index} className="flex-1" style={{ backgroundColor: color }} />)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5">
            <span className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: preview['--primary'], color: preview['--primary-foreground'] }}>{chosen?.label || draft.toUpperCase()}</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('admin.btn_cancel', 'Cancel')}</Button>
              <Button type="button" disabled={disabled} onClick={() => { onChange(draft); setOpen(false); }}>{t('admin.btn_apply', 'Apply')}</Button>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
