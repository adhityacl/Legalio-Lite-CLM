import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { formatBusinessDate } from '../../lib/displayDate';
import { openTerminationDocument } from '../../lib/terminationDocument';
import type { Contract } from '@legalio/types';

import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { Card } from '@legalio/ui-components/card';
export function ContractEndingSummary({ contract }: { contract: Contract }) {
  const { t } = useLanguage();
  const [error, setError] = useState(false);
  if (!contract.termination_date && !contract.termination_document && !contract.termination_reason) return null;
  return <Card asChild><section aria-label={t('termination.details')} className="space-y-g13 p-g21">
    <Heading as="h3" size="xs" weight="bold">{t(contract.termination_date ? 'termination.details' : 'termination.expired_details')}</Heading>
    <Text size="sm"><Text as="strong" size="sm">{t(contract.termination_date ? 'termination.date' : 'termination.end_date')}: </Text>{formatBusinessDate(contract.termination_date || contract.tanggal_berakhir)}</Text>
    {contract.termination_reason && <Text size="sm" className="whitespace-pre-wrap break-words"><Text as="strong" size="sm">{t('termination.reason')}: </Text>{contract.termination_reason}</Text>}
    {contract.termination_document && <Button type="button" variant="outline" className="max-w-full" onClick={async () => {
      try { await openTerminationDocument(contract.termination_document!); setError(false); } catch { setError(true); }
    }}>{t('termination.document')}: {contract.termination_document.fileName}</Button>}
    {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('termination.file_open_error')}</AlertDescription></AlertContent></Alert>}
  </section></Card>;
}
