import React, { useId, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, Sparkles, X } from 'lucide-react';
import { PAGE_SIZES } from '@legalio/types/documents';
import { OBLIGATION_RECURRENCES, type ObligationType } from '@legalio/shared/obligations';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { errorMessage } from '../../api/client';
import { suggestionsApi, type Suggestion } from '../../api/suggestions';
import { DateInput } from '../../components/DateInput';
import { TablePagination } from '../../components/ui/TablePagination';
import { ProvenanceQuote } from './ProvenanceQuote';
import { RECURRENCE_KEYS, TYPE_KEYS, TYPE_OPTIONS } from './obligationUi';
import { invalidateObligations } from './obligationQueries';

const STATUSES = ['pending', 'accepted', 'rejected'] as const;

/** One suggestion with editable fields. Accepting sends the (possibly edited) values; the quote, page and confidence stay as the model gave them. */
const SuggestionCard: React.FC<{ suggestion: Suggestion; onDecided: () => void }> = ({ suggestion, onDecided }) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const ids = { title: useId(), due: useId(), type: useId(), repeat: useId(), label: useId(), value: useId(), summary: useId() };
  const p = suggestion.payload;
  const [title, setTitle] = useState(p.title ?? '');
  const [dueDate, setDueDate] = useState(p.due_date ?? '');
  const [type, setType] = useState(p.type ?? 'other');
  const [recurrence, setRecurrence] = useState(p.recurrence ?? 'once');
  const [label, setLabel] = useState(p.label ?? '');
  const [value, setValue] = useState(p.value ?? '');
  const [summary, setSummary] = useState(p.summary ?? '');
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const pending = suggestion.status === 'pending';
  const isObligation = suggestion.kind === 'obligation';
  const decide = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'reject');
    try {
      if (accept) {
        await suggestionsApi.accept(suggestion.id, isObligation
          ? { title, due_date: dueDate || null, type, recurrence: recurrence !== 'once' && !dueDate ? 'once' : recurrence, description: p.description, recurrence_interval: recurrence === 'every_n_days' ? p.recurrence_interval ?? undefined : undefined }
          : { label, value, summary });
        showAlert({ title: isObligation ? t('suggestions.accepted_obligation', 'Obligation created') : t('suggestions.accepted_term', 'Key term saved'), variant: 'success' });
      } else {
        await suggestionsApi.reject(suggestion.id);
        showAlert({ title: t('suggestions.rejected', 'Suggestion rejected'), variant: 'success' });
      }
      onDecided();
    } catch (err) {
      showAlert({ title: t('obligations.error.action', 'The action failed'), description: errorMessage(err, ''), variant: 'destructive' });
      onDecided();
    } finally { setBusy(null); }
  };
  return (
    <Card asChild><article className="space-y-g13 p-g21" data-testid="suggestion-card" aria-label={isObligation ? p.title : p.label}>
      <header className="flex flex-wrap items-center justify-between gap-g8">
        <div className="flex flex-wrap items-center gap-g8">
          <Badge tone={isObligation ? 'info' : 'special'}>{isObligation ? t('suggestions.kind.obligation', 'Obligation / key date') : t('suggestions.kind.key_term', 'Key clause')}</Badge>
          {suggestion.contract_number && <Text as="span" size="xs" tone="muted">{suggestion.contract_number} · {suggestion.contract_title}</Text>}
        </div>
        {!pending && <Badge tone={suggestion.status === 'accepted' ? 'success' : 'neutral'}>{t(`suggestions.status.${suggestion.status}`, suggestion.status)}</Badge>}
      </header>
      <fieldset disabled={!pending || busy !== null} className="m-0 grid min-w-0 gap-g13 border-0 p-0 sm:grid-cols-2">
        {isObligation ? (
          <>
            <Field className="sm:col-span-2"><FieldLabel htmlFor={ids.title}>{t('obligations.field.title', 'Title')}</FieldLabel><Input id={ids.title} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor={ids.type}>{t('obligations.field.type', 'Type')}</FieldLabel>
              <NativeSelect id={ids.type} value={type} onChange={(e) => setType(e.target.value as ObligationType)}>{TYPE_OPTIONS.map((v) => <option key={v} value={v}>{t(...TYPE_KEYS[v])}</option>)}</NativeSelect></Field>
            <Field><FieldLabel htmlFor={ids.due}>{t('obligations.field.due', 'Due date')}</FieldLabel><DateInput id={ids.due} value={dueDate} onChange={setDueDate} /></Field>
            <Field><FieldLabel htmlFor={ids.repeat}>{t('obligations.field.repeats', 'Repeats')}</FieldLabel>
              <NativeSelect id={ids.repeat} value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>{OBLIGATION_RECURRENCES.map((v) => <option key={v} value={v}>{t(...RECURRENCE_KEYS[v])}</option>)}</NativeSelect></Field>
            {p.description && <Text size="sm" className="sm:col-span-2" tone="muted">{p.description}</Text>}
          </>
        ) : (
          <>
            <Field><FieldLabel htmlFor={ids.label}>{t('suggestions.field.label', 'Clause')}</FieldLabel><Input id={ids.label} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor={ids.value}>{t('suggestions.field.value', 'Value')}</FieldLabel><Input id={ids.value} value={value} maxLength={300} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field className="sm:col-span-2"><FieldLabel htmlFor={ids.summary}>{t('suggestions.field.summary', 'Summary')}</FieldLabel><Textarea id={ids.summary} rows={2} maxLength={400} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
          </>
        )}
      </fieldset>
      <ProvenanceQuote quote={suggestion.source_quote} page={suggestion.source_page} confidence={suggestion.confidence} verified={suggestion.quote_verified} />
      {pending && (
        <div className="flex flex-wrap justify-end gap-g8">
          <Button type="button" variant="outline" disabled={busy !== null} loading={busy === 'reject'} onClick={() => void decide(false)}><X aria-hidden />{t('suggestions.reject', 'Reject')}</Button>
          <Button type="button" disabled={busy !== null || (isObligation ? !title.trim() : !value.trim())} loading={busy === 'accept'} onClick={() => void decide(true)}><Check aria-hidden />{isObligation ? t('suggestions.accept_obligation', 'Accept and create obligation') : t('suggestions.accept_term', 'Accept and save')}</Button>
        </div>
      )}
    </article></Card>
  );
};

