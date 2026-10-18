import React, { useEffect, useState } from 'react';
import { ModalFrame } from '../ui/modal-frame';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { DialogCloseIcon, DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Text } from '@legalio/ui-components/text';
import {
  MARGIN_PRESETS,
  MAX_MARGIN_MM,
  MIN_MARGIN_MM,
  sanitizePageLayout,
  type Orientation,
  type PageLayout,
  type PaperSize,
} from '@legalio/shared/pageLayout';

interface DialogProps {
  isOpen: boolean;
  layout: PageLayout;
  onClose: () => void;
  onApply: (layout: PageLayout) => void;
}

const sameMargins = (a: PageLayout['margins'], b: PageLayout['margins']) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

const presetOf = (margins: PageLayout['margins']) =>
  (Object.keys(MARGIN_PRESETS) as Array<keyof typeof MARGIN_PRESETS>).find((key) => sameMargins(MARGIN_PRESETS[key], margins)) ?? 'custom';

/** Paper size, orientation and margins, like Word's Layout > Page Setup. */
export const PageSetupDialog: React.FC<DialogProps> = ({ isOpen, layout, onClose, onApply }) => {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(layout);
  useEffect(() => { if (isOpen) setDraft(layout); }, [isOpen, layout]);
  if (!isOpen) return null;

  const setMargin = (side: keyof PageLayout['margins'], value: string) =>
    setDraft((current) => ({ ...current, margins: { ...current.margins, [side]: Number(value) } }));
  const preset = presetOf(draft.margins);
  const sides: Array<{ side: keyof PageLayout['margins']; label: string }> = [
    { side: 'top', label: t('page.margin_top', 'Atas') },
    { side: 'bottom', label: t('page.margin_bottom', 'Bawah') },
    { side: 'left', label: t('page.margin_left', 'Kiri') },
    { side: 'right', label: t('page.margin_right', 'Kanan') },
  ];

  return (
    <ModalFrame size="md" onClose={onClose} className="overflow-hidden overflow-y-auto">
      <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
        <DialogTitle>{t('page.setup_title', 'Pengaturan Halaman')}</DialogTitle>
        <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
      </DialogHeader>
      <form
        className="grid gap-g13 p-g21"
        onSubmit={(event) => { event.preventDefault(); onApply(sanitizePageLayout(draft)); onClose(); }}
      >
        <div className="grid grid-cols-2 gap-g13">
          <Field>
            <FieldLabel htmlFor="page-paper">{t('page.paper', 'Ukuran kertas')}</FieldLabel>
            <NativeSelect id="page-paper" value={draft.paper} onChange={(event) => setDraft({ ...draft, paper: event.target.value as PaperSize })}>
              <option value="A4">A4 (210 × 297 mm)</option>
              <option value="LETTER">Letter (8.5 × 11 in)</option>
              <option value="LEGAL">Legal (8.5 × 14 in)</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="page-orientation">{t('page.orientation', 'Orientasi')}</FieldLabel>
            <NativeSelect id="page-orientation" value={draft.orientation} onChange={(event) => setDraft({ ...draft, orientation: event.target.value as Orientation })}>
              <option value="portrait">{t('page.portrait', 'Potret')}</option>
              <option value="landscape">{t('page.landscape', 'Lanskap')}</option>
            </NativeSelect>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="page-margin-preset">{t('page.margins', 'Margin')}</FieldLabel>
          <NativeSelect
            id="page-margin-preset"
            value={preset}
            onChange={(event) => {
              const key = event.target.value as keyof typeof MARGIN_PRESETS | 'custom';
              if (key !== 'custom') setDraft({ ...draft, margins: { ...MARGIN_PRESETS[key] } });
            }}
          >
            <option value="normal">{t('page.margin_normal', 'Normal (2,54 cm)')}</option>
            <option value="narrow">{t('page.margin_narrow', 'Sempit (1,27 cm)')}</option>
            <option value="moderate">{t('page.margin_moderate', 'Sedang')}</option>
            <option value="wide">{t('page.margin_wide', 'Lebar')}</option>
            <option value="custom">{t('page.margin_custom', 'Kustom')}</option>
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-4 gap-g8">
          {sides.map(({ side, label }) => (
            <Field key={side}>
              <FieldLabel htmlFor={`page-margin-${side}`}>{label} (mm)</FieldLabel>
              <Input
                id={`page-margin-${side}`}
                type="number"
                inputMode="decimal"
                min={MIN_MARGIN_MM}
                max={MAX_MARGIN_MM}
                step={0.1}
                value={draft.margins[side]}
                onChange={(event) => setMargin(side, event.target.value)}
              />
            </Field>
          ))}
        </div>
        <Text size="xs" tone="muted">{t('page.setup_hint', 'Berlaku untuk tampilan halaman, unduhan Word, dan cetak PDF.')}</Text>
        <div className="flex items-center justify-end gap-g8 pt-g8">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Batal')}</Button>
          <Button type="submit">{t('admin.btn_apply', 'Terapkan')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};
