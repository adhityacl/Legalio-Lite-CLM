import React, { useState } from 'react';
import { Check, Palette, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { accentPalettes, findAccentPalette, organizationThemeTokens } from '../../lib/organizationColors';
import { Button } from '@legalio/ui-components/button';
import { ModalFrame } from '../ui/modal-frame';

import { DialogTitle } from '@legalio/ui-components/dialog';
import { Text } from '@legalio/ui-components/text';
import { Toggle } from '@legalio/ui-components/toggle';
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
        <span className="h-g26 w-g26 rounded-md border border-border" style={{ backgroundColor: value }} aria-hidden="true" />
        <span>{palette?.label || value.toUpperCase()}</span>
        <Palette className="h-g16 w-g16" aria-hidden="true" />
      </Button>
      {open && (
        <ModalFrame onClose={() => setOpen(false)} className="flex w-full max-w-g610 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-g13 border-b border-border p-g21">
            <div>
              <DialogTitle className="flex items-center gap-g8">{title}</DialogTitle>
              <Text size="xs" tone="muted" className="mt-g3">{t('tb.radix_palette_hint', 'Radix Colors · 12 shades · Light and dark themes')}</Text>
            </div>
            <Button type="button" variant="ghost" size="icon-md" aria-label={t('common.close', 'Close')} onClick={() => setOpen(false)}><X className="h-g16 w-g16" aria-hidden="true" /></Button>
          </div>
          <div className="min-h-0 overflow-y-auto p-g21">
            <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={title}>
              {accentPalettes.map(item => {
                const selected = chosen?.name === item.name;
                return (
                  <Toggle key={item.name} variant="outline" pressed={selected} onPressedChange={() => setDraft(item.light[8].toUpperCase())}
                    className="h-auto w-full flex-col items-stretch gap-g8 p-g13 text-start data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-foreground">
                    <span className="flex items-center justify-between text-sm font-medium"><span>{item.label}</span>{selected && <Check className="h-g16 w-g16 text-accent-foreground" aria-hidden="true" />}</span>
                    <span className="flex h-g26 overflow-hidden rounded-md" aria-hidden="true">{item[theme].map((color, index) => <span key={index} className="flex-1" style={{ backgroundColor: color }} />)}</span>
                  </Toggle>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-g13 border-t border-border p-g21">
            <span className="rounded-lg px-g13 py-g8 text-sm font-semibold" style={{ backgroundColor: preview['--primary'], color: preview['--primary-foreground'] }}>{chosen?.label || draft.toUpperCase()}</span>
            <div className="flex gap-g8">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('admin.btn_cancel', 'Cancel')}</Button>
              <Button type="button" disabled={disabled} onClick={() => { onChange(draft); setOpen(false); }}>{t('admin.btn_apply', 'Apply')}</Button>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
