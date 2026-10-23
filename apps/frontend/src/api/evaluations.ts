import type { PartnerEvaluation } from '@legalio/types';
import { createRecordApi } from './records';

export const evaluationsApi = createRecordApi<PartnerEvaluation, 'evaluation'>('/partner-evaluations', 'evaluation');
