import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { formatBusinessDate } from '../../lib/displayDate';
import { openTerminationDocument } from '../../lib/terminationDocument';
import type { Contract } from '@legalio/types';

export function ContractEndingSummary({ contract }: { contract: Contract }) {
  const { t } = useLanguage();
  const [error, setError] = useState(false);
  if (!contract.termination_date && !contract.termination_document && !contract.termination_reason) return null;
  return <section aria-label={t('termination.details')} className="space-y-3 rounded-xl border border-status-success-border bg-status-success-soft/40 p-4 dark:bg-status-success-soft/20">
    <h3 className="text-sm font-bold">{t(contract.termination_date ? 'termination.details' : 'termination.expired_details')}</h3>
    <p><span className="font-semibold">{t(contract.termination_date ? 'termination.date' : 'termination.end_date')}: </span>{formatBusinessDate(contract.termination_date || contract.tanggal_berakhir)}</p>
    {contract.termination_reason && <p className="whitespace-pre-wrap break-words"><span className="font-semibold">{t('termination.reason')}: </span>{contract.termination_reason}</p>}
    {contract.termination_document && <Button size="lg" type="button" variant="outline" className="max-w-full whitespace-normal break-all" onClick={async () => {
      try { await openTerminationDocument(contract.termination_document!); setError(false); } catch { setError(true); }
    }}>{t('termination.document')}: {contract.termination_document.fileName}</Button>}
    {error && <p role="alert" className="ds-alert ds-status-danger border">{t('termination.file_open_error')}</p>}
  </section>;
}
