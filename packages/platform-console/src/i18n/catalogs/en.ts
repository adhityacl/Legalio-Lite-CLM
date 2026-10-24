import { CONTRACT_TERMINATION_TRANSLATIONS } from '@legalio/shared/i18n/contractTermination';
import { APPROVAL_TRANSLATIONS } from '../approvals';
import { DOCUMENT_CALENDAR_TRANSLATIONS } from '../documentCalendar';
import { TREE_TRANSLATIONS } from '../hierarchyTree';
import { INTEGRATION_TRANSLATIONS } from '../integrations';
import { MAILER_TRANSLATIONS } from '../mailer';
import { OBLIGATION_TRANSLATIONS } from '../obligations';
import { SUGGESTION_TRANSLATIONS } from '../suggestions';
import { TENANT_BOUNDARIES_TRANSLATIONS } from '../tenantBoundaries';
import { UI_REFINEMENTS } from '../uiRefinements';
import { BASE_EN } from './base.en';
import { EXTRA_EN } from './extra.en';

/** English catalog: base keys, then newer feature keys (later spreads win on conflict). */
const EN: Record<string, string> = {
  ...BASE_EN, ...EXTRA_EN, ...UI_REFINEMENTS.EN, ...MAILER_TRANSLATIONS.EN, ...DOCUMENT_CALENDAR_TRANSLATIONS.EN,
  ...CONTRACT_TERMINATION_TRANSLATIONS.EN, ...TENANT_BOUNDARIES_TRANSLATIONS.EN, ...TREE_TRANSLATIONS.EN, ...APPROVAL_TRANSLATIONS.EN,
  ...INTEGRATION_TRANSLATIONS.EN,
  ...OBLIGATION_TRANSLATIONS.EN,
  ...SUGGESTION_TRANSLATIONS.EN,
};
export default EN;
