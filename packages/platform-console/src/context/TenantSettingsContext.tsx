import React, { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@legalio/shared/apiClient';
import { useIdentity } from './AuthContext';
import { useTenant } from './TenantContext';
import { useLanguage } from './LanguageContext';
import {
  defaultTenantSettings,
  formattingLocaleFor,
  getCountryPack,
  getIndustryPack,
  getPolicyPacksVersion,
  loadPolicyPacks,
  subscribePolicyPacks,
  type CommercialDocumentProfile,
  type CounterpartyType,
  type DueDiligenceRequirement,
  type IdentifierScheme,
  type LocalizedText,
  type TenantSettings,
} from '@legalio/shared/policy';
import { setActiveFormattingLocale } from '@legalio/shared/currencyUtils';

export interface CountryOption {
  code: string;
  name: string;
  region: string;
  defaultCurrency: string;
  timezone: string;
  legalForms: string[];
  identifierSchemes: IdentifierScheme[];
}

export interface IndustryOption {
  key: string;
  name: LocalizedText;
  partnerCategories: string[];
  commercialDocument: CommercialDocumentProfile;
  counterpartyTypes: CounterpartyType[];
  contractCurrency: string | null;
}

export interface TenantPolicyView {
  tenantId: string;
  tenantName: string;
  settings: TenantSettings;
  country: {
    code: string;
    name: string;
    legalForms: string[];
    identifierSchemes: IdentifierScheme[];
    governingLaw: LocalizedText;
    disputeVenue: LocalizedText;
    dataProtectionLaw: string;
    indirectTaxName: string;
    stampDutyConvention: LocalizedText | null;
    weekend: number[];
    callingCode: string;
    formattingLocale: string;
  };
  industry: IndustryOption;
  dueDiligenceChecklist: Array<DueDiligenceRequirement & { disabled?: boolean }>;
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TenantSettingsContextValue {
  status: LoadStatus;
  policy: TenantPolicyView;
  countries: CountryOption[];
  industries: IndustryOption[];
  /** Commercial document profile of the active tenant (e.g. Order Form, Purchase Order). */
  commercialDocument: CommercialDocumentProfile;
  refresh: () => Promise<void>;
  saveSettings: (settings: Partial<TenantSettings>, legalEntity?: string) => Promise<TenantPolicyView>;
}

/** Offline fallback built from bundled packs, used until the server answers. */
function localPolicyView(settings: TenantSettings = defaultTenantSettings()): TenantPolicyView {
  const country = getCountryPack(settings.countryCode);
  const industry = getIndustryPack(settings.industry);
  return {
    tenantId: '',
    tenantName: '',
    settings,
    country: {
      code: country.code,
      name: country.name,
      legalForms: country.legalForms,
      identifierSchemes: country.identifierSchemes,
      governingLaw: country.governingLaw,
      disputeVenue: country.disputeVenue,
      dataProtectionLaw: country.dataProtectionLaw,
      indirectTaxName: country.indirectTaxName,
      stampDutyConvention: country.stampDutyConvention || null,
      weekend: country.weekend,
      callingCode: country.callingCode,
      formattingLocale: country.formattingLocale,
    },
    industry: {
      key: industry.key,
      name: industry.name,
      partnerCategories: industry.partnerCategories,
      commercialDocument: industry.commercialDocument,
      counterpartyTypes: industry.counterpartyTypes,
      contractCurrency: industry.contractCurrency || null,
    },
    dueDiligenceChecklist: [],
  };
}

const TenantSettingsContext = createContext<TenantSettingsContextValue | undefined>(undefined);

/**
 * Starts loading the industry packs and pack translations (a separate chunk in the browser build) once someone is signed in, and
 * returns a counter that changes when they arrive, so everything that reads pack data re-renders with the real texts.
 */
function usePolicyPacks(enabled: boolean): number {
  useEffect(() => {
    if (enabled) loadPolicyPacks().catch((error) => console.warn('Failed to load the policy packs:', error));
  }, [enabled]);
  return useSyncExternalStore(subscribePolicyPacks, getPolicyPacksVersion, getPolicyPacksVersion);
}

export const TenantSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const { language, setDocumentTerminology } = useLanguage();
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [policy, setPolicy] = useState<TenantPolicyView>(() => localPolicyView());
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const packsVersion = usePolicyPacks(Boolean(identity));
  const currentOrg = React.useRef(activeTenantId);
  currentOrg.current = activeTenantId;

  /** Runtime policy of the selected organization only; responses for a previous selection are dropped. */
  const refresh = useCallback(async () => {
    const organizationId = activeTenantId;
    if (!identity || !organizationId) {
      setPolicy(localPolicyView());
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const [next, packs] = await Promise.all([
        api.get<TenantPolicyView>(`/organizations/${encodeURIComponent(organizationId)}/policy`, { cache: 'no-store' }),
        api.get<{ countries?: CountryOption[]; industries?: IndustryOption[] }>('/policy-packs', { cache: 'no-cache' }).catch(() => null),
      ]);
      if (currentOrg.current !== organizationId || next.tenantId !== organizationId) return;
      setPolicy(next);
      if (packs) {
        setCountries(Array.isArray(packs.countries) ? packs.countries : []);
        setIndustries(Array.isArray(packs.industries) ? packs.industries : []);
      }
      setStatus('ready');
    } catch (err) {
      if (currentOrg.current !== organizationId) return;
      console.warn('Failed to load organization settings:', err);
      setStatus('error');
    }
  }, [identity, activeTenantId]);

  useEffect(() => {
    void refresh();
    const onUpdated = () => { void refresh(); };
    window.addEventListener('organization-updated', onUpdated);
    return () => window.removeEventListener('organization-updated', onUpdated);
  }, [refresh]);

  // Until the server's view arrives, the bundled packs describe the organization; re-read them when the lazy packs are in.
  useEffect(() => {
    if (status !== 'ready') setPolicy((current) => (current.tenantId ? current : localPolicyView(current.settings)));
  }, [packsVersion, status]);

  // UI terminology for commercial documents follows the industry pack.
  const profile = policy.industry.commercialDocument;
  useEffect(() => {
    setDocumentTerminology({ doc: profile.label, docs: profile.plural, docShort: profile.prefix });
  }, [profile.label, profile.plural, profile.prefix, setDocumentTerminology]);

  // Number/date formatting follows the UI language and the tenant's country. Set
  // synchronously during render (not in an effect) so it's already up to date
  // before any consumer below in the tree reads getActiveFormattingLocale() in
  // the same pass — an effect runs one tick too late and consumers render with
  // the previous language's locale until something else forces a re-render.
  setActiveFormattingLocale(formattingLocaleFor(language, policy.settings.countryCode));

  /** Section save through the canonical settings service (expectedVersion from a fresh read). */
  const saveSettings = useCallback(async (settings: Partial<TenantSettings>, legalEntity?: string) => {
    const organizationId = activeTenantId;
    const base = `/api/organizations/${encodeURIComponent(organizationId)}/settings`;
    const current = await api.get<{ version: number }>(base, { cache: 'no-store' });
    await api.patch(base, {
      expectedVersion: current.version,
      policy: settings,
      ...(legalEntity !== undefined ? { profile: { legalEntity } } : {}),
    });
    window.dispatchEvent(new CustomEvent('organization-updated'));
    await refresh();
    return policy;
  }, [activeTenantId, refresh, policy]);

  return (
    <TenantSettingsContext.Provider
      value={{
        status,
        policy,
        countries,
        industries,
        commercialDocument: policy.industry.commercialDocument,
        refresh,
        saveSettings,
      }}
    >
      {children}
    </TenantSettingsContext.Provider>
  );
};

/** Platform forms need the global catalogs, without an active organization. */
export function PolicyCatalogProvider({ children }: { children: React.ReactNode }) {
  const { identity } = useIdentity();
  const { language } = useLanguage();
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  usePolicyPacks(Boolean(identity));
  const refresh = useCallback(async () => {
    if (!identity || identity.platformRole !== 'superuser') return;
    try {
      const packs = await api.get<any>('/policy-packs', { cache: 'no-cache' });
      setCountries(packs.countries || []);
      setIndustries(packs.industries || []);
      setStatus('ready');
    } catch { setStatus('error'); }
  }, [identity?.id, identity?.platformRole]);
  useEffect(() => { void refresh(); }, [refresh]);
  const policy = localPolicyView();
  setActiveFormattingLocale(formattingLocaleFor(language, policy.settings.countryCode));
  return <TenantSettingsContext.Provider value={{ status, policy, countries, industries, commercialDocument: policy.industry.commercialDocument, refresh, saveSettings: async () => { throw new Error('Select an organization in the workspace to edit its settings.'); } }}>{children}</TenantSettingsContext.Provider>;
}

export function useTenantSettings(): TenantSettingsContextValue {
  const ctx = useContext(TenantSettingsContext);
  if (!ctx) throw new Error('useTenantSettings must be used within a TenantSettingsProvider');
  return ctx;
}
