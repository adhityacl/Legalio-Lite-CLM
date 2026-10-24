import React, { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Button } from '@legalio/ui-components/button';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import type { NumericRule, Severity } from '@legalio/shared/playbook';
import { useLanguage } from '../../context/LanguageContext';
import { errorMessage, isApiError } from '../../api/client';
import { clausesApi, type Clause, type ClauseInput } from '../../api/clauses';
import { ModalFrame } from '../../components/ui/modal-frame';
import { DialogHeader } from '../../components/settings/dialogParts';
import { LANGUAGE_KEYS, METRIC_KEYS, NUMERIC_METRICS, RISK_KEYS, RISK_LEVELS, SEVERITIES, SEVERITY_KEYS } from './clauseUi';

interface Props {
  /** The clause being edited; null creates a new one. */
  clause: Clause | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (clause: Clause) => void;
}

const lines = (value: string) => value.split('\n').map((l) => l.trim()).filter(Boolean);
const numberOrNull = (value: string) => (value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/** Create or edit a clause: wording, fallbacks and the rules the playbook check uses. The server validates the rules and answers with its reason. */
export const ClauseDialog: React.FC<Props> = ({ clause, readOnly, onClose, onSaved }) => {
  const { t } = useLanguage();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [title, setTitle] = useState(clause?.title ?? '');
  const [category, setCategory] = useState(clause?.category ?? '');
  const [risk, setRisk] = useState(clause?.risk_level ?? 'medium');
  const [language, setLanguage] = useState<string>(clause?.language ?? '');
  const [jurisdiction, setJurisdiction] = useState(clause?.jurisdiction ?? '');
  const [tags, setTags] = useState((clause?.tags ?? []).join(', '));
  const [guidance, setGuidance] = useState(clause?.guidance ?? '');
  const [approved, setApproved] = useState(clause?.approved_text ?? '');
  const [fallbacks, setFallbacks] = useState<string[]>(clause?.fallback_texts ?? []);
  const [status, setStatus] = useState(clause?.status ?? 'active');
  const [required, setRequired] = useState(clause?.rules.required ?? false);
  const [presentAny, setPresentAny] = useState((clause?.rules.present_any ?? []).join('\n'));
  const [forbidden, setForbidden] = useState((clause?.rules.forbidden ?? []).join('\n'));
  const [severity, setSeverity] = useState<string>(clause?.rules.severity ?? '');
  const [numeric, setNumeric] = useState<Array<NumericRule & { minText: string; maxText: string }>>(
    (clause?.rules.numeric ?? []).map((n) => ({ ...n, minText: n.min == null ? '' : String(n.min), maxText: n.max == null ? '' : String(n.max) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError(t('clauses.error.title', 'Enter a title.')); return; }
    setBusy(true);
    setError(null);
    const body: ClauseInput = {
      title: title.trim(), category: category.trim(), risk_level: risk, language: language as ClauseInput['language'], jurisdiction: jurisdiction.trim(),
      tags: tags.split(',').map((x) => x.trim()).filter(Boolean), guidance, approved_text: approved, fallback_texts: fallbacks.map((f) => f.trim()).filter(Boolean), status,
      rules: {
        required, present_any: lines(presentAny), forbidden: lines(forbidden), severity: (severity || null) as Severity | null,
        numeric: numeric.map(({ minText, maxText, ...rule }) => ({ ...rule, min: numberOrNull(minText), max: numberOrNull(maxText) })),
      },
    };
    try {
      const result = clause ? await clausesApi.update(clause.id, { ...body, version: clause.version }) : await clausesApi.create(body);
      onSaved(result.clause);
    } catch (err) {
      setError(isApiError(err) && err.code === 'VERSION_CONFLICT'
        ? t('clauses.error.conflict', 'Someone else changed this clause. Close the form and open it again to see their changes.')
        : errorMessage(err, t('clauses.error.save', 'The clause could not be saved.')));
    } finally { setBusy(false); }
  };

  const updateNumeric = (index: number, change: Partial<NumericRule & { minText: string; maxText: string }>) => setNumeric((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <ModalFrame size="lg" onClose={onClose}>
      <DialogHeader title={readOnly ? t('clauses.view', 'Clause') : clause ? t('clauses.edit', 'Edit clause') : t('clauses.add', 'Add clause')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="overflow-y-auto p-g21">
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-g13 border-0 p-0">
          <Field>
            <FieldLabel htmlFor={id('title')}>{t('clauses.field.title', 'Title')}</FieldLabel>
            <Input id={id('title')} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid gap-g13 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor={id('category')}>{t('clauses.field.category', 'Category')}</FieldLabel>
              <Input id={id('category')} value={category} maxLength={120} onChange={(e) => setCategory(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={id('risk')}>{t('clauses.field.risk', 'Risk level')}</FieldLabel>
              <NativeSelect id={id('risk')} value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                {RISK_LEVELS.map((value) => <option key={value} value={value}>{t(...RISK_KEYS[value])}</option>)}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={id('status')}>{t('clauses.field.status', 'Status')}</FieldLabel>
              <NativeSelect id={id('status')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="active">{t('clauses.status.active', 'Active')}</option>
                <option value="archived">{t('clauses.status.archived', 'Archived')}</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-g13 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor={id('language')}>{t('clauses.field.language', 'Language')}</FieldLabel>
              <NativeSelect id={id('language')} value={language} onChange={(e) => setLanguage(e.target.value)}>
                {Object.entries(LANGUAGE_KEYS).map(([value, key]) => <option key={value} value={value}>{t(...key)}</option>)}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={id('jurisdiction')}>{t('clauses.field.jurisdiction', 'Jurisdiction')}</FieldLabel>
              <Input id={id('jurisdiction')} value={jurisdiction} maxLength={120} onChange={(e) => setJurisdiction(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={id('tags')}>{t('clauses.field.tags', 'Tags')}</FieldLabel>
              <Input id={id('tags')} value={tags} onChange={(e) => setTags(e.target.value)} />
              <FieldHelperText>{t('clauses.tags_hint', 'Separate tags with commas.')}</FieldHelperText>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={id('guidance')}>{t('clauses.field.guidance', 'Guidance for reviewers')}</FieldLabel>
            <Textarea id={id('guidance')} rows={2} maxLength={2000} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={id('approved')}>{t('clauses.field.approved', 'Approved wording')}</FieldLabel>
            <Textarea id={id('approved')} rows={5} maxLength={20000} value={approved} onChange={(e) => setApproved(e.target.value)} />
          </Field>

          <fieldset className="m-0 flex min-w-0 flex-col gap-g8 rounded-md border border-border p-g13">
            <legend className="px-g5 text-sm font-semibold">{t('clauses.fallbacks', 'Fallback wording (in order of preference)')}</legend>
            {fallbacks.length === 0 && <Text size="xs" tone="muted">{t('clauses.fallbacks_empty', 'No fallbacks yet.')}</Text>}
            {fallbacks.map((value, index) => (
              <div key={index} className="flex items-start gap-g8">
                <Textarea aria-label={t('clauses.fallback_n', 'Fallback {n}', { n: index + 1 })} rows={3} maxLength={20000} value={value}
                  onChange={(e) => setFallbacks((list) => list.map((f, i) => (i === index ? e.target.value : f)))} />
                {!readOnly && <Button type="button" variant="ghost" size="icon-md" aria-label={t('clauses.remove_fallback', 'Remove fallback {n}', { n: index + 1 })} onClick={() => setFallbacks((list) => list.filter((_, i) => i !== index))}><Trash2 className="size-g16" aria-hidden /></Button>}
              </div>
            ))}
            {!readOnly && fallbacks.length < 5 && <div><Button type="button" variant="outline" size="sm" onClick={() => setFallbacks((list) => [...list, ''])}><Plus aria-hidden />{t('clauses.add_fallback', 'Add fallback')}</Button></div>}
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-g13 rounded-md border border-border p-g13">
            <legend className="px-g5 text-sm font-semibold">{t('clauses.rules', 'Playbook rules')}</legend>
            <Text size="xs" tone="muted">{t('clauses.rules_intro', 'The playbook check reads these rules; no AI is involved. Write one phrase per line, or start a line with re: for a regular expression.')}</Text>
            <Checkbox checked={required} onCheckedChange={(details) => setRequired(details.checked === true)}>
              <CheckboxControl /><CheckboxLabel>{t('clauses.rule.required', 'Every contract must contain this clause')}</CheckboxLabel><CheckboxHiddenInput />
            </Checkbox>
            <Field>
              <FieldLabel htmlFor={id('present')}>{t('clauses.rule.present_any', 'Wording that shows the clause is present')}</FieldLabel>
              <Textarea id={id('present')} rows={3} value={presentAny} onChange={(e) => setPresentAny(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={id('forbidden')}>{t('clauses.rule.forbidden', 'Wording that is not acceptable')}</FieldLabel>
              <Textarea id={id('forbidden')} rows={3} value={forbidden} onChange={(e) => setForbidden(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={id('severity')}>{t('clauses.rule.severity', 'Severity of a finding')}</FieldLabel>
              <NativeSelect id={id('severity')} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="">{t('clauses.rule.severity_from_risk', 'From the risk level')}</option>
                {SEVERITIES.map((value) => <option key={value} value={value}>{t(...SEVERITY_KEYS[value])}</option>)}
              </NativeSelect>
            </Field>
            <div className="flex flex-col gap-g8">
              <Text size="sm" weight="semibold">{t('clauses.rule.numeric', 'Figures the contract must keep to')}</Text>
              {numeric.map((rule, index) => (
                <div key={index} className="grid gap-g8 rounded-md border border-border p-g8 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <NativeSelect aria-label={t('clauses.rule.metric', 'Figure')} value={rule.metric} onChange={(e) => updateNumeric(index, { metric: e.target.value as NumericRule['metric'] })}>
                    {NUMERIC_METRICS.map((value) => <option key={value} value={value}>{t(...METRIC_KEYS[value])}</option>)}
                  </NativeSelect>
                  <Input type="number" aria-label={t('clauses.rule.min', 'Minimum')} placeholder={t('clauses.rule.min', 'Minimum')} value={rule.minText} onChange={(e) => updateNumeric(index, { minText: e.target.value })} />
                  <Input type="number" aria-label={t('clauses.rule.max', 'Maximum')} placeholder={t('clauses.rule.max', 'Maximum')} value={rule.maxText} onChange={(e) => updateNumeric(index, { maxText: e.target.value })} />
                  {!readOnly && <Button type="button" variant="ghost" size="icon-md" aria-label={t('clauses.rule.remove_numeric', 'Remove figure rule {n}', { n: index + 1 })} onClick={() => setNumeric((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="size-g16" aria-hidden /></Button>}
                  {rule.metric === 'custom' && (
                    <>
                      <Input aria-label={t('clauses.rule.label', 'Name of the figure')} placeholder={t('clauses.rule.label', 'Name of the figure')} value={rule.label ?? ''} onChange={(e) => updateNumeric(index, { label: e.target.value })} />
                      <Input className="sm:col-span-2" aria-label={t('clauses.rule.pattern', 'Pattern with one capture group')} placeholder="re:warranty period of (\d+) months" value={rule.pattern ?? ''} onChange={(e) => updateNumeric(index, { pattern: e.target.value })} />
                    </>
                  )}
                  <div className="sm:col-span-4">
                    <Checkbox checked={rule.required} onCheckedChange={(details) => updateNumeric(index, { required: details.checked === true })}>
                      <CheckboxControl /><CheckboxLabel>{t('clauses.rule.numeric_required', 'Report it when the contract does not state this figure')}</CheckboxLabel><CheckboxHiddenInput />
                    </Checkbox>
                  </div>
                </div>
              ))}
              {!readOnly && numeric.length < 10 && <div><Button type="button" variant="outline" size="sm" onClick={() => setNumeric((rows) => [...rows, { metric: 'payment_terms_days', min: null, max: null, required: false, minText: '', maxText: '' }])}><Plus aria-hidden />{t('clauses.rule.add_numeric', 'Add figure rule')}</Button></div>}
            </div>
          </fieldset>
          {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        </fieldset>
        <div className="mt-g13 flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{readOnly ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}</Button>
          {!readOnly && <Button type="submit" disabled={busy}>{busy ? t('clauses.saving', 'Saving…') : t('common.save', 'Save')}</Button>}
        </div>
      </form>
    </ModalFrame>
  );
};
