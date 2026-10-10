/**
 * Policy pack contracts (PRD §2.1, §4.2).
 *
 * Core code must never hardcode a country, currency, regulator, or industry
 * vocabulary. Anything that differs between jurisdictions or industries is
 * described here as data and resolved per tenant at runtime.
 */

export type IndustryKey =
  | 'p2p_lending'
  | 'payment_gateway'
  | 'banking_investment'
  | 'b2b_saas'
  | 'it_development'
  | 'influencer_kol'
  | 'media_creative'
  | 'hospitals_medical'
  | 'healthtech_telemedicine'
  | 'marketplace'
  | 'retail_franchise'
  | 'consumer_omnichannel'
  | 'legal_consulting'
  | 'digital_agency'
  | 'headhunting_recruitment'
  | 'freight_logistics'
  | 'cold_chain_storage'
  | 'delivery_fleet'
  | 'public_transportation'
  | 'renewable_energy'
  | 'oil_gas'
  | 'water_sanitation'
  | 'education_research'
  | 'philanthropy_donations'
  | 'ngo_humanitarian'
  | 'office_procurement'
  | 'property_rental'
  | 'freelance_workforce'
  | 'general';

export type CounterpartyType = 'organization' | 'individual';

export type SensitivityLevel = 'internal' | 'confidential' | 'restricted';

export interface LocalizedText {
  en: string;
  id?: string;
  /** Simplified Chinese. */
  zh?: string;
}

/** UI languages (ZH = Simplified Chinese). */
export type UiLanguage = 'EN' | 'ID' | 'ZH';

/** A tax, registration, or personal identifier scheme issued in a country. */
export interface IdentifierScheme {
  /** Stable key, e.g. `sg_uen`. Stored on partner identifiers. */
  key: string;
  label: string;
  category: 'tax' | 'registration' | 'personal' | 'other';
  appliesTo: Array<'organization' | 'individual'>;
  /** Optional format hint only — core never hard-validates (PRD §3.2.2). */
  pattern?: string;
  example?: string;
  sensitivity: SensitivityLevel;
}

/** One due-diligence evidence item a policy pack asks for. */
export interface DueDiligenceRequirement {
  /** Stable key, e.g. `certificate_of_incorporation`. */
  key: string;
  label: LocalizedText;
  required: boolean;
  /** The document normally carries an expiry date that must be tracked. */
  expires?: boolean;
  /** Legacy/alternate names used to match previously stored documents. */
  aliases?: string[];
  /** Only relevant when the counterparty is incorporated outside the tenant's country. */
  foreignCounterpartyOnly?: boolean;
  source?: 'core' | 'country' | 'industry' | 'tenant';
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2, or `INTL` for the jurisdiction-neutral pack. */
  code: string;
  name: string;
  region: 'Southeast Asia' | 'South Asia' | 'East Asia' | 'Middle East' | 'International';
  /** ISO 4217. */
  defaultCurrency: string;
  /** BCP 47 locale used for number/date formatting. */
  formattingLocale: string;
  /** IANA timezone. */
  timezone: string;
  /** Days of week that are not business days (0 = Sunday). */
  weekend: number[];
  /** E.164 country calling code without `+`. */
  callingCode: string;
  legalForms: string[];
  identifierSchemes: IdentifierScheme[];
  dueDiligence: DueDiligenceRequirement[];
  governingLaw: LocalizedText;
  disputeVenue: LocalizedText;
  dataProtectionLaw: string;
  /** Name of the consumption tax, e.g. VAT, GST, SST. */
  indirectTaxName: string;
  /** Wet-ink stamp duty convention applies to executed paper copies. */
  stampDutyConvention?: LocalizedText;
  /** Regulators an AI reviewer should consider, per industry. */
  regulators?: Partial<Record<IndustryKey, string[]>>;
}

export interface CommercialDocumentProfile {
  /** Singular label, e.g. "Insertion Order", "Purchase Order". */
  label: string;
  plural: string;
  /** Short prefix for generated numbers, e.g. IO, PO, SOW. */
  prefix: string;
  pricingModels: string[];
  /** Label for the free-text "channel/scope" field. */
  channelLabel: string;
  channelPlaceholder: string;
}

/** A clause the contract reviewer must check, and the rule that flags it. */
export interface CriticalClause {
  clause: LocalizedText;
  /** Rule-engine condition, phrased as "Flag if …". */
  rule: LocalizedText;
}

export interface IndustryPack {
  key: IndustryKey;
  name: LocalizedText;
  /** Core agreements this industry signs with its counterparties. */
  coreDocuments: LocalizedText[];
  /** Partner / third-party entity types. */
  partnerCategories: string[];
  /** Due-diligence and onboarding evidence. */
  dueDiligence: DueDiligenceRequirement[];
  /** Jurisdiction-neutral regulatory frameworks and standards; country packs add the regulators. */
  complianceStandards: string[];
  /** Clauses and flagging rules used by the AI contract reviewer. */
  criticalClauses: CriticalClause[];
  /** Who counterparties usually are; selects which identifier schemes partners are asked for. */
  counterpartyTypes: CounterpartyType[];
  /** Contract currency convention (ISO 4217) when it differs from the country default. */
  contractCurrency?: string;
  taxConsiderations: LocalizedText[];
  commercialDocument: CommercialDocumentProfile;
  /** Topic used by the optional dashboard news ticker. */
  newsTopic: string;
}

export interface TenantModules {
  commercialDocuments: boolean;
  spending: boolean;
  evaluation: boolean;
  aiAssistant: boolean;
  newsTicker: boolean;
}

export interface DueDiligenceOverride {
  required?: boolean;
  disabled?: boolean;
}

/** Tenant-level configuration. Everything is optional; packs supply defaults. */
export interface TenantSettings {
  countryCode: string;
  industry: IndustryKey;
  /** Language for generated e-mails, AI answers and document titles. */
  language: 'EN' | 'ID' | 'ZH';
  timezone: string;
  defaultCurrency: string;
  reportingCurrency: string;
  /** A contract is "expiring" when this many days or fewer remain. */
  expiryWarningDays: number;
  /** Days-before-expiry at which reminders are sent. */
  reminderOffsetsDays: number[];
  modules: TenantModules;
  /** Optional overrides of the pack-provided governing law / venue text. */
  governingLaw?: string;
  disputeVenue?: string;
  ddOverrides: Record<string, DueDiligenceOverride>;
  customDueDiligence: DueDiligenceRequirement[];
}
