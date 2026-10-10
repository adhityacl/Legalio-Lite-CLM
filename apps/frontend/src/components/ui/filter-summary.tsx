import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
export function FilterSummary({ filters, onReset }: { filters: { label: string; value: string; active: boolean }[]; onReset: () => void }) {
  const { t } = useLanguage();
  const active = filters.filter(filter => filter.active);
  if (!active.length) return null;
  return <div className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
    {active.map((filter, index) => <span key={index} className="max-w-full break-words rounded-lg bg-surface-2 px-3 py-1.5 text-ink">{filter.label}: {filter.value}</span>)}
    <button type="button" onClick={onReset} className="min-h-10 px-4 font-semibold text-status-success underline underline-offset-2">{t('ui.reset_filters')}</button>
  </div>;
}
