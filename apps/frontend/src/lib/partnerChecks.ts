import type { DDDokumenItem, Partner, PartyIdentifier } from '@legalio/types';

export interface PartnerCheck {
  key: 'name' | 'identifier' | 'identifier_country' | 'email' | 'dd_expiring';
  status: 'warn' | 'fail';
  /** Document count for the DD check. */
  count?: number;
}

export interface PartnerDraft {
  partner_id?: string; partner_name: string; country: string; pic_email: string;
  identifiers: PartyIdentifier[]; dd_documents?: DDDokumenItem[];
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const addDays = (isoDate: string, days: number) => new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10);

/** Rule checks for the partner form (no AI); only problems are returned. `today` is YYYY-MM-DD. */
export function partnerChecks(draft: PartnerDraft, partners: Partner[], today: string): PartnerCheck[] {
  const others = partners.filter((p) => p.partner_id !== draft.partner_id);
  const checks: PartnerCheck[] = [];
  const name = norm(draft.partner_name);
  if (name && others.some((p) => norm(p.partner_name || '') === name)) checks.push({ key: 'name', status: 'fail' });

  const ids = draft.identifiers.filter((i) => i.value.trim());
  const idKey = (i: PartyIdentifier) => `${i.scheme}:${norm(i.value)}`;
  const taken = new Set(others.flatMap((p) => (p.identifiers || []).filter((i) => i.value?.trim()).map(idKey)));
  if (ids.some((i) => taken.has(idKey(i)))) checks.push({ key: 'identifier', status: 'fail' });
  if (draft.country && ids.some((i) => i.country && i.country !== draft.country)) checks.push({ key: 'identifier_country', status: 'warn' });

  if (draft.pic_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.pic_email.trim())) checks.push({ key: 'email', status: 'warn' });

  const docs = draft.dd_documents || [];
  const soon = addDays(today, 30);
  const expiring = docs.filter((d) => d.status === 'Expired' || (d.status === 'Available' && d.expiryDate && d.expiryDate <= soon)).length;
  if (expiring) checks.push({ key: 'dd_expiring', status: 'warn', count: expiring });
  return checks;
}
