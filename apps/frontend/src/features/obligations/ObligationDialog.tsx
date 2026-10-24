import React, { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { OBLIGATION_RECURRENCES, type ObligationRecurrence, type ObligationStoredStatus, type ObligationType } from '@legalio/shared/obligations';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useDepartments } from '../../hooks/useDepartments';
import { errorMessage, isApiError } from '../../api/client';
import { obligationsApi, type Obligation, type ObligationInput } from '../../api/obligations';
import { DateInput } from '../../components/DateInput';
import { ModalFrame } from '../../components/ui/modal-frame';
import { DialogHeader } from '../../components/settings/dialogParts';
import { RECURRENCE_KEYS, TYPE_KEYS, TYPE_OPTIONS } from './obligationUi';

export interface LinkChoice { id: string; label: string }
interface Props {
  /** The obligation being edited; null creates a new one. */
  obligation: Obligation | null;
  /** Values a new obligation starts with (the contract tab fixes `contract_id`). */
  initial?: ObligationInput;
  contracts?: LinkChoice[];
  /** The contract is fixed (opened from a contract); the picker is hidden. */
  lockContract?: boolean;
  /** Viewers see the obligation but cannot change it. */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (obligation: Obligation) => void;
}

/** Create or edit an obligation. Everything the server enforces (links inside the organization, recurrence rules, versions) is shown as its message. */
export const ObligationDialog: React.FC<Props> = ({ obligation, initial, contracts = [], lockContract, readOnly, onClose, onSaved }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { departments } = useDepartments();
  const ids = { title: useId(), description: useId(), type: useId(), due: useId(), recurrence: useId(), interval: useId(), until: useId(), contract: useId(), user: useId(), dept: useId(), lead: useId(), status: useId() };
  const [title, setTitle] = useState(obligation?.title ?? initial?.title ?? '');
  const [description, setDescription] = useState(obligation?.description ?? initial?.description ?? '');
  const [type, setType] = useState<ObligationType>(obligation?.type ?? initial?.type ?? 'other');
  const [dueDate, setDueDate] = useState(obligation?.due_date ?? initial?.due_date ?? '');
  const [recurrence, setRecurrence] = useState<ObligationRecurrence>(obligation?.recurrence ?? 'once');
  const [interval, setInterval] = useState(String(obligation?.recurrence_interval ?? 30));
  const [until, setUntil] = useState(obligation?.recurrence_until ?? '');
  const [contractId, setContractId] = useState(obligation?.contract_id ?? initial?.contract_id ?? '');
  const [userId, setUserId] = useState(obligation?.responsible_user_id ?? initial?.responsible_user_id ?? '');
  const [department, setDepartment] = useState(obligation?.responsible_department ?? initial?.responsible_department ?? '');
  const [leadDays, setLeadDays] = useState(obligation?.lead_days == null ? '' : String(obligation.lead_days));
  const [status, setStatus] = useState<ObligationStoredStatus>(obligation?.stored_status ?? 'open');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assignees = useQuery({ queryKey: ['obligation-assignees', activeTenantId], queryFn: () => obligationsApi.assignees(), staleTime: 60_000 });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError(t('obligations.error.title', 'Enter a title.')); return; }
    if (recurrence !== 'once' && !dueDate) { setError(t('obligations.error.recurring_date', 'A recurring obligation needs a due date.')); return; }
    setBusy(true);
    setError(null);
    const body: ObligationInput = {
      title: title.trim(), description, type, due_date: dueDate || null, recurrence,
      recurrence_interval: recurrence === 'every_n_days' ? Number(interval) || null : null, recurrence_until: recurrence !== 'once' && until ? until : null,
      contract_id: contractId || null, responsible_user_id: userId || null, responsible_department: department, lead_days: leadDays === '' ? null : Number(leadDays),
    };
    try {
      if (obligation) {
        const result = await obligationsApi.update(obligation.id, { ...body, status, version: obligation.version });
        onSaved(result.obligation);
      } else {
        const result = await obligationsApi.create({ ...initial, ...body, status });
        onSaved(result.obligation);
      }
    } catch (err) {
      setError(isApiError(err) && err.code === 'VERSION_CONFLICT'
        ? t('obligations.error.conflict', 'Someone else changed this obligation. Close the form and open it again to see their changes.')
        : errorMessage(err, t('obligations.error.save', 'The obligation could not be saved.')));
    } finally { setBusy(false); }
  };

  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={readOnly ? t('obligations.view', 'Obligation') : obligation ? t('obligations.edit', 'Edit obligation') : t('obligations.add', 'Add obligation')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="overflow-y-auto p-g21">
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-g13 border-0 p-0">
        {obligation?.source === 'ai_extracted' && (
          <Alert status="info" role="note"><AlertIndicator /><AlertContent><AlertDescription>
            <span className="flex items-center gap-g5 font-semibold"><Sparkles className="size-g13" aria-hidden />{t('obligations.ai_source', 'Extracted by AI and confirmed by a person')}</span>
            {obligation.source_quote && <blockquote className="mt-g5 border-l-2 border-border pl-g8 italic">“{obligation.source_quote}”</blockquote>}
            <span className="mt-g5 block text-xs">
              {obligation.source_page ? t('obligations.source_page', 'Page {page}', { page: obligation.source_page }) : ''}
              {obligation.source_confidence != null ? ` · ${t('obligations.confidence', 'Confidence {pct}%', { pct: Math.round(obligation.source_confidence * 100) })}` : ''}
            </span>
          </AlertDescription></AlertContent></Alert>
        )}
        <Field>
          <FieldLabel htmlFor={ids.title}>{t('obligations.field.title', 'Title')}</FieldLabel>
          <Input id={ids.title} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.type}>{t('obligations.field.type', 'Type')}</FieldLabel>
            <NativeSelect id={ids.type} value={type} onChange={(e) => setType(e.target.value as ObligationType)}>
              {TYPE_OPTIONS.map((value) => <option key={value} value={value}>{t(...TYPE_KEYS[value])}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.due}>{t('obligations.field.due', 'Due date')}</FieldLabel>
            <DateInput id={ids.due} value={dueDate} onChange={setDueDate} />
          </Field>
        </div>
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.recurrence}>{t('obligations.field.repeats', 'Repeats')}</FieldLabel>
            <NativeSelect id={ids.recurrence} value={recurrence} onChange={(e) => setRecurrence(e.target.value as ObligationRecurrence)}>
              {OBLIGATION_RECURRENCES.map((value) => <option key={value} value={value}>{t(...RECURRENCE_KEYS[value])}</option>)}
            </NativeSelect>
          </Field>
          {recurrence === 'every_n_days' && (
            <Field>
              <FieldLabel htmlFor={ids.interval}>{t('obligations.field.interval', 'Every how many days')}</FieldLabel>
              <Input id={ids.interval} type="number" min={1} max={3650} value={interval} onChange={(e) => setInterval(e.target.value)} />
            </Field>
          )}
          {recurrence !== 'once' && (
            <Field>
              <FieldLabel htmlFor={ids.until}>{t('obligations.field.until', 'Repeat until (optional)')}</FieldLabel>
              <DateInput id={ids.until} value={until} onChange={setUntil} />
            </Field>
          )}
        </div>
        {!lockContract && (
          <Field>
            <FieldLabel htmlFor={ids.contract}>{t('obligations.field.contract', 'Contract (optional)')}</FieldLabel>
            <NativeSelect id={ids.contract} value={contractId} onChange={(e) => setContractId(e.target.value)}>
              <option value="">{t('obligations.no_contract', 'Not linked to a contract')}</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </Field>
        )}
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.user}>{t('obligations.field.responsible', 'Responsible person')}</FieldLabel>
            <NativeSelect id={ids.user} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t('obligations.unassigned', 'Nobody assigned')}</option>
              {(assignees.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.dept}>{t('obligations.field.department', 'Department')}</FieldLabel>
            <NativeSelect id={ids.dept} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">{t('obligations.no_department', 'No department')}</option>
              {departments.map((name) => <option key={name} value={name}>{name}</option>)}
              {department && !departments.includes(department) && <option value={department}>{department}</option>}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.lead}>{t('obligations.field.lead', 'Remind this many days before')}</FieldLabel>
            <Input id={ids.lead} type="number" min={0} max={365} value={leadDays} placeholder={t('obligations.lead_default', 'Organization default')} onChange={(e) => setLeadDays(e.target.value)} />
            <FieldHelperText>{t('obligations.lead_hint', 'Leave empty to use the organization default.')}</FieldHelperText>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.status}>{t('obligations.field.status', 'Status')}</FieldLabel>
            <NativeSelect id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as ObligationStoredStatus)}>
              {(['open', 'in_progress', 'done', 'waived'] as const).map((value) => <option key={value} value={value}>{t(`obligations.status.${value}`, value)}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={ids.description}>{t('obligations.field.description', 'Description')}</FieldLabel>
          <Textarea id={ids.description} rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {obligation && obligation.completions > 0 && <Text size="xs" tone="muted"><Badge tone="success">{obligation.completions}</Badge> {t('obligations.completions', 'occurrence(s) completed so far')}</Text>}
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        </fieldset>
        <div className="mt-g13 flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{readOnly ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}</Button>
          {!readOnly && <Button type="submit" disabled={busy}>{busy ? t('obligations.saving', 'Saving…') : t('common.save', 'Save')}</Button>}
        </div>
      </form>
    </ModalFrame>
  );
};
