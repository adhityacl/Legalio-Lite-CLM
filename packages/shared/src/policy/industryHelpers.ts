import type {
  CommercialDocumentProfile,
  CriticalClause,
  DueDiligenceRequirement,
  IndustryKey,
  IndustryPack,
  LocalizedText,
} from '@legalio/types/policy';

/** Builders shared by the industry packs (the general pack loads with the core; the others lazily in the browser). */
export const t = (en: string, id: string): LocalizedText => ({ en, id });

export const doc = (key: string, en: string, id: string, opts: Partial<DueDiligenceRequirement> = {}): DueDiligenceRequirement => ({
  key,
  label: { en, id },
  required: false,
  source: 'industry',
  ...opts,
});

export const clause = (enClause: string, idClause: string, enRule: string, idRule: string): CriticalClause => ({
  clause: { en: enClause, id: idClause },
  rule: { en: enRule, id: idRule },
});

export const order = (
  label: string,
  plural: string,
  prefix: string,
  pricingModels: string[],
  channelLabel: string,
  channelPlaceholder: string,
): CommercialDocumentProfile => ({ label, plural, prefix, pricingModels, channelLabel, channelPlaceholder });

export const GENERIC_PRICING = ['Fixed Fee', 'Time & Materials', 'Milestone-based', 'Subscription', 'Unit Price', 'Revenue Share'];

/**
 * Industry keys used before the pack list was made industry-specific. Stored tenant
 * settings still carry them, so they resolve to their closest successor pack.
 */
export const LEGACY_INDUSTRY_KEYS: Record<string, IndustryKey> = {
  financial_services: 'p2p_lending',
  technology: 'b2b_saas',
  healthcare: 'hospitals_medical',
  manufacturing: 'general',
  retail: 'retail_franchise',
  media_advertising: 'media_creative',
  professional_services: 'legal_consulting',
  logistics: 'freight_logistics',
  energy: 'oil_gas',
  education: 'education_research',
  nonprofit: 'ngo_humanitarian',
};

