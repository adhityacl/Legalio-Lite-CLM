import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, CheckCircle2, ChevronDown, Globe2, Bell, Loader2, RefreshCw, Save, Scale } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { usePermissions } from '../../lib/permissions';
import { registerDirtyCheck } from '../../lib/unsavedChanges';
import { SUPPORTED_CURRENCIES, currencyLabel } from '@legalio/shared/currencyUtils';
import { buildDueDiligenceChecklist, getCountryPack, getIndustryPack, localize, localizeName, type TenantSettings } from '@legalio/shared/policy';
import { AlphabeticalDatalist, AlphabeticalSelect } from '../ui/alphabetical-select';
import { Button } from '@legalio/ui-components/button';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { ModalFrame } from '../ui/modal-frame';
import { LogoUploadField } from './LogoUploadField';
import { OrganizationColorPicker } from './OrganizationColorPicker';
import { DueDiligenceChecklistEditor } from './DueDiligenceChecklistEditor';
import { OrgApiError, orgApi, orgPath } from './orgApi';

import type { OrganizationSettingsDto } from '@legalio/types/organizationSettings';
import { Input } from '@legalio/ui-components/input';
import { Textarea } from '@legalio/ui-components/textarea';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
import { Field, FieldLabel, FieldHelperText, FieldErrorText } from '@legalio/ui-components/field';
import { DialogTitle } from '@legalio/ui-components/dialog';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
export type { OrganizationSettingsDto } from '@legalio/types/organizationSettings';

type SectionId = 'profile' | 'region' | 'contracts' | 'notifications';
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string; conflict?: boolean };

const labelClass = 'mb-1.5 block text-sm font-medium text-foreground ';
const hintClass = 'mt-1.5 text-xs leading-relaxed text-muted-foreground ';

function timezoneOptions(extra: string[]): string[] {
  let all: string[] = [];
  try {
    all = (Intl as any).supportedValuesOf?.('timeZone') || [];
  } catch {
    all = [];
  }
  return Array.from(new Set([...extra, 'UTC', ...all])).sort();
}

const splitEmails = (text: string) => text.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);

/** DD override patch: removed keys are sent as null so the server clears them (merge semantics). */
function ddOverridePatch(before: TenantSettings['ddOverrides'], after: TenantSettings['ddOverrides']) {
  const patch: Record<string, unknown> = { ...after };
  for (const key of Object.keys(before)) if (!(key in after)) patch[key] = null;
  return patch;
}

/**
 * Organization tab (PRD §6.3): four collapsible sections, each with its own
 * Save that sends only that section's fields with the version the form was
 * loaded from. A stale save gets a conflict and a reload option — never a
 * silent overwrite.
 */
