import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, CheckCircle2, ListChecks, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions } from '../../lib/permissions';
import { errorMessage } from '../../api/client';
import { obligationsApi, type Obligation } from '../../api/obligations';
import { suggestionsApi } from '../../api/suggestions';
import { useNavigation } from '../../context/NavigationContext';
import { ExtractDialog } from './ExtractDialog';
import { ProvenanceQuote } from './ProvenanceQuote';
import { ObligationDialog } from './ObligationDialog';
import { DueCell, StatusBadge, recurrenceLabel, typeLabel } from './obligationUi';
import { invalidateObligations, obligationsViewRequest } from './obligationQueries';

/** The "Obligations" tab of a contract record: its deadlines and duties, with quick add and mark-done. */
export const ContractObligations: React.FC<{ contractId: string }> = ({ contractId }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('document.edit');
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ obligation: Obligation | null } | null>(null);
  const [extractOpen, setExtractOpen] = useState(false);
  const { setActiveTab } = useNavigation();
  const keyTerms = useQuery({ queryKey: ['obligations', activeTenantId, 'key-terms', contractId], queryFn: ({ signal }) => suggestionsApi.keyTerms(contractId, { signal }), enabled: Boolean(activeTenantId) });
  const query = useQuery({
    queryKey: ['obligations', activeTenantId, 'contract', contractId],
    queryFn: ({ signal }) => obligationsApi.page({ contractId, limit: 100, sort: 'due_date' }, { signal, organizationId: activeTenantId }),
    enabled: Boolean(activeTenantId),
  });
  const items = query.data?.items ?? [];
  const complete = async (o: Obligation) => {
    try { await obligationsApi.complete(o.id, o.version); await invalidateObligations(queryClient); } catch (err) {
      showAlert({ title: t('obligations.error.action', 'The action failed'), description: errorMessage(err, ''), variant: 'destructive' });
    }
  };
  return (
    <div className="space-y-g13" data-testid="contract-obligations">
      <div className="flex flex-wrap items-center justify-between gap-g8">
        <Heading as="h3" size="xs" weight="bold" className="flex items-center gap-g5 uppercase tracking-wider text-muted-foreground"><ListChecks className="size-g16" aria-hidden />{t('obligations.contract_tab', 'Obligations')}</Heading>
        {canEdit && (
          <div className="flex flex-wrap gap-g8">
            <Button type="button" size="sm" variant="outline" onClick={() => setExtractOpen(true)}><Sparkles aria-hidden />{t('suggestions.extract.title', 'Extract obligations with AI')}</Button>
            <Button type="button" size="sm" onClick={() => setDialog({ obligation: null })}><Plus aria-hidden />{t('obligations.add', 'Add obligation')}</Button>
          </div>
        )}
      </div>
      {query.isLoading && <div role="status"><span className="sr-only">{t('common.loading', 'Loading…')}</span><Skeleton className="h-g42 w-full" /></div>}
      {query.isError && <Card role="alert" className="p-g13 text-center"><Text size="sm" tone="destructive">{t('obligations.load_failed', 'Could not load obligations.')}</Text></Card>}
      {!query.isLoading && !query.isError && items.length === 0 && <Card className="p-g13 text-center"><Text size="sm" tone="muted">{t('obligations.contract_empty', 'No obligations recorded for this contract yet.')}</Text></Card>}
      <ul className="space-y-g8">
        {items.map((o) => (
          <li key={o.id}>
            <Card className="flex flex-row flex-wrap items-center justify-between gap-g13 p-g13">
              <div className="min-w-0 flex-1">
                <Text size="sm" weight="semibold" className="truncate">{o.title}</Text>
                <div className="mt-g3 flex flex-wrap items-center gap-g8">
                  <Badge tone="neutral">{typeLabel(t, o.type)}</Badge>
                  <StatusBadge t={t} status={o.status} />
                  {o.recurrence !== 'once' && <Text as="span" size="xs" tone="muted">{recurrenceLabel(t, o)}</Text>}
                  {o.responsible_name && <Text as="span" size="xs" tone="muted">{o.responsible_name}</Text>}
                </div>
              </div>
              <DueCell t={t} o={o} />
              <div className="flex items-center gap-g5">
                {canEdit && (o.stored_status === 'open' || o.stored_status === 'in_progress') && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void complete(o)} aria-label={`${t('obligations.mark_done', 'Mark done')}: ${o.title}`}><CheckCircle2 aria-hidden />{t('obligations.mark_done', 'Mark done')}</Button>
                )}
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDialog({ obligation: o })} aria-label={`${canEdit ? t('obligations.edit', 'Edit obligation') : t('obligations.view', 'Obligation')}: ${o.title}`}><Pencil aria-hidden /></Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <div className="space-y-g8 pt-g13">
        <Heading as="h3" size="xs" weight="bold" className="flex items-center gap-g5 uppercase tracking-wider text-muted-foreground"><BookMarked className="size-g16" aria-hidden />{t('suggestions.key_terms', 'Key clauses')}</Heading>
        {(keyTerms.data ?? []).length === 0 && <Card className="p-g13 text-center"><Text size="sm" tone="muted">{t('suggestions.key_terms_empty', 'No key clauses have been confirmed for this contract yet.')}</Text></Card>}
        <ul className="space-y-g8">
          {(keyTerms.data ?? []).map((term) => (
            <li key={term.id}><Card className="space-y-g8 p-g13">
              <div className="flex flex-wrap items-start justify-between gap-g8">
                <div className="min-w-0"><Text size="sm" weight="semibold">{term.label}: {term.value}</Text>{term.summary && <Text size="xs" tone="muted">{term.summary}</Text>}</div>
                {canEdit && <Button type="button" variant="ghost" size="icon-sm" aria-label={`${t('documents.action.delete', 'Delete')}: ${term.label}`}
                  onClick={() => void suggestionsApi.removeKeyTerm(contractId, term.term_key).then(() => queryClient.invalidateQueries({ queryKey: ['obligations'] }))}><Trash2 aria-hidden /></Button>}
              </div>
              <ProvenanceQuote quote={term.source_quote} page={term.source_page} confidence={term.source_confidence} verified={null} />
            </Card></li>
          ))}
        </ul>
      </div>
      {extractOpen && <ExtractDialog contractId={contractId} onClose={() => setExtractOpen(false)}
        onDone={(result) => {
          setExtractOpen(false);
          showAlert({ title: t('suggestions.extract.done', '{n} suggestion(s) queued for review', { n: result.created }), variant: 'success' });
          void invalidateObligations(queryClient);
          if (result.created > 0) { obligationsViewRequest.view = 'review'; setActiveTab('obligations'); }
        }} />}
      {dialog && <ObligationDialog obligation={dialog.obligation} initial={{ contract_id: contractId }} lockContract readOnly={!canEdit} onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); showAlert({ title: t('obligations.saved', 'Obligation saved'), variant: 'success' }); void invalidateObligations(queryClient); }} />}
    </div>
  );
};
export default ContractObligations;
