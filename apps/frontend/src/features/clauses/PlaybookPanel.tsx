import React, { useId, useState } from 'react';
import { ClipboardCheck, ClipboardCopy, FilePlus2, Sparkles, TextCursorInput } from 'lucide-react';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { SEVERITIES } from '@legalio/shared/playbook';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { errorMessage } from '../../api/client';
import { clausesApi, type PlaybookFinding, type PlaybookResult } from '../../api/clauses';
import { KIND_KEYS, SEVERITY_KEYS, SeverityBadge } from './clauseUi';

interface Props {
  /** The editor document's plain text, read when the check runs (the editor owns the text, nothing is sent until then). */
  getText?: () => string;
  /** A contract record: the check reads the file stored with it (or the text pasted below). */
  contractId?: string;
  /** Lets the person paste or load text (contract record mode). */
  allowPaste?: boolean;
  /** Puts the suggested wording into the document (replaces the quoted sentence, or inserts at the cursor). Without it only Copy is offered. */
  onInsert?: (finding: PlaybookFinding) => void;
}

/** Playbook check: findings with severity, the sentence they are about and the library's wording to use instead. Advisory; nothing is changed until the person inserts it. */
const PlaybookPanel: React.FC<Props> = ({ getText, contractId, allowPaste, onInsert }) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const aiOn = useTenantSettings().policy.settings.modules.aiAssistant;
  const uid = useId();
  const [useAi, setUseAi] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaybookResult | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = allowPaste && pasted.trim() ? pasted : getText?.() ?? '';
      const body = text.trim() ? { text, ai: useAi } : contractId ? { contract_id: contractId, ai: useAi } : { text, ai: useAi };
      if (!('contract_id' in body) && !text.trim()) { setError(t('playbook.no_text', 'There is no text to check yet.')); return; }
      setResult(await clausesApi.check(body));
    } catch (err) {
      setError(errorMessage(err, t('playbook.failed', 'The playbook check failed.')));
    } finally { setBusy(false); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showAlert({ title: t('playbook.copied', 'Wording copied'), variant: 'success' }); } catch { showAlert({ title: t('playbook.copy_failed', 'Could not copy'), variant: 'destructive' }); }
  };
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError(t('playbook.file_too_large', 'Choose a text file under 2 MB, or paste the text.')); return; }
    setPasted((await file.text()).slice(0, 500_000));
  };

  return (
    <div className="flex min-w-0 flex-col gap-g13" data-testid="playbook-panel">
      <Text size="sm" tone="muted">{t('playbook.intro', 'Compares the document with your clause library: required clauses, unacceptable wording and figures such as payment terms or liability caps. Suggestions come from your library; nothing changes until you insert it.')}</Text>
      {allowPaste && (
        <Field>
          <FieldLabel htmlFor={`${uid}-text`}>{contractId ? t('playbook.paste_or_stored', 'Contract text (leave empty to use the stored file)') : t('playbook.paste', 'Contract text')}</FieldLabel>
          <Textarea id={`${uid}-text`} rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <input type="file" accept=".txt,text/plain" aria-label={t('playbook.load_file', 'Load a text file')} className="mt-g5 text-xs" onChange={(e) => void loadFile(e.target.files?.[0])} />
        </Field>
      )}
      {aiOn && (
        <Checkbox checked={useAi} onCheckedChange={(details) => setUseAi(details.checked === true)}>
          <CheckboxControl /><CheckboxLabel>{t('playbook.use_ai', 'Also run the AI semantic check (uses your AI budget)')}</CheckboxLabel><CheckboxHiddenInput />
        </Checkbox>
      )}
      <Button type="button" onClick={() => void run()} loading={busy} disabled={busy} data-testid="playbook-run"><ClipboardCheck aria-hidden />{result ? t('playbook.rerun', 'Check again') : t('playbook.run', 'Check against playbook')}</Button>
      {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}

      {result && (
        <div className="flex flex-col gap-g13" aria-live="polite" data-testid="playbook-result">
          <div className="flex flex-wrap items-center gap-g5">
            <Text size="sm" weight="semibold">{result.summary.total === 0
              ? t('playbook.clean', 'No findings against {n} clause(s).', { n: result.summary.clausesChecked })
              : t('playbook.found', '{n} finding(s) against {c} clause(s)', { n: result.summary.total, c: result.summary.clausesChecked })}</Text>
            {[...SEVERITIES].reverse().filter((s) => result.summary.bySeverity[s] > 0).map((s) => (
              <Badge key={s} tone={s === 'info' ? 'neutral' : s === 'low' ? 'info' : s === 'medium' ? 'warning' : 'danger'}>{t(...SEVERITY_KEYS[s])}: {result.summary.bySeverity[s]}</Badge>
            ))}
          </div>
          {result.truncated && <Text size="xs" tone="muted">{t('playbook.truncated', 'Only the first 200,000 characters were checked.')}</Text>}
          {result.ai.requested && result.ai.ran && <Text size="xs" tone="muted">{t('playbook.ai_ran', 'AI semantic check included. AI findings are advisory and can be wrong.')}</Text>}
          {result.ai.requested && !result.ai.ran && result.ai.error && <Alert status="warning" role="status"><AlertIndicator /><AlertContent><AlertDescription>{t('playbook.ai_failed', 'The AI check could not run ({reason}). The rule-based results are shown.', { reason: result.ai.error })}</AlertDescription></AlertContent></Alert>}
          <ol className="flex flex-col gap-g8">
            {result.findings.map((f) => (
              <li key={f.id} className="flex min-w-0 flex-col gap-g5 rounded-md border border-border bg-muted/40 p-g13" data-testid="playbook-finding">
                <div className="flex flex-wrap items-center gap-g5">
                  <SeverityBadge t={t} severity={f.severity} />
                  <Text as="span" size="xs" weight="bold">{f.clause_title}</Text>
                  <Text as="span" size="xs" tone="muted">{t(...(KIND_KEYS[f.kind] ?? KIND_KEYS.ai_semantic))}</Text>
                  {f.ai && <Badge tone="special"><Sparkles className="size-g13" aria-hidden />{t('playbook.ai_badge', 'AI')}</Badge>}
                </div>
                <Text size="sm">{f.message}</Text>
                {f.quote && <blockquote className="border-l-2 border-border ps-g8 text-xs italic text-muted-foreground">“{f.quote}”</blockquote>}
                {f.ai && f.quote_verified === false && <Text size="xs" tone="muted">{t('playbook.quote_unverified', 'The quote the AI gave was not found in the document, so it is not shown.')}</Text>}
                {f.suggested_text ? (
                  <div className="flex flex-col gap-g5">
                    <Text size="xs" weight="semibold" className="text-status-success">{f.suggested_kind === 'fallback' ? t('playbook.suggest_fallback', 'Fallback wording') : t('playbook.suggest_approved', 'Approved wording')}</Text>
                    <Text size="xs" className="whitespace-pre-line leading-relaxed">{f.suggested_text}</Text>
                    <div className="flex flex-wrap gap-g5">
                      {onInsert && <Button type="button" size="sm" onClick={() => onInsert(f)} data-testid="playbook-insert">{f.quote ? <TextCursorInput aria-hidden /> : <FilePlus2 aria-hidden />}{f.quote ? t('playbook.replace', 'Replace the sentence') : t('playbook.insert', 'Insert at cursor')}</Button>}
                      <Button type="button" size="sm" variant="outline" onClick={() => void copy(f.suggested_text!)}><ClipboardCopy aria-hidden />{t('playbook.copy', 'Copy wording')}</Button>
                    </div>
                  </div>
                ) : <Text size="xs" tone="muted">{t('playbook.no_wording', 'The library has no wording for this clause yet.')}</Text>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};

export default PlaybookPanel;
