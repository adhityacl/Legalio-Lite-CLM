import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, Loader2, Users } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { listCountryPacks, listIndustryPacks, localize, localizeName } from '@legalio/shared/policy';
import { useIdentity } from '../../context/AuthContext';
import { LANGUAGE_OPTIONS, useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { AlphabeticalSelect } from '../ui/alphabetical-select';
import { capturePendingInvitation } from './InvitationPrompt';

import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Alert, AlertContent } from '@legalio/ui-components/alert';

export function OrganizationOnboarding() {
  const { t, language } = useLanguage();
  const { logout, refreshUser } = useIdentity();
  const { refreshTenants } = useTenant();
  const [code, setCode] = useState(() => capturePendingInvitation() || '');
  const [stage, setStage] = useState<'choose' | 'join' | 'profile' | 'region'>(() => code ? 'join' : 'choose');
  const [profile, setProfile] = useState({ name: '', legalEntity: '', brandName: '' });
  const [region, setRegion] = useState({ countryCode: '', industry: '', language });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  useEffect(() => { heading.current?.focus(); }, [stage]);

  const title = stage === 'choose' ? t('onboarding.title', 'Set up your organization')
    : stage === 'join' ? t('onboarding.join', 'Join organization')
    : stage === 'profile' ? t('tb.section_profile', 'Organization profile') : t('tb.section_region', 'Region and formatting');
  const navigate = (next: typeof stage) => { setError(''); setStage(next); };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stage === 'profile') { navigate('region'); return; }
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetch(stage === 'join' ? `/api/invitations/${encodeURIComponent(code.trim())}/accept` : '/api/me/organization', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        ...(stage === 'region' ? { body: JSON.stringify({ ...profile, ...region }) } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.error === 'INVITATION_IDENTITY_MISMATCH' ? t('tb.invitation_other_account', 'This invitation was sent to a different account. Sign in with the invited email address.')
          : stage === 'join' && [404, 409].includes(response.status) ? t('onboarding.invalid_invite', 'This invite code is invalid, expired, or already used. Ask an administrator for a new invitation.')
          : data.message || t('onboarding.failed', 'Unable to set up your organization. Please try again.');
        throw new Error(message);
      }
      if (stage === 'join') { try { sessionStorage.removeItem('pendingInvitation'); } catch { /* storage unavailable */ } }
      await refreshUser();
      // The provider validates and selects the sole new membership for this tab.
      await refreshTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.failed', 'Unable to set up your organization. Please try again.'));
    } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-(--background) px-4 py-8 text-(--foreground)">
      <section aria-labelledby="onboarding-title" className="w-full max-w-xl rounded-2xl border border-(--border) bg-(--card) p-6 shadow-sm sm:p-8">
        {(stage === 'profile' || stage === 'region') && (
          <ol aria-label={t('onboarding.progress', 'Organization setup progress')} className="mb-6 grid grid-cols-2 gap-3 text-sm">
            {[['profile', t('tb.section_profile', 'Organization profile')], ['region', t('tb.section_region', 'Region and formatting')]].map(([step, label], index) => (
              <li key={step} aria-current={stage === step ? 'step' : undefined} className={`border-t-2 pt-2 ${stage === step ? 'border-(--primary) font-semibold' : 'border-(--border) text-(--muted-foreground)'}`}>{index + 1}. {label}</li>
            ))}
          </ol>
        )}
        <h1 id="onboarding-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-none">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-(--muted-foreground)">
          {stage === 'choose' ? t('onboarding.description', 'Join your team with an invite code, or create an organization to get started.')
            : stage === 'join' ? t('onboarding.join_description', 'Enter the invite code shared by your organization administrator. Codes expire after 24 hours.')
            : stage === 'profile' ? t('onboarding.profile_description', 'Tell us about your organization. You will be its first administrator.')
            : t('onboarding.region_description', 'Choose the country, industry, and language for your workspace.')}
        </p>
        {stage === 'choose' ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {([{ next: 'join', Icon: Users, label: t('onboarding.join', 'Join organization'), description: t('onboarding.join_hint', 'I have an invite code') },
              { next: 'profile', Icon: Building2, label: t('onboarding.create', 'Create organization'), description: t('onboarding.create_hint', 'Start a new workspace') }] as const).map(({ next, Icon, label, description }) => (
              <Button variant="outline" key={next} type="button" aria-label={label} onClick={() => navigate(next)} className="text-left">
                <Icon aria-hidden="true" className="mb-4 h-6 w-6 text-(--muted-foreground)" />
                <span className="block font-semibold">{label}</span><span className="mt-1 block text-sm text-(--muted-foreground)">{description}</span>
              </Button>
            ))}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy}>
            <fieldset disabled={busy} className="space-y-4">
              <legend className="sr-only">{title}</legend>
              {stage === 'join' ? (
                <Field><FieldLabel htmlFor="invite-code">{t('onboarding.invite_code', 'Invite code')}</FieldLabel>
                  <Input id="invite-code" value={code} onChange={(e) => setCode(e.target.value)} required pattern=".*\S.*" maxLength={128} autoComplete="off" spellCheck={false} aria-describedby={error ? 'onboarding-error' : undefined} /></Field>
              ) : stage === 'profile' ? (
                ([['name', t('tb.org_name', 'Organization name')], ['legalEntity', t('tb.legal_entity', 'Legal entity')], ['brandName', t('tb.brand_name', 'Brand name')]] as const).map(([key, label]) => (
                  <Field key={key}><FieldLabel htmlFor={`onboarding-${key}`}>{label}</FieldLabel>
                    <Input id={`onboarding-${key}`} value={profile[key]} onChange={(e) => setProfile({ ...profile, [key]: e.target.value })} required pattern=".*\S.*" maxLength={200} autoComplete={key === 'name' ? 'organization' : 'off'} /></Field>
                ))
              ) : (
                <>
                  <div><label htmlFor="onboarding-country" className="mb-2 block text-sm font-medium">{t('onboarding.country', 'Country')}</label>
                    <AlphabeticalSelect id="onboarding-country" value={region.countryCode} onChange={(e) => setRegion({ ...region, countryCode: e.target.value })} required>
                      <option value="">{t('onboarding.select_country', 'Select a country')}</option>
                      {listCountryPacks().map((country) => <option key={country.code} value={country.code}>{localizeName(country.name, language)}</option>)}
                    </AlphabeticalSelect></div>
                  <div><label htmlFor="onboarding-industry" className="mb-2 block text-sm font-medium">{t('onboarding.industry', 'Industry')}</label>
                    <AlphabeticalSelect id="onboarding-industry" value={region.industry} onChange={(e) => setRegion({ ...region, industry: e.target.value })} required>
                      <option value="">{t('onboarding.select_industry', 'Select an industry')}</option>
                      {listIndustryPacks().map((industry) => <option key={industry.key} value={industry.key}>{localize(industry.name, language)}</option>)}
                    </AlphabeticalSelect></div>
                  <Field><FieldLabel htmlFor="onboarding-language">{t('onboarding.language', 'Language')}</FieldLabel>
                    <NativeSelect id="onboarding-language" value={region.language} onChange={(e) => setRegion({ ...region, language: e.target.value as typeof language })} required>
                      {LANGUAGE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}
                    </NativeSelect></Field>
                </>
              )}
            </fieldset>
            {error && <Alert status="error" id="onboarding-error" role="alert"><AlertContent>{error}</AlertContent></Alert>}
            <div className="flex justify-between gap-3 pt-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => navigate(stage === 'region' ? 'profile' : 'choose')}>{t('onboarding.back', 'Back')}</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                {stage === 'profile' ? t('onboarding.continue', 'Continue') : stage === 'join' ? t('onboarding.join', 'Join organization') : t('onboarding.create', 'Create organization')}
                {stage === 'profile' && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        )}
        <div className="mt-6 border-t border-(--border) pt-4"><Button type="button" variant="ghost" disabled={busy} onClick={() => void logout()}>{t('app.kembali_ke_login', 'Back to login')}</Button></div>
      </section>
    </main>
  );
}
