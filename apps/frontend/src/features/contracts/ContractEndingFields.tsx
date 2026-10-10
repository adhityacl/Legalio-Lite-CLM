import { Upload } from 'lucide-react';
import { DateInput } from '../../components/DateInput';
import { useLanguage } from '../../context/LanguageContext';
import type { ContractLifecycleFields } from '@legalio/shared/contractLifecycle';
import { useRef, useState } from 'react';
import { Button } from '@legalio/ui-components/button';
import { openTerminationDocument } from '../../lib/terminationDocument';

import { Textarea } from '@legalio/ui-components/textarea';
import { Heading } from '@legalio/ui-components/heading';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Card } from '@legalio/ui-components/card';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
export function ContractEndingFields({ terminated, date, endDate, reason, document, fileName, reading,
  onDate, onReason, onFile }: {
  terminated: boolean; date: string; endDate: string; reason: string;
  document?: ContractLifecycleFields['termination_document']; fileName?: string; reading?: boolean;
  onDate: (value: string) => void; onReason: (value: string) => void; onFile: (file: File | undefined) => void;
}) {
  const { t } = useLanguage();
  const [downloadError, setDownloadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedFileName = fileName || document?.fileName;
  return <section className="space-y-4 rounded-2xl border border-status-success-border bg-status-success-soft/40 p-4 " aria-label={t(terminated ? 'termination.details' : 'termination.expired_details')}>
    <Heading as="h3" size="sm" weight="semibold">{t(terminated ? 'termination.details' : 'termination.expired_details')}</Heading>
    <Field>
      <FieldLabel htmlFor="contract-ending-date">{t(terminated ? 'termination.date' : 'termination.end_date')}{terminated && ' *'}</FieldLabel>
      <DateInput id="contract-ending-date" value={terminated ? date : endDate} onChange={onDate} required={terminated} disabled={!terminated} focusColor="emerald" />
      {!terminated && <p className="mt-1 text-xs text-muted-foreground">{t('termination.end_date_hint')}</p>}
    </Field>
    <div>
      <label htmlFor="contract-termination-document" className="mb-1.5 block text-sm font-bold text-foreground">{t('termination.document')}</label>
      <Card className="p-4 text-center">
        <Upload aria-hidden="true" className="mx-auto mb-2 size-6 text-accent-foreground" />
        <p className="mb-3 break-all text-sm text-foreground">{fileName || document?.fileName || t('termination.choose_document')}</p>
        <input ref={fileInputRef} id="contract-termination-document" type="file" accept=".pdf,.doc,.docx" disabled={reading} tabIndex={-1}
          onChange={event => onFile(event.target.files?.[0])} className="sr-only" />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" disabled={reading} onClick={() => fileInputRef.current?.click()}
            className="shrink-0">
            {t('termination.choose_file')}
          </Button>
          <span aria-live="polite" className="min-w-0 max-w-full break-all text-sm text-muted-foreground">
            {selectedFileName || t('termination.no_file')}
          </span>
        </div>
        {document && <Button type="button" variant="link" className="mt-2" onClick={async () => {
          try { await openTerminationDocument(document); setDownloadError(false); }
          catch { setDownloadError(true); }
        }}>{t('termination.saved_document')}: {document.fileName}</Button>}
        {downloadError && <Alert status="error" role="alert"><AlertContent>{t('termination.file_open_error')}</AlertContent></Alert>}
      </Card>
    </div>
    <Field>
      <FieldLabel htmlFor="contract-termination-reason">{t('termination.reason')}</FieldLabel>
      <Textarea id="contract-termination-reason" rows={3} value={reason} onChange={event => onReason(event.target.value)} maxLength={10000}
        className="w-full resize-y" />
    </Field>
  </section>;
}
