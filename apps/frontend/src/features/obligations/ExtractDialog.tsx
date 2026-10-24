import React, { useId, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Textarea } from '@legalio/ui-components/textarea';
import { useLanguage } from '../../context/LanguageContext';
import { errorMessage } from '../../api/client';
import { suggestionsApi, type ExtractionResult } from '../../api/suggestions';
import { ModalFrame } from '../../components/ui/modal-frame';
import { DialogHeader } from '../../components/settings/dialogParts';
import type { LinkChoice } from './ObligationDialog';

/** Starts an AI extraction for a contract. The result is only a list of suggestions to review: nothing is saved as an obligation. */
export const ExtractDialog: React.FC<{ contractId?: string; contracts?: LinkChoice[]; onClose: () => void; onDone: (result: ExtractionResult) => void }> = ({ contractId, contracts = [], onClose, onDone }) => {
  const { t } = useLanguage();
  const ids = { contract: useId(), file: useId(), text: useId() };
  const [contract, setContract] = useState(contractId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contract) { setError(t('suggestions.extract.pick_contract', 'Choose the contract the document belongs to.')); return; }
    setBusy(true);
    setError(null);
    try { onDone(await suggestionsApi.extract(contract, { file, text })); } catch (err) {
      setError(errorMessage(err, t('suggestions.extract.failed', 'The document could not be analysed.')));
    } finally { setBusy(false); }
  };
  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={t('suggestions.extract.title', 'Extract obligations with AI')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        <Alert status="info" role="note"><AlertIndicator /><AlertContent><AlertDescription>{t('suggestions.extract.notice', 'The AI proposes obligations, key dates and key clauses with the passages they come from. Nothing is saved until you accept each suggestion in the review queue. AI can be wrong: check every quote.')}</AlertDescription></AlertContent></Alert>
        {!contractId && (
          <Field>
            <FieldLabel htmlFor={ids.contract}>{t('suggestions.extract.contract', 'Contract')}</FieldLabel>
            <NativeSelect id={ids.contract} value={contract} onChange={(e) => setContract(e.target.value)}>
              <option value="">{t('suggestions.extract.choose', 'Choose a contract…')}</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={ids.file}>{t('suggestions.extract.file', 'Document (PDF or text file)')}</FieldLabel>
          <Input id={ids.file} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <FieldHelperText>{t('suggestions.extract.file_hint', 'Leave empty to use the file stored with the contract.')}</FieldHelperText>
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.text}>{t('suggestions.extract.text', 'Or paste the contract text')}</FieldLabel>
          <Textarea id={ids.text} rows={4} value={text} onChange={(e) => setText(e.target.value)} disabled={Boolean(file)} />
        </Field>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy} loading={busy}><Sparkles aria-hidden />{busy ? t('suggestions.extract.running', 'Analysing…') : t('suggestions.extract.run', 'Analyse document')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};
