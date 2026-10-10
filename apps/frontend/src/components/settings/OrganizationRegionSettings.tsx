import { AlphabeticalDatalist, AlphabeticalSelect } from '../ui/alphabetical-select';
import React, { useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Globe2, Loader2, Save } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { usePermissions } from '../../lib/permissions';
import { SUPPORTED_CURRENCIES, currencyLabel } from '@legalio/shared/currencyUtils';
import { buildDueDiligenceChecklist, getCountryPack, getIndustryPack, localize, localizeName, type TenantSettings } from '@legalio/shared/policy';
import { DueDiligenceChecklistEditor } from './DueDiligenceChecklistEditor';

import { Input } from '@legalio/ui-components/input';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
import { Field, FieldLabel, FieldHelperText } from '@legalio/ui-components/field';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

function timezoneOptions(extra: string[]): string[] {
  let all: string[] = [];
  try {
    all = (Intl as any).supportedValuesOf?.('timeZone') || [];
  } catch {
    all = [];
  }
  return Array.from(new Set([...extra, 'UTC', ...all])).sort();
}

const hintClass = 'mt-1.5 text-xs leading-relaxed text-muted-foreground ';
const sectionClass = 'min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm  ';
/**
 * A native `<legend>` renders flush with its `<fieldset>`'s own border-box
 * top edge, ignoring the fieldset's padding — so a legend inside a
 * card-styled (bordered, rounded) fieldset visually sits on top of the
 * card's border instead of inside it. The fix: keep the visible "card"
 * (border/rounded/background/padding/shadow) on an inner `<div>` instead of
 * the `<fieldset>` itself, and reset the fieldset to an invisible wrapper.
 * `<legend>` stays the fieldset's first child (required for the accessible
 * group name) but now renders as a plain heading above the card, with no
 * border underneath it to overlap. `disabled` on the fieldset still
 * propagates to every descendant control regardless of this nesting.
 */
const fieldsetResetClass = 'min-w-0 border-0 p-0 m-0';
const legendClass = 'sr-only';
const sectionHeadingClass = 'mb-4 text-base font-semibold text-foreground ';

/**
 * Organization & region settings (PRD §2.1, §3.3.5): country and industry
 * packs, language, time zone, currencies, lifecycle windows, reminders,
 * contract defaults, modules and the due-diligence checklist.
 */
