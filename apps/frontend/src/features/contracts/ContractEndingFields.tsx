import { Upload } from 'lucide-react';
import { DateInput } from '../../components/DateInput';
import { useLanguage } from '../../context/LanguageContext';
import type { ContractLifecycleFields } from '@legalio/shared/contractLifecycle';
import { useRef, useState } from 'react';
import { Button } from '@legalio/ui-components/button';
import { openTerminationDocument } from '../../lib/terminationDocument';

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
  return <section className="space-y-4 rounded-2xl border border-status-success-border bg-status-success-soft/40 p-4 dark:bg-status-success-soft/20" aria-label={t(terminated ? 'termination.details' : 'termination.expired_details')}>
    <h3 className="ds-section-title">{t(terminated ? 'termination.details' : 'termination.expired_details')}</h3>
    <div>
      <label htmlFor="contract-ending-date" className="mb-1.5 block text-sm font-bold text-ink">{t(terminated ? 'termination.date' : 'termination.end_date')}{terminated && ' *'}</label>
      <DateInput id="contract-ending-date" value={terminated ? date : endDate} onChange={onDate} required={terminated} disabled={!terminated} focusColor="emerald" />
      {!terminated && <p className="mt-1 text-xs text-ink-soft">{t('termination.end_date_hint')}</p>}
    </div>
    <div>
      <label htmlFor="contract-termination-document" className="mb-1.5 block text-sm font-bold text-ink">{t('termination.document')}</label>
      <div className="ds-panel p-4 text-center">
        <Upload aria-hidden="true" className="mx-auto mb-2 size-6 text-accent-text" />
        <p className="mb-3 break-all text-sm text-ink">{fileName || document?.fileName || t('termination.choose_document')}</p>
        <input ref={fileInputRef} id="contract-termination-document" type="file" accept=".pdf,.doc,.docx" disabled={reading} tabIndex={-1}
          onChange={event => onFile(event.target.files?.[0])} className="sr-only" />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" disabled={reading} onClick={() => fileInputRef.current?.click()}
            className="shrink-0 text-sm">
            {t('termination.choose_file')}
          </Button>
          <span aria-live="polite" className="min-w-0 max-w-full break-all text-sm text-ink-soft">
            {selectedFileName || t('termination.no_file')}
          </span>
        </div>
        {document && <Button type="button" variant="link" className="mt-2" onClick={async () => {
          try { await openTerminationDocument(document); setDownloadError(false); }
          catch { setDownloadError(true); }
        }}>{t('termination.saved_document')}: {document.fileName}</Button>}
        {downloadError && <p role="alert" className="ds-alert ds-status-danger border">{t('termination.file_open_error')}</p>}
      </div>
    </div>
    <div>
      <label htmlFor="contract-termination-reason" className="mb-1.5 block text-sm font-bold text-ink">{t('termination.reason')}</label>
      <textarea id="contract-termination-reason" rows={3} value={reason} onChange={event => onReason(event.target.value)} maxLength={10000}
        className="ds-input w-full resize-y" />
    </div>
  </section>;
}
