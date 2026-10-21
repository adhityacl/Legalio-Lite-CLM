import type { InsertionOrder } from '@legalio/types';

export type ServiceOrderSortField = 'no' | 'judul' | 'partner' | 'pricing' | 'value' | 'duration' | 'start' | 'end' | 'status';
export type SortOrder = 'asc' | 'desc';

const endOf = (io: InsertionOrder) => io.end_date || io.completion_date || '';

const sortValue = (io: InsertionOrder, field: ServiceOrderSortField, partnerNameOf: (id: string) => string): string | number => {
  switch (field) {
    case 'no': return io.io_number || '';
    case 'judul': return io.io_title || '';
    case 'partner': return partnerNameOf(io.partner_id);
    case 'pricing': return io.pricing_model || '';
    case 'value': return io.io_value || 0;
    case 'duration': return endOf(io) || io.start_date || '';
    case 'start': return io.start_date || '';
    case 'end': return endOf(io);
    case 'status': return io.status || '';
  }
};

export function sortServiceOrders(ios: InsertionOrder[], field: ServiceOrderSortField, order: SortOrder, partnerNameOf: (id: string) => string = () => ''): InsertionOrder[] {
  return [...ios].sort((a, b) => {
    const valA = sortValue(a, field, partnerNameOf);
    const valB = sortValue(b, field, partnerNameOf);
    // Dates are YYYY-MM-DD strings, so string comparison orders them chronologically.
    const res = typeof valA === 'number' && typeof valB === 'number'
      ? valA - valB
      : String(valA || '').localeCompare(String(valB || ''), undefined, { numeric: true, sensitivity: 'base' });
    return order === 'asc' ? res : -res;
  });
}
