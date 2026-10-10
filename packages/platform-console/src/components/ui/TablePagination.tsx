import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { NativeSelect } from '@legalio/ui-components/native-select';
import {
  Pagination, PaginationFirstTrigger, PaginationItems, PaginationLastTrigger, PaginationNextTrigger, PaginationPrevTrigger,
} from '@legalio/ui-components/pagination';

export interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  rowsPerPageOptions?: number[];
  className?: string;
}

/** Table footer: rows-per-page NativeSelect and moduix Pagination (Data Table block layout). */
export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage, totalPages, rowsPerPage, onPageChange, onRowsPerPageChange, rowsPerPageOptions = [5, 10, 20, 50], className = '',
}) => {
  const { t } = useLanguage();
  const pages = Math.max(1, totalPages || 1);
  const page = Math.min(Math.max(1, currentPage || 1), pages);
  return (
    <div className={`mobile-pagination flex flex-col items-center justify-between gap-4 border-t border-border px-4 py-3 sm:flex-row sm:px-6 ${className}`}>
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={t('pagination.rows_per_page', 'Rows per page')}
          value={rowsPerPage}
          onChange={e => onRowsPerPageChange(Number(e.target.value))}
          controlProps={{ className: 'w-20' }}
        >
          {rowsPerPageOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </NativeSelect>
        <span className="text-sm text-muted-foreground">{t('pagination.rows_per_page', 'Rows per page')}</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <span className="text-sm text-muted-foreground">
          {t('pagination.page', 'Page')} {page} {t('pagination.of', 'of')} {pages}
        </span>
        <Pagination count={pages} pageSize={1} page={page} siblingCount={1} onPageChange={details => onPageChange(details.page)}>
          <PaginationFirstTrigger aria-label={t('pagination.first_page', 'First Page')} title={t('pagination.first_page', 'First Page')} />
          <PaginationPrevTrigger aria-label={t('pagination.prev_page', 'Previous Page')} title={t('pagination.prev_page', 'Previous Page')} />
          <PaginationItems />
          <PaginationNextTrigger aria-label={t('pagination.next_page', 'Next Page')} title={t('pagination.next_page', 'Next Page')} />
          <PaginationLastTrigger aria-label={t('pagination.last_page', 'Last Page')} title={t('pagination.last_page', 'Last Page')} />
        </Pagination>
      </div>
    </div>
  );
};
