import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { errorMessage } from '../../api/client';
import { clausesApi } from '../../api/clauses';
import { ModalFrame } from '../../components/ui/modal-frame';
import { DialogHeader } from '../../components/settings/dialogParts';
import { RiskBadge } from './clauseUi';

/** Opt-in import of the starter clauses (baseline plus the organization's industry pack). Clauses the organization already has are never touched. */
export const StarterImportDialog: React.FC<{ onClose: () => void; onImported: (created: number, skipped: number) => void }> = ({ onClose, onImported }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const starters = useQuery({ queryKey: ['clauses', activeTenantId, 'starter'], queryFn: () => clausesApi.starter(), staleTime: 0 });
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = (starters.data ?? []).filter((s) => !s.imported);
  const chosen = available.filter((s) => !unchecked.has(s.starter_key));

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await clausesApi.importStarter(chosen.map((s) => s.starter_key));
      onImported(result.created, result.skipped);
    } catch (err) {
      setError(errorMessage(err, t('clauses.starter.failed', 'The starter clauses could not be imported.')));
    } finally { setBusy(false); }
  };

  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={t('clauses.starter.title', 'Import starter clauses')} onClose={onClose} />
      <div className="flex min-h-0 flex-col gap-g13 overflow-y-auto p-g21">
        <Text size="sm" tone="muted">{t('clauses.starter.intro', 'Adds common clauses with approved wording, fallbacks and playbook rules, plus the clauses of your industry pack. Nothing you already have is changed or replaced; edit the wording to fit your organization afterwards.')}</Text>
        {starters.isLoading && <div role="status"><span className="sr-only">{t('common.loading', 'Loading…')}</span><Skeleton className="h-g89 w-full" /></div>}
        {starters.error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{errorMessage(starters.error, t('clauses.starter.load_failed', 'Could not load the starter clauses.'))}</AlertDescription></AlertContent></Alert>}
        {starters.data && available.length === 0 && <Text size="sm">{t('clauses.starter.all_imported', 'All starter clauses are already in your library.')}</Text>}
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label={t('clauses.starter.list', 'Starter clauses')}>
          {(starters.data ?? []).map((s) => (
            <li key={s.starter_key} className="flex items-start gap-g8 p-g8">
              {s.imported ? <span className="w-g21" /> : (
                <Checkbox checked={!unchecked.has(s.starter_key)} onCheckedChange={(details) => setUnchecked((set) => { const next = new Set(set); if (details.checked === true) next.delete(s.starter_key); else next.add(s.starter_key); return next; })}>
                  <CheckboxControl /><CheckboxLabel className="sr-only">{s.title}</CheckboxLabel><CheckboxHiddenInput />
                </Checkbox>
              )}
              <div className="min-w-0 flex-1">
                <Text size="sm" weight="semibold">{s.title}</Text>
                <Text size="xs" tone="muted">{s.guidance}</Text>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-g3">
                {s.imported ? <Badge tone="success">{t('clauses.starter.imported', 'In library')}</Badge> : <RiskBadge t={t} risk={s.risk_level} />}
                <Text size="xs" tone="muted">{s.source === 'industry' ? t('clauses.starter.source_industry', 'Industry pack') : t('clauses.starter.source_baseline', 'Baseline')}{s.has_wording ? '' : ` · ${t('clauses.starter.no_wording', 'no wording yet')}`}</Text>
              </div>
            </li>
          ))}
        </ul>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void run()} data-testid="starter-import">{t('clauses.starter.import', 'Import {n} clause(s)', { n: chosen.length })}</Button>
        </div>
      </div>
    </ModalFrame>
  );
};
