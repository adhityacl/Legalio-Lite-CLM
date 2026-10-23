import { accountApi } from '../../api/account';
import { errorMessage, isApiError } from '../../api/client';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Loader2, Users } from 'lucide-react';
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
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';

import { Heading } from '@legalio/ui-components/heading';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Spinner } from '@legalio/ui-components/spinner';
import { Card } from '@legalio/ui-components/card';
import { Text } from '@legalio/ui-components/text';
import { List, ListItem } from '@legalio/ui-components/list';
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
      try {
        if (stage === 'join') await accountApi.acceptInvitation(code.trim());
        else await accountApi.createOrganization(stage === 'region' ? { ...profile, ...region } : {});
      } catch (failure) {
        const status = isApiError(failure) ? failure.status : 0;
        const message = isApiError(failure) && failure.error === 'INVITATION_IDENTITY_MISMATCH' ? t('tb.invitation_other_account', 'This invitation was sent to a different account. Sign in with the invited email address.')
          : stage === 'join' && [404, 409].includes(status) ? t('onboarding.invalid_invite', 'This invite code is invalid, expired, or already used. Ask an administrator for a new invitation.')
          : errorMessage(failure, t('onboarding.failed', 'Unable to set up your organization. Please try again.'));
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
    <main className="flex h-dvh w-full flex-col overflow-y-auto bg-(--moduix-color-background) px-g13 py-g21 text-(--moduix-color-foreground) sm:py-g34">
      <Card asChild><section aria-labelledby="onboarding-title" className="mx-auto my-auto w-full max-w-g610 shrink-0 p-g21 sm:p-g34">
        {(stage === 'profile' || stage === 'region') && (
          <List as="ol" size="sm" marker="none" aria-label={t('onboarding.progress', 'Organization setup progress')} className="mb-g21 grid grid-cols-2 gap-g13">
            {[['profile', t('tb.section_profile', 'Organization profile')], ['region', t('tb.section_region', 'Region and formatting')]].map(([step, label], index) => (
              <ListItem key={step} aria-current={stage === step ? 'step' : undefined} className={`border-t-2 pt-g8 ${stage === step ? 'border-(--moduix-color-primary) font-semibold' : 'border-(--moduix-color-border) text-(--moduix-color-muted-foreground)'}`}>{index + 1}. {label}</ListItem>
            ))}
          </List>
        )}
        <Heading as="h1" size="xl" weight="semibold" id="onboarding-title" ref={heading} tabIndex={-1} className="focus:outline-none">{title}</Heading>
        <Text size="sm" className="mt-g8 leading-6 text-(--moduix-color-muted-foreground)">
          {stage === 'choose' ? t('onboarding.description', 'Join your team with an invite code, or create an organization to get started.')
            : stage === 'join' ? t('onboarding.join_description', 'Enter the invite code shared by your organization administrator. Codes expire after 24 hours.')
            : stage === 'profile' ? t('onboarding.profile_description', 'Tell us about your organization. You will be its first administrator.')
            : t('onboarding.region_description', 'Choose the country, industry, and language for your workspace.')}
        </Text>
        {stage === 'choose' ? (
          <div className="mt-g21 grid gap-g13 sm:grid-cols-2">
            {([{ next: 'join', Icon: Users, label: t('onboarding.join', 'Join organization'), description: t('onboarding.join_hint', 'I have an invite code') },
              { next: 'profile', Icon: Building2, label: t('onboarding.create', 'Create organization'), description: t('onboarding.create_hint', 'Start a new workspace') }] as const).map(({ next, Icon, label, description }) => (
              <Button variant="outline" key={next} type="button" aria-label={label} onClick={() => navigate(next)} className="h-auto min-h-g144 w-full flex-col items-start justify-start gap-g13 whitespace-normal p-g21 text-left hover:border-primary/50 hover:bg-primary/5">
                <span className="flex size-g42 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden="true" className="size-g21" />
                </span>
                <span className="flex w-full min-w-0 flex-col gap-g5">
                  <span className="font-semibold wrap-anywhere">{label}</span>
                  <span className="text-sm font-normal text-(--moduix-color-muted-foreground) wrap-anywhere">{description}</span>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-g21 space-y-g13" aria-busy={busy}>
            <Fieldset disabled={busy} className="space-y-g13">
              <FieldsetLegend className="sr-only">{title}</FieldsetLegend>
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
                  <Field><FieldLabel htmlFor="onboarding-country">{t('onboarding.country', 'Country')}</FieldLabel>
                    <AlphabeticalSelect id="onboarding-country" value={region.countryCode} onChange={(e) => setRegion({ ...region, countryCode: e.target.value })} required>
                      <option value="">{t('onboarding.select_country', 'Select a country')}</option>
                      {listCountryPacks().map((country) => <option key={country.code} value={country.code}>{localizeName(country.name, language)}</option>)}
                    </AlphabeticalSelect></Field>
                  <Field><FieldLabel htmlFor="onboarding-industry">{t('onboarding.industry', 'Industry')}</FieldLabel>
                    <AlphabeticalSelect id="onboarding-industry" value={region.industry} onChange={(e) => setRegion({ ...region, industry: e.target.value })} required>
                      <option value="">{t('onboarding.select_industry', 'Select an industry')}</option>
                      {listIndustryPacks().map((industry) => <option key={industry.key} value={industry.key}>{localize(industry.name, language)}</option>)}
                    </AlphabeticalSelect></Field>
                  <Field><FieldLabel htmlFor="onboarding-language">{t('onboarding.language', 'Language')}</FieldLabel>
                    <NativeSelect id="onboarding-language" value={region.language} onChange={(e) => setRegion({ ...region, language: e.target.value as typeof language })} required>
                      {LANGUAGE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}
                    </NativeSelect></Field>
                </>
              )}
            </Fieldset>
            {error && <Alert status="error" id="onboarding-error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
            <div className="flex justify-between gap-g13 pt-g8">
              <Button type="button" variant="secondary" className="border-muted-foreground/70" disabled={busy} onClick={() => navigate(stage === 'region' ? 'profile' : 'choose')}><ArrowLeft aria-hidden="true" className="size-g16" />{t('onboarding.back', 'Back')}</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner size="sm" decorative />}
                {stage === 'profile' ? t('onboarding.continue', 'Continue') : stage === 'join' ? t('onboarding.join', 'Join organization') : t('onboarding.create', 'Create organization')}
                {stage === 'profile' && <ArrowRight aria-hidden="true" className="h-g16 w-g16" />}
              </Button>
            </div>
          </form>
        )}
        <div className="mt-g21"><Button type="button" variant="destructive" disabled={busy} onClick={() => void logout()}><ArrowLeft aria-hidden="true" className="size-g16" />{t('app.kembali_ke_login', 'Back to login')}</Button></div>
      </section></Card>
    </main>
  );
}