export const OrganizationTab: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t, language } = useLanguage();
  const { identity } = useIdentity();
  const { countries, industries } = useTenantSettings();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('tenant.settings.update');
  const queryClient = useQueryClient();
  const queryKey = ['org-settings', identity?.id, organizationId];
  const settingsQuery = useQuery<OrganizationSettingsDto>({
    queryKey,
    queryFn: ({ signal }) => orgApi<OrganizationSettingsDto>(orgPath(organizationId, '/settings'), { signal }),
    staleTime: 0,
  });
  const data = settingsQuery.data;

  const [profile, setProfile] = useState<{ name: string } & OrganizationSettingsDto['profile']>();
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [draftLogo, setDraftLogo] = useState('');
  const [policy, setPolicy] = useState<TenantSettings>();
  const [remindersText, setRemindersText] = useState('');
  const [recipients, setRecipients] = useState({ list: '', legal: '', finance: '' });
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ profile: true, region: false, contracts: false, notifications: false });
  const [saves, setSaves] = useState<Record<SectionId, SaveState>>({ profile: { kind: 'idle' }, region: { kind: 'idle' }, contracts: { kind: 'idle' }, notifications: { kind: 'idle' } });

  const reset = (dto: OrganizationSettingsDto) => {
    setProfile({ name: dto.name, ...dto.profile });
    setPolicy(dto.policy);
    setRemindersText(dto.policy.reminderOffsetsDays.join(', '));
    setRecipients({
      list: dto.notifications.notificationEmails.join(', '),
      legal: dto.notifications.legalNotificationEmail || '',
      finance: dto.notifications.financeNotificationEmail || '',
    });
  };
  useEffect(() => { if (data) reset(data); }, [data]);

  const dirty = useMemo(() => {
    if (!data || !profile || !policy) return { profile: false, region: false, contracts: false, notifications: false };
    const p = data.policy;
    return {
      profile: profile.name !== data.name || (['legalEntity', 'brandName', 'logoUrl', 'primaryColor'] as const).some((k) => profile[k] !== data.profile[k]),
      region: (['countryCode', 'industry', 'language', 'timezone', 'defaultCurrency', 'reportingCurrency'] as const).some((k) => policy[k] !== p[k]),
      contracts: policy.expiryWarningDays !== p.expiryWarningDays || (policy.governingLaw || '') !== (p.governingLaw || '') || (policy.disputeVenue || '') !== (p.disputeVenue || '')
        || JSON.stringify(policy.ddOverrides) !== JSON.stringify(p.ddOverrides) || JSON.stringify(policy.customDueDiligence) !== JSON.stringify(p.customDueDiligence),
      notifications: remindersText !== p.reminderOffsetsDays.join(', ') || JSON.stringify(policy.modules) !== JSON.stringify(p.modules)
        || recipients.list !== data.notifications.notificationEmails.join(', ') || recipients.legal !== (data.notifications.legalNotificationEmail || '')
        || recipients.finance !== (data.notifications.financeNotificationEmail || ''),
    };
  }, [data, profile, policy, remindersText, recipients]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => registerDirtyCheck(() => Object.values(dirtyRef.current).some(Boolean)), []);

  const ids = {
    name: useId(), legal: useId(), brand: useId(), logo: useId(), color: useId(), slug: useId(),
    country: useId(), industry: useId(), language: useId(), timezone: useId(), tzList: useId(), currency: useId(), reporting: useId(),
    expiry: useId(), law: useId(), venue: useId(), reminders: useId(), list: useId(), legalEmail: useId(), financeEmail: useId(),
  };
  const tzOptions = useMemo(() => timezoneOptions(countries.map((c) => c.timezone)), [countries]);

  if (settingsQuery.isError) {
    return (
      <Alert status="error" role="alert" className="flex flex-col items-start gap-3">
        <AlertContent>{t('tb.settings_load_error', 'Organization settings could not be loaded.')}
        <Button type="button" variant="outline" size="sm" onClick={() => settingsQuery.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('tb.retry', 'Retry')}</Button></AlertContent>
      </Alert>
    );
  }
  if (!data || !profile || !policy) {
    return <div className="space-y-3" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  }

  const country = getCountryPack(policy.countryCode);
  const packLaw = localize(country.governingLaw, language);
  const packVenue = localize(country.disputeVenue, language);
  const packChecklist = buildDueDiligenceChecklist({ ...policy, ddOverrides: {}, customDueDiligence: [] }, { includeDisabled: true });
  const remindersValid = remindersText.split(',').map((v) => v.trim()).filter(Boolean).every((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 730);

  const setState = (section: SectionId, state: SaveState) => setSaves((prev) => ({ ...prev, [section]: state }));

  const save = async (section: SectionId, body: Record<string, unknown>) => {
    setState(section, { kind: 'saving' });
    try {
      const next = await orgApi<OrganizationSettingsDto>(orgPath(organizationId, '/settings'), { method: 'PATCH', body: { expectedVersion: data.version, ...body } });
      queryClient.setQueryData(queryKey, next);
      setState(section, { kind: 'saved' });
      window.dispatchEvent(new CustomEvent('organization-updated'));
    } catch (err) {
      const conflict = err instanceof OrgApiError && err.code === 'VERSION_CONFLICT';
      setState(section, {
        kind: 'error',
        conflict,
        message: conflict ? t('tb.version_conflict', 'Someone else changed these settings. Reload to see the latest version, then reapply your change.') : (err as Error).message,
      });
    }
  };

  const reload = async () => {
    const fresh = await settingsQuery.refetch();
    if (fresh.data) reset(fresh.data);
    setSaves({ profile: { kind: 'idle' }, region: { kind: 'idle' }, contracts: { kind: 'idle' }, notifications: { kind: 'idle' } });
  };

  const sectionShell = (id: SectionId, icon: React.ReactNode, title: string, description: string, body: React.ReactNode, onSubmit: () => void, valid = true) => {
    const state = saves[id];
    return (
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <h3>
          <button
            type="button"
            aria-expanded={open[id]}
            aria-controls={`org-section-${id}`}
            onClick={() => setOpen((prev) => ({ ...prev, [id]: !prev[id] }))}
            className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)/40"
          >
            <span className="flex items-center gap-3">
              <span className="text-accent-foreground" aria-hidden="true">{icon}</span>
              <span>
                <span className="block text-base font-semibold text-foreground ">{title}</span>
                <span className="block text-sm font-normal text-muted-foreground">{description}</span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              {dirty[id] && <span className="rounded-full bg-status-warning-soft px-2 py-0.5 text-xs font-semibold text-status-warning ">{t('tb.unsaved', 'Unsaved')}</span>}
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${open[id] ? 'rotate-180' : ''}`} aria-hidden="true" />
            </span>
          </button>
        </h3>
        {open[id] && (
          <form
            id={`org-section-${id}`}
            noValidate
            aria-busy={state.kind === 'saving'}
            onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
            className="border-t border-border px-5 pb-5 pt-4"
          >
            <fieldset disabled={!canEdit || state.kind === 'saving'} className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">{title}</legend>
              {body}
            </fieldset>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button type="submit" disabled={!canEdit || !dirty[id] || !valid || state.kind === 'saving'}>
                {state.kind === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                {state.kind === 'saving' ? t('common.saving', 'Saving…') : t('tb.save_section', 'Save {section}', { section: title })}
              </Button>
              <div aria-live="polite">
                {state.kind === 'saved' && (
                  <p className="flex items-center gap-2 text-sm text-status-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('tb.saved', 'Saved.')}</p>
                )}
              </div>
              {state.kind === 'error' && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-status-danger">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  {state.message}
                  {state.conflict && <Button type="button" variant="outline" size="sm" onClick={reload}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('tb.reload', 'Reload')}</Button>}
                </div>
              )}
            </div>
          </form>
        )}
      </section>
    );
  };

  const setPolicyField = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) => setPolicy((prev) => ({ ...prev!, [key]: value }));
  const moduleRows: Array<{ key: keyof TenantSettings['modules']; label: string }> = [
    { key: 'commercialDocuments', label: t('settings.region.module_commercial', '{docs}') },
    { key: 'spending', label: t('settings.region.module_spending', 'Partner spending & invoices') },
    { key: 'evaluation', label: t('settings.region.module_evaluation', 'Partner evaluation') },
    { key: 'aiAssistant', label: t('settings.region.module_ai', 'AI assistant, document parsing and contract review') },
    { key: 'newsTicker', label: t('settings.region.module_news', 'Regulatory news ticker (uses AI)') },
  ];
  const emailsValid = [...splitEmails(recipients.list), recipients.legal, recipients.finance].filter(Boolean).every((e) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!canEdit && <p className="text-sm text-status-warning">{t('settings.region.admin_only', 'Only administrators can change organization settings.')}</p>}

      {sectionShell('profile', <Building2 className="h-5 w-5" />, t('tb.section_profile', 'Profile'), t('tb.section_profile_desc', 'Name, legal entity and brand of this organization.'), (
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.name} className={labelClass}>{t('tb.org_name', 'Organization name')}</FieldLabel>
            <Input id={ids.name} required maxLength={200} value={profile.name} aria-invalid={!profile.name.trim()} aria-describedby={!profile.name.trim() ? `${ids.name}-error` : undefined} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            {!profile.name.trim() && <p id={`${ids.name}-error`} className="mt-1.5 text-xs text-status-danger">{t('tb.name_required', 'Enter the organization name.')}</p>}
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.slug} className={labelClass}>{t('tb.slug', 'Slug')}</FieldLabel>
            <Input id={ids.slug} value={data.slug} readOnly aria-describedby={`${ids.slug}-hint`} />
            <FieldHelperText id={`${ids.slug}-hint`} className={hintClass}>{t('tb.slug_hint', 'Only a platform administrator can change the slug.')}</FieldHelperText>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.legal} className={labelClass}>{t('tb.legal_entity', 'Legal entity')}</FieldLabel>
            <Input id={ids.legal} maxLength={200} value={profile.legalEntity} onChange={(e) => setProfile({ ...profile, legalEntity: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.brand} className={labelClass}>{t('tb.brand_name', 'Brand name')}</FieldLabel>
            <Input id={ids.brand} maxLength={200} value={profile.brandName} onChange={(e) => setProfile({ ...profile, brandName: e.target.value })} />
          </Field>
          <div>
            <span className={labelClass}>{t('admin.org_logo_label', 'Logo Organisasi / Workspace')}</span>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card ">
                {profile.logoUrl ? <img src={profile.logoUrl} alt={profile.name} className="h-full w-full object-cover" /> : <Building2 className="h-6 w-6 text-accent-foreground" aria-hidden="true" />}
              </div>
              <Button id={ids.logo} type="button" variant="outline" disabled={!canEdit} onClick={() => { setDraftLogo(profile.logoUrl); setLogoDialogOpen(true); }}>{t('admin.logo_mode_upload', 'Unggah File Gambar')}</Button>
            </div>
          </div>
          <div>
            <label htmlFor={ids.color} className={labelClass}>{t('tb.primary_color', 'Primary color')}</label>
            <OrganizationColorPicker id={ids.color} value={profile.primaryColor} disabled={!canEdit} onChange={primaryColor => setProfile({ ...profile, primaryColor })} />
          </div>
        </div>
      ), () => save('profile', {
        ...(profile.name !== data.name ? { name: profile.name.trim() } : {}),
        profile: { legalEntity: profile.legalEntity, brandName: profile.brandName, logoUrl: profile.logoUrl, primaryColor: profile.primaryColor },
      }), Boolean(profile.name.trim()))}

      {sectionShell('region', <Globe2 className="h-5 w-5" />, t('tb.section_region', 'Region and formatting'), t('tb.section_region_desc', 'Country and industry packs, currencies, time zone and generated-content language.'), (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={ids.country} className={labelClass}>{t('settings.region.country', 'Country / jurisdiction pack')}</label>
              <AlphabeticalSelect id={ids.country} value={policy.countryCode} onChange={(e) => {
                const pack = countries.find((c) => c.code === e.target.value);
                setPolicy({ ...policy, countryCode: e.target.value, defaultCurrency: pack?.defaultCurrency || policy.defaultCurrency, timezone: pack?.timezone || policy.timezone });
              }}>
                {countries.map((c) => <option key={c.code} value={c.code}>{localizeName(c.name, language)}</option>)}
              </AlphabeticalSelect>
            </div>
            <div>
              <label htmlFor={ids.industry} className={labelClass}>{t('settings.region.industry', 'Industry pack')}</label>
              <AlphabeticalSelect id={ids.industry} value={policy.industry} onChange={(e) => {
                const next = getIndustryPack(e.target.value);
                const previous = getIndustryPack(policy.industry);
                const revert = previous.contractCurrency && policy.defaultCurrency === previous.contractCurrency;
                setPolicy({ ...policy, industry: next.key, defaultCurrency: next.contractCurrency || (revert ? getCountryPack(policy.countryCode).defaultCurrency : policy.defaultCurrency) });
              }}>
                {industries.map((i) => <option key={i.key} value={i.key}>{localize(i.name, language)}</option>)}
              </AlphabeticalSelect>
            </div>
            <div>
              <label htmlFor={ids.language} className={labelClass}>{t('settings.region.language', 'Default language for e-mails and AI answers')}</label>
              <AlphabeticalSelect id={ids.language} value={policy.language} onChange={(e) => setPolicyField('language', e.target.value as TenantSettings['language'])}>
                <option value="EN">{t('settings.english', 'English')}</option>
                <option value="ID">{t('settings.bahasa_indonesia', 'Bahasa Indonesia')}</option>
                <option value="ZH">{t('settings.chinese', '中文')}</option>
              </AlphabeticalSelect>
            </div>
            <div>
              <label htmlFor={ids.timezone} className={labelClass}>{t('settings.region.timezone', 'Time zone')}</label>
              <Input id={ids.timezone} list={ids.tzList} value={policy.timezone} onChange={(e) => setPolicyField('timezone', e.target.value)} aria-describedby={`${ids.timezone}-hint`} />
              <AlphabeticalDatalist id={ids.tzList}>{tzOptions.map((tz) => <option key={tz} value={tz} />)}</AlphabeticalDatalist>
              <p id={`${ids.timezone}-hint`} className={hintClass}>{t('settings.region.timezone_hint', 'IANA name, e.g. Asia/Singapore. Deadlines are calculated in this time zone.')}</p>
            </div>
            <div>
              <label htmlFor={ids.currency} className={labelClass}>{t('settings.region.default_currency', 'Default currency')}</label>
              <AlphabeticalSelect id={ids.currency} value={policy.defaultCurrency} onChange={(e) => setPolicyField('defaultCurrency', e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>)}
              </AlphabeticalSelect>
            </div>
            <div>
              <label htmlFor={ids.reporting} className={labelClass}>{t('settings.region.reporting_currency', 'Reporting currency')}</label>
              <AlphabeticalSelect id={ids.reporting} value={policy.reportingCurrency} onChange={(e) => setPolicyField('reportingCurrency', e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>)}
              </AlphabeticalSelect>
            </div>
          </div>
        </div>
      ), () => save('region', { policy: {
        countryCode: policy.countryCode, industry: policy.industry, language: policy.language,
        timezone: policy.timezone, defaultCurrency: policy.defaultCurrency, reportingCurrency: policy.reportingCurrency,
      } }))}

      {sectionShell('contracts', <Scale className="h-5 w-5" />, t('tb.section_contracts', 'Contract and due diligence rules'), t('tb.section_contracts_desc', 'Warning window, governing law, dispute venue and the due-diligence checklist.'), (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.expiry} className={labelClass}>{t('settings.region.expiry_days', 'Mark as "expiring soon" when this many days remain')}</FieldLabel>
              <Input id={ids.expiry} type="number" min={1} max={730} value={policy.expiryWarningDays}
                aria-invalid={!(policy.expiryWarningDays >= 1 && policy.expiryWarningDays <= 730)}
                onChange={(e) => setPolicyField('expiryWarningDays', Math.trunc(Number(e.target.value)) || 0)} />
            </Field>
            <div className="hidden md:block" />
            <Field>
              <FieldLabel htmlFor={ids.law} className={labelClass}>{t('settings.region.governing_law', 'Governing law')}</FieldLabel>
              <Input id={ids.law} maxLength={2000} value={policy.governingLaw || ''} placeholder={packLaw} onChange={(e) => setPolicyField('governingLaw', e.target.value || undefined)} aria-describedby={`${ids.law}-hint`} />
              <FieldHelperText id={`${ids.law}-hint`} className={hintClass}>{t('settings.region.pack_default', 'Pack default: {value}', { value: packLaw })}</FieldHelperText>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.venue} className={labelClass}>{t('settings.region.dispute_venue', 'Dispute resolution forum')}</FieldLabel>
              <Input id={ids.venue} maxLength={2000} value={policy.disputeVenue || ''} placeholder={packVenue} onChange={(e) => setPolicyField('disputeVenue', e.target.value || undefined)} aria-describedby={`${ids.venue}-hint`} />
              <FieldHelperText id={`${ids.venue}-hint`} className={hintClass}>{t('settings.region.pack_default', 'Pack default: {value}', { value: packVenue })}</FieldHelperText>
            </Field>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold text-foreground ">{t('settings.region.dd_title', 'Due-diligence checklist')}</h4>
            <p className={`${hintClass} mb-2`}>{t('settings.region.dd_desc', 'Items come from the core, country and industry packs. Mark items as required or hide them, and add your own.')}</p>
            <DueDiligenceChecklistEditor
              packItems={packChecklist}
              overrides={policy.ddOverrides}
              customItems={policy.customDueDiligence}
              disabled={!canEdit}
              onChange={({ overrides, customItems }) => setPolicy((prev) => ({ ...prev!, ddOverrides: overrides, customDueDiligence: customItems }))}
            />
          </div>
        </div>
      ), () => save('contracts', { policy: {
        expiryWarningDays: policy.expiryWarningDays,
        governingLaw: policy.governingLaw ?? null,
        disputeVenue: policy.disputeVenue ?? null,
        ddOverrides: ddOverridePatch(data.policy.ddOverrides, policy.ddOverrides),
        customDueDiligence: policy.customDueDiligence.map(({ key, label, required, expires }) => ({ key, label, required: Boolean(required), expires: Boolean(expires) })),
      } }), policy.expiryWarningDays >= 1 && policy.expiryWarningDays <= 730)}

      {sectionShell('notifications', <Bell className="h-5 w-5" />, t('tb.section_notifications', 'Notifications and modules'), t('tb.section_notifications_desc', 'Reminder schedule, notification recipients and the modules available in this organization.'), (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.reminders} className={labelClass}>{t('settings.region.reminders', 'Send reminders this many days before expiry')}</FieldLabel>
              <Input id={ids.reminders} value={remindersText} inputMode="numeric" aria-invalid={!remindersValid} aria-describedby={`${ids.reminders}-hint`} onChange={(e) => setRemindersText(e.target.value)} />
              <FieldErrorText id={`${ids.reminders}-hint`} className={remindersValid ? hintClass : ''}>
                {remindersValid ? t('settings.region.reminders_hint', 'Comma separated, e.g. 90, 60, 30, 14') : t('settings.region.invalid_reminders', 'Enter reminder days as whole numbers between 1 and 730.')}
              </FieldErrorText>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.list} className={labelClass}>{t('tb.recipients', 'Notification recipients')}</FieldLabel>
              <Textarea id={ids.list} rows={2} value={recipients.list} aria-invalid={!emailsValid} aria-describedby={`${ids.list}-hint`} onChange={(e) => setRecipients({ ...recipients, list: e.target.value })} />
              <FieldHelperText id={`${ids.list}-hint`} className={hintClass}>{t('tb.recipients_hint', 'Separate addresses with commas. Up to 100.')}</FieldHelperText>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.legalEmail} className={labelClass}>{t('tb.legal_recipient', 'Contract reminders (legal) recipient')}</FieldLabel>
              <Input id={ids.legalEmail} type="email" value={recipients.legal} onChange={(e) => setRecipients({ ...recipients, legal: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.financeEmail} className={labelClass}>{t('tb.finance_recipient', 'Commercial-document reminders (finance) recipient')}</FieldLabel>
              <Input id={ids.financeEmail} type="email" value={recipients.finance} onChange={(e) => setRecipients({ ...recipients, finance: e.target.value })} />
            </Field>
          </div>
          {!emailsValid && <Alert status="error" role="alert"><AlertContent>{t('tb.invalid_emails', 'One or more email addresses are not valid.')}</AlertContent></Alert>}
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold text-foreground ">{t('settings.region.modules', 'Modules')}</legend>
            <div className="grid gap-1 md:grid-cols-2">
              {moduleRows.map((row) => (
                <Checkbox checked={policy.modules[row.key]} onCheckedChange={(details) => setPolicyField('modules', { ...policy.modules, [row.key]: details.checked === true })}><CheckboxControl /><CheckboxLabel>{row.label}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
              ))}
            </div>
          </fieldset>
        </div>
      ), () => save('notifications', {
        policy: {
          reminderOffsetsDays: remindersText.split(',').map((v) => Number(v.trim())).filter((n) => n > 0),
          modules: policy.modules,
        },
        notifications: {
          notificationEmails: Array.from(new Set(splitEmails(recipients.list).map((e) => e.toLowerCase()))),
          legalNotificationEmail: recipients.legal.trim() || null,
          financeNotificationEmail: recipients.finance.trim() || null,
        },
      }), remindersValid && emailsValid)}
      {logoDialogOpen && (
        <ModalFrame onClose={() => setLogoDialogOpen(false)} className="w-full max-w-md p-5">
          <DialogTitle className="flex items-center gap-2">{t('admin.org_logo_label', 'Logo Organisasi / Workspace')}</DialogTitle>
          <LogoUploadField logo={draftLogo} name={profile.name} onChange={setDraftLogo} />
          <p className={hintClass}>{t('admin.logo_raster_type', 'PNG, JPG, WebP. Max 2 MB.')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setLogoDialogOpen(false)}>{t('admin.btn_cancel', 'Batal')}</Button>
            <Button type="button" disabled={!canEdit} onClick={() => { setProfile({ ...profile, logoUrl: draftLogo }); setLogoDialogOpen(false); }}>{t('admin.btn_apply', 'Terapkan')}</Button>
          </div>
        </ModalFrame>
      )}
    </div>
  );
};
