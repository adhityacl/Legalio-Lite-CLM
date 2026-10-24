import type { Contract, InsertionOrder, Partner, PartnerEvaluation, PartnerSpending, UserSession } from '@legalio/types';
import { canViewContract, canViewIO, canViewSpending } from './rbacScoping';

export interface WorkspaceSearchResult {
  kind: 'contract' | 'io' | 'spending' | 'evaluation' | 'partner';
  recordId: string;
  tab: 'contracts' | 'ios' | 'partner-spending' | 'partner-evaluation' | 'partners';
  label: string;
  description: string;
  keywords: string;
}

interface SearchData {
  organizationId: string;
  partners: Partner[];
  contracts: Contract[];
  ios: InsertionOrder[];
  spendings: PartnerSpending[];
  evaluations: PartnerEvaluation[];
}

/** Match every word, ignoring case, accents and full-width character variants. */
export function matchesWorkspaceSearch(text: string, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const haystack = normalize(text);
  return normalize(query).trim().split(/\s+/).every(word => haystack.includes(word));
}

/** Records arrive scoped by /api/init-data; retain the views' additional visibility rules. */
export function buildWorkspaceSearchResults(data: SearchData, user: UserSession | null): WorkspaceSearchResult[] {
  if (!user || !data.organizationId) return [];
  const inScope = (record: { organizationId?: string }) => !record.organizationId || record.organizationId === data.organizationId;
  const partners = new Map(data.partners.filter(inScope).map(partner => [partner.partner_id, partner.partner_name]));
  const contracts = new Map(data.contracts.filter(inScope).map(contract => [contract.contract_id, contract]));
  const contractNumbers = new Map(data.contracts.filter(inScope).map(contract => [contract.contract_number, contract]));
  const vendor = (id?: string, name?: string) => (id && partners.get(id)) || name || '';
  const title = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' · ');
  return [
    ...data.contracts.filter(record => inScope(record) && canViewContract(record, data.partners, user)).map(record => ({
      kind: 'contract' as const, recordId: record.contract_id, tab: 'contracts' as const,
      label: title(record.contract_number, record.contract_title),
      description: vendor(record.partner_id),
      keywords: title('contract', vendor(record.partner_id)),
    })),
    ...data.ios.filter(record => inScope(record) && canViewIO(record, data.partners, user)).map(record => {
      const contract = contracts.get(record.contract_id || '') || contractNumbers.get(record.contract_number || '');
      return {
        kind: 'io' as const, recordId: record.io_id, tab: 'ios' as const,
        label: title(record.io_number, record.io_title),
        description: vendor(record.partner_id) || vendor(contract?.partner_id),
        keywords: title('io service order so sow', vendor(record.partner_id), record.contract_number),
      };
    }),
    ...data.spendings.filter(record => inScope(record) && canViewSpending(record, data.partners, user)).map(record => ({
      kind: 'spending' as const, recordId: record.id, tab: 'partner-spending' as const,
      label: title(record.invoice_number, record.invoice_title),
      description: title(vendor(record.vendor_id, record.vendor_name), record.invoice_date),
      keywords: title('spending invoice', record.vendor_name),
    })),
    ...data.evaluations.filter(inScope).map(record => ({
      kind: 'evaluation' as const, recordId: record.id, tab: 'partner-evaluation' as const,
      label: title(record.type_of_work || record.supplier_name, record.review_date),
      description: vendor(record.partner_id, record.supplier_name),
      keywords: title('partner evaluation', record.supplier_name),
    })),
  ];
}

/** A hit of `GET /api/search` (already limited to the caller's organization and departments by the server). */
export interface SearchHit { entity_type: string; entity_id: string; title: string }

const HIT_TARGETS: Record<string, { kind: WorkspaceSearchResult['kind']; tab: WorkspaceSearchResult['tab']; word: string }> = {
  contracts: { kind: 'contract', tab: 'contracts', word: 'contract' },
  insertion_orders: { kind: 'io', tab: 'ios', word: 'io service order so sow' },
  spendings: { kind: 'spending', tab: 'partner-spending', word: 'spending invoice' },
  evaluations: { kind: 'evaluation', tab: 'partner-evaluation', word: 'partner evaluation' },
  partners: { kind: 'partner', tab: 'partners', word: 'partner' },
};

/**
 * Palette entries for server search hits. The server already decided that the record matches `query`, so the query itself is part of
 * the entry's keywords: the palette's own word filter then keeps every hit.
 */
export function searchHitsToResults(hits: SearchHit[], query: string): WorkspaceSearchResult[] {
  return hits.flatMap(hit => {
    const target = HIT_TARGETS[hit.entity_type];
    return target ? [{ kind: target.kind, recordId: hit.entity_id, tab: target.tab, label: hit.title || hit.entity_id, description: target.word.split(' ')[0], keywords: `${target.word} ${query}` }] : [];
  });
}