export const OrganizationRegionSettings: React.FC = () => {
  const { t, language } = useLanguage();
  const { policy, countries, industries, status, saveSettings } = useTenantSettings();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('admin.access');
  const [draft, setDraft] = useState<TenantSettings>(policy.settings);
  const [remindersText, setRemindersText] = useState(policy.settings.reminderOffsetsDays.join(', '));
  const [save, setSave] = useState<SaveStatus>({ kind: 'idle' });
  const ids = {
    country: useId(), industry: useId(), language: useId(), timezone: useId(), tzList: useId(),
    currency: useId(), reporting: useId(), expiry: useId(), reminders: useId(), remindersHint: useId(),
    law: useId(), venue: useId(), error: useId(),
  };

  // Re-sync the form when another tenant is selected or after saving.
  useEffect(() => {
    setDraft(policy.settings);
    setRemindersText(policy.settings.reminderOffsetsDays.join(', '));
  }, [policy]);

  // Base pack items for the draft country/industry, before tenant overrides.
  const packChecklist = useMemo(
    () => buildDueDiligenceChecklist({ ...draft, ddOverrides: {}, customDueDiligence: [] }, { includeDisabled: true }),
    [draft.countryCode, draft.industry],
  );
  const tzOptions = useMemo(() => timezoneOptions(countries.map((c) => c.timezone)), [countries]);
  // Defaults of the country currently selected in the form, so they update before saving.
  const draftCountry = getCountryPack(draft.countryCode);
  const packLaw = localize(draftCountry.governingLaw, language);
  const packVenue = localize(draftCountry.disputeVenue, language);
  const remindersValid = remindersText.split(',').map((v) => v.trim()).filter(Boolean).every((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 730);

  const update = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSave({ kind: 'idle' });
  };

  const onCountryChange = (code: string) => {
    const pack = countries.find((c) => c.code === code);
    // Changing country proposes that country's currency and time zone.
    setDraft((prev) => ({
      ...prev,
      countryCode: code,
      defaultCurrency: pack?.defaultCurrency || prev.defaultCurrency,
      timezone: pack?.timezone || prev.timezone,
      governingLaw: undefined,
      disputeVenue: undefined,
    }));
    setSave({ kind: 'idle' });
  };

  const onIndustryChange = (key: string) => {
    const next = getIndustryPack(key);
    setDraft((prev) => {
      const previous = getIndustryPack(prev.industry);
      // Propose the industry's contract currency; drop it again when leaving such an industry.
      const revert = previous.contractCurrency && prev.defaultCurrency === previous.contractCurrency;
      const defaultCurrency = next.contractCurrency || (revert ? getCountryPack(prev.countryCode).defaultCurrency : prev.defaultCurrency);
      return { ...prev, industry: next.key, defaultCurrency };
    });
    setSave({ kind: 'idle' });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!remindersValid) {
      setSave({ kind: 'error', message: t('settings.region.invalid_reminders', 'Enter reminder days as whole numbers between 1 and 730.') });
      return;
    }
    setSave({ kind: 'saving' });
    try {
      await saveSettings({
        ...draft,
        reminderOffsetsDays: remindersText.split(',').map((v) => Number(v.trim())).filter((n) => n > 0),
      });
      setSave({ kind: 'saved' });
    } catch (err: any) {
      setSave({ kind: 'error', message: err?.message || String(err) });
    }
  };

  if (status === 'error') {
    return (
      <Alert status="error" role="alert">
        <AlertContent>{t('settings.region.load_error', 'Organization settings could not be loaded.')}</AlertContent>
      </Alert>
    );
  }

  const moduleRows: Array<{ key: keyof TenantSettings['modules']; label: string }> = [
    { key: 'commercialDocuments', label: t('settings.region.module_commercial', '{docs}') },
    { key: 'spending', label: t('settings.region.module_spending', 'Partner spending & invoices') },
    { key: 'evaluation', label: t('settings.region.module_evaluation', 'Partner evaluation') },
    { key: 'aiAssistant', label: t('settings.region.module_ai', 'AI assistant, document parsing and contract review') },
    { key: 'newsTicker', label: t('settings.region.module_news', 'Regulatory news ticker (uses AI)') },
  ];

  return (
    <form onSubmit={submit} noValidate aria-busy={save.kind === 'saving' || status === 'loading'} className="flex min-w-0 flex-col gap-6">
      <div className={sectionClass}>
        <h3 className="flex items-center gap-2 text-lg font-bold text-foreground ">
          <Globe2 className="h-5 w-5 text-accent-foreground" aria-hidden="true" />
          {t('settings.region.title', 'Organization & region')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.region.subtitle', 'These settings drive due-diligence checklists, currencies, dates, reminders, contract templates and AI prompts for {org}.', { org: policy.tenantName || '—' })}
        </p>
        {!canEdit && <p className="mt-2 text-sm text-status-warning">{t('settings.region.admin_only', 'Only administrators can change organization settings.')}</p>}
      </div>

      <fieldset className={fieldsetResetClass} disabled={!canEdit}>
        <legend className={legendClass}>{t('settings.region.profile', 'Profile')}</legend>
        <div className={sectionClass}>
          <h3 className={sectionHeadingClass}>{t('settings.region.profile', 'Profile')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.country}>{t('settings.region.country', 'Country / jurisdiction pack')}</FieldLabel>
              <AlphabeticalSelect id={ids.country} value={draft.countryCode} onChange={(e) => onCountryChange(e.target.value)}>
                {countries.map((c) => <option key={c.code} value={c.code}>{localizeName(c.name, language)}</option>)}
              </AlphabeticalSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.industry}>{t('settings.region.industry', 'Industry pack')}</FieldLabel>
              <AlphabeticalSelect id={ids.industry} value={draft.industry} onChange={(e) => onIndustryChange(e.target.value)}>
                {industries.map((i) => <option key={i.key} value={i.key}>{localize(i.name, language)}</option>)}
              </AlphabeticalSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.language}>{t('settings.region.language', 'Default language for e-mails and AI answers')}</FieldLabel>
              <AlphabeticalSelect id={ids.language} value={draft.language} onChange={(e) => update('language', e.target.value as 'EN' | 'ID' | 'ZH')}>
                <option value="EN">{t('settings.english', 'English')}</option>
                <option value="ID">{t('settings.bahasa_indonesia', 'Bahasa Indonesia')}</option>
                <option value="ZH">{t('settings.chinese', '中文')}</option>
              </AlphabeticalSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.timezone}>{t('settings.region.timezone', 'Time zone')}</FieldLabel>
              <Input id={ids.timezone} list={ids.tzList} value={draft.timezone} onChange={(e) => update('timezone', e.target.value)} aria-describedby={`${ids.timezone}-hint`} />
              <AlphabeticalDatalist id={ids.tzList}>{tzOptions.map((tz) => <option key={tz} value={tz} />)}</AlphabeticalDatalist>
              <FieldHelperText id={`${ids.timezone}-hint`}>{t('settings.region.timezone_hint', 'IANA name, e.g. Asia/Singapore. Deadlines are calculated in this time zone.')}</FieldHelperText>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.currency}>{t('settings.region.default_currency', 'Default currency')}</FieldLabel>
              <AlphabeticalSelect id={ids.currency} value={draft.defaultCurrency} onChange={(e) => update('defaultCurrency', e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>)}
              </AlphabeticalSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.reporting}>{t('settings.region.reporting_currency', 'Reporting currency')}</FieldLabel>
              <AlphabeticalSelect id={ids.reporting} value={draft.reportingCurrency} onChange={(e) => update('reportingCurrency', e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>)}
              </AlphabeticalSelect>
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className={fieldsetResetClass} disabled={!canEdit}>
        <legend className={legendClass}>{t('settings.region.lifecycle', 'Lifecycle & reminders')}</legend>
        <div className={sectionClass}>
          <h3 className={sectionHeadingClass}>{t('settings.region.lifecycle', 'Lifecycle & reminders')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.expiry}>{t('settings.region.expiry_days', 'Mark as "expiring soon" when this many days remain')}</FieldLabel>
              <Input id={ids.expiry} type="number" min={1} max={730} value={draft.expiryWarningDays} onChange={(e) => update('expiryWarningDays', Number(e.target.value) || 1)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.reminders}>{t('settings.region.reminders', 'Send reminders this many days before expiry')}</FieldLabel>
              <Input
                id={ids.reminders}
                value={remindersText}
                inputMode="numeric"
                onChange={(e) => { setRemindersText(e.target.value); setSave({ kind: 'idle' }); }}
                aria-invalid={!remindersValid}
                aria-describedby={ids.remindersHint}
              />
              <FieldHelperText id={ids.remindersHint}>{t('settings.region.reminders_hint', 'Comma separated, e.g. 90, 60, 30, 14')}</FieldHelperText>
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className={fieldsetResetClass} disabled={!canEdit}>
        <legend className={legendClass}>{t('settings.region.legal_defaults', 'Contract defaults')}</legend>
        <div className={sectionClass}>
          <h3 className={sectionHeadingClass}>{t('settings.region.legal_defaults', 'Contract defaults')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.law}>{t('settings.region.governing_law', 'Governing law')}</FieldLabel>
              <Input id={ids.law} value={draft.governingLaw || ''} placeholder={packLaw} onChange={(e) => update('governingLaw', e.target.value || undefined)} aria-describedby={`${ids.law}-hint`} />
              <FieldHelperText id={`${ids.law}-hint`}>{t('settings.region.pack_default', 'Pack default: {value}', { value: packLaw })}</FieldHelperText>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.venue}>{t('settings.region.dispute_venue', 'Dispute resolution forum')}</FieldLabel>
              <Input id={ids.venue} value={draft.disputeVenue || ''} placeholder={packVenue} onChange={(e) => update('disputeVenue', e.target.value || undefined)} aria-describedby={`${ids.venue}-hint`} />
              <FieldHelperText id={`${ids.venue}-hint`}>{t('settings.region.pack_default', 'Pack default: {value}', { value: packVenue })}</FieldHelperText>
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className={fieldsetResetClass} disabled={!canEdit}>
        <legend className={legendClass}>{t('settings.region.modules', 'Modules')}</legend>
        <div className={sectionClass}>
          <h3 className={sectionHeadingClass}>{t('settings.region.modules', 'Modules')}</h3>
          <div className="grid gap-1 md:grid-cols-2">
            {moduleRows.map((row) => (
              <Checkbox checked={draft.modules[row.key]} onCheckedChange={(details) => update('modules', { ...draft.modules, [row.key]: details.checked === true })}><CheckboxControl /><CheckboxLabel>{row.label}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className={fieldsetResetClass} disabled={!canEdit}>
        <legend className={legendClass}>{t('settings.region.dd_title', 'Due-diligence checklist')}</legend>
        <div className={sectionClass}>
          <h3 className={sectionHeadingClass}>{t('settings.region.dd_title', 'Due-diligence checklist')}</h3>
          <p className={`${hintClass.replace('mt-1.5', 'mt-0')} mb-2`}>{t('settings.region.dd_desc', 'Items come from the core, country and industry packs. Mark items as required or hide them, and add your own.')}</p>
          <DueDiligenceChecklistEditor
            packItems={packChecklist}
            overrides={draft.ddOverrides}
            customItems={draft.customDueDiligence}
            disabled={!canEdit}
            onChange={({ overrides, customItems }) => setDraft((prev) => ({ ...prev, ddOverrides: overrides, customDueDiligence: customItems }))}
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          disabled={!canEdit || save.kind === 'saving'}
        >
          {save.kind === 'saving'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
          {save.kind === 'saving' ? t('common.saving', 'Saving…') : t('settings.region.save', 'Save organization settings')}
        </Button>
        <div aria-live="polite">
          {save.kind === 'saved' && (
            <p className="flex items-center gap-2 text-sm text-status-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('settings.region.saved', 'Organization settings saved. Checklists and statuses were recalculated.')}
            </p>
          )}
        </div>
        {save.kind === 'error' && (
          <p id={ids.error} role="alert" className="flex items-center gap-2 text-sm text-status-danger">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {save.message}
          </p>
        )}
      </div>
    </form>
  );
};
