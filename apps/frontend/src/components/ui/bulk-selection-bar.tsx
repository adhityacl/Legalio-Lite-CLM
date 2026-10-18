import React from 'react';
import { Trash2 } from 'lucide-react';
import { Card } from '@legalio/ui-components/card';
import { Button } from '@legalio/ui-components/button';
import { useLanguage } from '../../context/LanguageContext';

/** Appears above a table while rows are selected, like the Notification Center's bulk action bar. */
export function BulkSelectionBar({ count, noun, onDelete }: { count: number; noun: string; onDelete: () => void }) {
  const { t } = useLanguage();
  if (count === 0) return null;
  return (
    <Card className="flex flex-row flex-wrap items-center justify-between gap-g13 px-g21 py-g13 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-g5 text-sm font-medium text-foreground">
        <span className="font-semibold text-accent-foreground">{count}</span>
        <span>{t('bulk.selected', '{noun} dipilih', { noun })}</span>
      </div>
      <Button variant="destructive-outline" size="sm" type="button" onClick={onDelete}>
        <Trash2 className="w-g13 h-g13" />
        <span>{t('bulk.delete_selected', 'Hapus Terpilih')}</span>
      </Button>
    </Card>
  );
}
