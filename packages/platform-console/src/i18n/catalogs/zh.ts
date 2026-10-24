import { CONTRACT_TERMINATION_TRANSLATIONS } from '@legalio/shared/i18n/contractTermination';
import { APPROVAL_TRANSLATIONS } from '../approvals';
import { DOCUMENT_CALENDAR_TRANSLATIONS } from '../documentCalendar';
import { TREE_TRANSLATIONS } from '../hierarchyTree';
import { INTEGRATION_TRANSLATIONS } from '../integrations';
import { MAILER_TRANSLATIONS } from '../mailer';
import { OBLIGATION_TRANSLATIONS } from '../obligations';
import { CHAT_SOURCE_TRANSLATIONS } from '../chatSources';
import { CLAUSE_TRANSLATIONS } from '../clauses';
import { SSO_TRANSLATIONS } from '../sso';
import { SUGGESTION_TRANSLATIONS } from '../suggestions';
import { TENANT_BOUNDARIES_TRANSLATIONS } from '../tenantBoundaries';
import { UI_REFINEMENTS } from '../uiRefinements';
import { ZH_TRANSLATIONS } from '../zh';

/** Simplified Chinese catalog. */
const ZH: Record<string, string> = {
  ...ZH_TRANSLATIONS, ...UI_REFINEMENTS.ZH, ...MAILER_TRANSLATIONS.ZH, ...DOCUMENT_CALENDAR_TRANSLATIONS.ZH,
  ...CONTRACT_TERMINATION_TRANSLATIONS.ZH, ...TENANT_BOUNDARIES_TRANSLATIONS.ZH, ...TREE_TRANSLATIONS.ZH, ...APPROVAL_TRANSLATIONS.ZH,
  ...INTEGRATION_TRANSLATIONS.ZH,
  ...OBLIGATION_TRANSLATIONS.ZH,
  ...SUGGESTION_TRANSLATIONS.ZH,
  ...CLAUSE_TRANSLATIONS.ZH,
  ...SSO_TRANSLATIONS.ZH,
  ...CHAT_SOURCE_TRANSLATIONS.ZH,
};
export default ZH;
