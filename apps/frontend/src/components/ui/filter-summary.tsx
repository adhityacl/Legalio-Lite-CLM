import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
export function FilterSummary({ filters, onReset }: { filters: { label: string; value: string; active: boolean }[]; onReset: () => void }) {
  const { t } = useLanguage();
  const active = filters.filter(filter => filter.active);
  if (!active.length) return null;
  return <div className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
    {active.map((filter, index) => <span key={index} className="max-w-full break-words rounded-lg bg-muted px-3 py-1.5 text-foreground">{filter.label}: {filter.value}</span>)}
    <Button variant="link" type="button" onClick={onReset}>{t('ui.reset_filters')}</Button>
  </div>;
}
