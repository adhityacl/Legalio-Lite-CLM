import {
  CORE_DUE_DILIGENCE, listCountryPacks, listIndustryPacks, localize, matchesRequirement,
  type DueDiligenceRequirement, type UiLanguage,
} from './policy/index';

/** Translate the checklist label without changing the stored upload identifier or filename. */
export function localizeDueDiligenceDocument(
  document: { key?: string; name: string },
  checklist: DueDiligenceRequirement[],
  language: UiLanguage,
): string {
  // Retained evidence may belong to a pack that is no longer selected by the tenant.
  const requirements = [
    ...checklist,
    ...CORE_DUE_DILIGENCE,
    ...listCountryPacks().flatMap(pack => pack.dueDiligence),
    ...listIndustryPacks().flatMap(pack => pack.dueDiligence),
  ];
  const keyMatches = document.key ? requirements.filter(item => item.key === document.key) : [];
  const requirement = document.key
    ? checklist.find(item => item.key === document.key)
      || keyMatches.find(item => matchesRequirement(item, { name: document.name }))
      || keyMatches[0]
    : requirements.find(item => matchesRequirement(item, document));
  return requirement ? localize(requirement.label, language) : document.name;
}

/** Termination evidence belongs to contract status, not the partner checklist. */
export function isTerminationNoticeDocument(document: { key?: string; name?: string }): boolean {
  if (document.key === 'termination_notice') return true;
  const name = (document.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ['termination notice', 'surat pemberitahuan pengakhiran', '终止通知'].includes(name);
}
