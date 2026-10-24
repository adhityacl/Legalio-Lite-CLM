/** Request bodies of the clause library and playbook routes. Zod drops undeclared keys, so the schema is also the whitelist. */
import { z } from 'zod';
import { CLAUSE_LANGUAGES, RISK_LEVELS, normalizeRules, validateRules } from '@legalio/shared/playbook';

const text = (max: number) => z.string().max(max);
const versionField = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d{0,9}$/)]).nullish();

export const MAX_CLAUSE_TEXT = 20_000;
export const MAX_FALLBACKS = 5;
export const MAX_TAGS = 20;

const rulesField = z.unknown().superRefine((value, ctx) => {
  for (const problem of validateRules(value)) ctx.addIssue({ code: 'custom', message: problem });
}).transform((value) => normalizeRules(value));

const fields = {
  category: text(120).nullish(),
  risk_level: z.enum(RISK_LEVELS).optional(),
  approved_text: text(MAX_CLAUSE_TEXT).nullish(),
  fallback_texts: z.array(text(MAX_CLAUSE_TEXT)).max(MAX_FALLBACKS).optional(),
  guidance: text(2000).nullish(),
  language: z.enum(CLAUSE_LANGUAGES).optional(),
  jurisdiction: text(120).nullish(),
  tags: z.array(text(60)).max(MAX_TAGS).optional(),
  rules: rulesField.optional(),
  status: z.enum(['active', 'archived']).optional(),
};
const title = text(200).refine((v) => v.trim().length > 0, 'is required');

export const clauseCreateBody = z.object({ title, ...fields });
export const clauseUpdateBody = z.object({ title: title.optional(), ...fields, version: versionField });
export const starterImportBody = z.object({ keys: z.array(text(120)).max(200).optional() });

export const playbookCheckBody = z.object({
  text: text(500_000).optional(),
  contract_id: text(100).optional(),
  ai: z.boolean().optional(),
  clause_ids: z.array(text(100)).max(200).optional(),
}).refine((v) => Boolean(v.text?.trim()) || Boolean(v.contract_id), { message: 'Provide the contract text or a contract id.' });