/** The review queue: pending AI suggestions to accept (with edits) or reject, and the history of decided ones. */
export const ReviewQueue: React.FC<{ onExtract?: () => void }> = ({ onExtract }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(PAGE_SIZES[0] as number);
  const query = useQuery({
    queryKey: ['obligations', activeTenantId, 'suggestions', status, page, rows],
    queryFn: ({ signal }) => suggestionsApi.page({ status, limit: rows, offset: (page - 1) * rows }, { signal, organizationId: activeTenantId }),
    enabled: Boolean(activeTenantId), placeholderData: keepPreviousData,
  });
  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const statusId = useId();
  return (
    <section className="space-y-g13" aria-label={t('suggestions.title', 'AI review queue')} aria-busy={query.isFetching}>
      <Card className="flex flex-row flex-wrap items-center justify-between gap-g13 p-g13">
        <div className="flex items-center gap-g8">
          <ShieldCheck className="size-g16 text-status-success" aria-hidden />
          <Text size="sm">{t('suggestions.intro', 'AI suggestions are advisory. Check the quote, edit what is wrong, then accept: only accepted suggestions become records.')}</Text>
        </div>
        <div className="flex flex-wrap items-center gap-g8">
          <label htmlFor={statusId} className="sr-only">{t('obligations.filter.status', 'Status')}</label>
          <NativeSelect id={statusId} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`suggestions.status.${s}`, s)}</option>)}
          </NativeSelect>
          {onExtract && <Button type="button" onClick={onExtract}><Sparkles aria-hidden />{t('suggestions.extract.title', 'Extract obligations with AI')}</Button>}
        </div>
      </Card>
      {query.isLoading && <div role="status" className="space-y-g8"><span className="sr-only">{t('common.loading', 'Loading…')}</span><Skeleton className="h-g144 w-full" /><Skeleton className="h-g144 w-full" /></div>}
      {query.isError && <Card role="alert" className="p-g21 text-center"><Text size="sm" tone="destructive">{t('suggestions.load_failed', 'Could not load the review queue.')}</Text></Card>}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <Card className="p-g34 text-center"><Text size="sm" tone="muted">{status === 'pending' ? t('suggestions.empty_pending', 'Nothing is waiting for review.') : t('suggestions.empty', 'No suggestions here.')}</Text></Card>
      )}
      <div className="space-y-g13">
        {items.map((s) => <SuggestionCard key={s.id} suggestion={s} onDecided={() => void invalidateObligations(queryClient).then(() => queryClient.invalidateQueries({ queryKey: ['lists', 'obligations'] }))} />)}
      </div>
      {total > rows && (
        <Card className="overflow-hidden"><TablePagination currentPage={page} totalPages={Math.max(1, Math.ceil(total / rows))} rowsPerPage={rows} rowsPerPageOptions={[...PAGE_SIZES]}
          onPageChange={setPage} onRowsPerPageChange={(size) => { setRows(size); setPage(1); }} /></Card>
      )}
    </section>
  );
};
