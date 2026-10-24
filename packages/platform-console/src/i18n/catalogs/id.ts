import { CONTRACT_TERMINATION_TRANSLATIONS } from '@legalio/shared/i18n/contractTermination';
import { APPROVAL_TRANSLATIONS } from '../approvals';
import { DOCUMENT_CALENDAR_TRANSLATIONS } from '../documentCalendar';
import { TREE_TRANSLATIONS } from '../hierarchyTree';
import { INTEGRATION_TRANSLATIONS } from '../integrations';
import { MAILER_TRANSLATIONS } from '../mailer';
import { OBLIGATION_TRANSLATIONS } from '../obligations';
import { CLAUSE_TRANSLATIONS } from '../clauses';
import { SUGGESTION_TRANSLATIONS } from '../suggestions';
import { TENANT_BOUNDARIES_TRANSLATIONS } from '../tenantBoundaries';
import { UI_REFINEMENTS } from '../uiRefinements';
import { BASE_ID } from './base.id';
import { EXTRA_ID } from './extra.id';

/** Indonesian catalog: base keys, then newer feature keys (later spreads win on conflict). */
const ID: Record<string, string> = {
  ...BASE_ID, ...EXTRA_ID, ...UI_REFINEMENTS.ID, ...MAILER_TRANSLATIONS.ID, ...DOCUMENT_CALENDAR_TRANSLATIONS.ID,
  ...CONTRACT_TERMINATION_TRANSLATIONS.ID, ...TENANT_BOUNDARIES_TRANSLATIONS.ID, ...TREE_TRANSLATIONS.ID, ...APPROVAL_TRANSLATIONS.ID,
  ...INTEGRATION_TRANSLATIONS.ID,
  ...OBLIGATION_TRANSLATIONS.ID,
  ...SUGGESTION_TRANSLATIONS.ID,
  ...CLAUSE_TRANSLATIONS.ID,
};
export default ID;
