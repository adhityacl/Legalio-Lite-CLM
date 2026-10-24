import { Upload } from 'lucide-react';
import { DateInput } from '../../components/DateInput';
import { useLanguage } from '../../context/LanguageContext';
import type { ContractLifecycleFields } from '@legalio/shared/contractLifecycle';
import { useRef, useState } from 'react';
import { Button } from '@legalio/ui-components/button';
import { openTerminationDocument } from '../../lib/terminationDocument';

import { Textarea } from '@legalio/ui-components/textarea';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { FormSection } from '@legalio/ui-components/blocks';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadLabel, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Text } from '@legalio/ui-components/text';
import { voidHandler } from '@legalio/shared/voidHandler';
export function ContractEndingFields({ step, terminated, date, endDate, reason, document, fileName, reading,
  onDate, onReason, onFile }: {
  step: number; terminated: boolean; date: string; endDate: string; reason: string;
  document?: ContractLifecycleFields['termination_document']; fileName?: string; reading?: boolean;
  onDate: (value: string) => void; onReason: (value: string) => void; onFile: (file: File | undefined) => void;
}) {
  const { t } = useLanguage();
  const [downloadError, setDownloadError] = useState(false);
  // FileUpload keeps accepted files; remount after each pick so the same file can be chosen again.
  const [uploadKey, setUploadKey] = useState(0);
  const title = t(terminated ? 'termination.details' : 'termination.expired_details');
  // Named region so assistive tech (and the e2e suite) can find this block on its own.
  return <section aria-label={title}><FormSection step={step} title={title}>
    <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
      <Field className="min-w-0">
        <FieldLabel htmlFor="contract-ending-date">{t(terminated ? 'termination.date' : 'termination.end_date')}{terminated && ' *'}</FieldLabel>
        <DateInput id="contract-ending-date" value={terminated ? date : endDate} onChange={onDate} required={terminated} disabled={!terminated} focusColor="emerald" />
        {!terminated && <FieldHelperText>{t('termination.end_date_hint')}</FieldHelperText>}
      </Field>
    </div>
    <Field>
      <FieldLabel htmlFor="contract-termination-reason">{t('termination.reason')}</FieldLabel>
      <Textarea id="contract-termination-reason" rows={3} value={reason} onChange={event => onReason(event.target.value)} maxLength={10000}
        placeholder={t('contract.form.reason_ph', 'Reason note...')} />
    </Field>
    <div className="grid gap-g8">
      <FileUpload key={uploadKey} className="w-full" accept=".pdf,.doc,.docx" maxFiles={1} disabled={reading}
        onFileAccept={details => { onFile(details.files[0]); setUploadKey(k => k + 1); }}>
        <FileUploadLabel>{t('termination.document')}</FileUploadLabel>
        <FileUploadDropzone aria-label={t('termination.choose_document')}>
          <FileUploadDropzoneIcon />
          <Text size="sm" weight="semibold" className="break-all">{fileName || document?.fileName || t('contract.form.choose_reference', 'Choose a reference document')}</Text>
          <FileUploadTrigger asChild><Button type="button" size="sm" disabled={reading}>{t('contract.form.choose_file', 'Choose file')}</Button></FileUploadTrigger>
        </FileUploadDropzone>
        <FileUploadHiddenInput aria-label={t('termination.document')} />
      </FileUpload>
      {document && <Button type="button" variant="link" className="justify-self-start" onClick={voidHandler(async () => {
          try { await openTerminationDocument(document); setDownloadError(false); }
          catch { setDownloadError(true); }
        })}>{t('termination.saved_document')}: {document.fileName}</Button>}
        {downloadError && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('termination.file_open_error')}</AlertDescription></AlertContent></Alert>}
    </div>
  </FormSection></section>;
}
