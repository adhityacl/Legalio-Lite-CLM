import { findTenant } from './tenantPolicy';
import { resolveTenantSettings, getCountryPack, getIndustryPack, buildDueDiligenceChecklist } from '@legalio/shared/policy';
/** The tenant settings document returned to clients: runtime policy resolved for one organization. */


export function tenantSettingsPayload(tenantId: string) {
  const tenant = findTenant(tenantId);
  const settings = resolveTenantSettings(tenant);
  const country = getCountryPack(settings.countryCode);
  const industry = getIndustryPack(settings.industry);
  return {
    tenantId: tenant?.id || tenantId,
    tenantName: tenant?.name || "",
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
    dueDiligenceChecklist: buildDueDiligenceChecklist(settings, { includeDisabled: true }),
  };
}
