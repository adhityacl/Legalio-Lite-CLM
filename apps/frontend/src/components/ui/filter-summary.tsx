import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Tag } from '@legalio/ui-components/tag';
export function FilterSummary({ filters, onReset }: { filters: { label: string; value: string; active: boolean }[]; onReset: () => void }) {
  const { t } = useLanguage();
  const active = filters.filter(filter => filter.active);
  if (!active.length) return null;
  return <div className="px-g13 py-g13 flex flex-wrap items-center gap-g8 text-sm" aria-live="polite">
    {active.map((filter, index) => <Tag key={index} size="sm" className="max-w-full">{filter.label}: {filter.value}</Tag>)}
    <Button variant="link" type="button" onClick={onReset}>{t('ui.reset_filters')}</Button>
  </div>;
}
