import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { NativeSelect } from '@legalio/ui-components/native-select';
import {
  Pagination, PaginationFirstTrigger, PaginationItems, PaginationLastTrigger, PaginationNextTrigger, PaginationPrevTrigger,
} from '@legalio/ui-components/pagination';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
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
    <div className={`flex flex-col items-center justify-between gap-g13 border-t border-border px-g13 py-g13 sm:flex-row sm:px-g21 ${className}`}>
      <div className="flex items-center gap-g8">
        <NativeSelect controlProps={{ className: 'w-g89' }}
          aria-label={t('pagination.rows_per_page', 'Rows per page')}
          value={rowsPerPage}
          onChange={e => onRowsPerPageChange(Number(e.target.value))}
          className="w-g89"
        >
          {rowsPerPageOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </NativeSelect>
        <Text as="span" size="sm" tone="muted">{t('pagination.rows_per_page', 'Rows per page')}</Text>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-g13">
        <Text as="span" size="sm" tone="muted">
          {t('pagination.page', 'Page')} {page} {t('pagination.of', 'of')} {pages}
        </Text>
        <Pagination count={pages} pageSize={1} page={page} siblingCount={1} onPageChange={details => onPageChange(details.page)}>
          <Tooltip><TooltipTrigger asChild><PaginationFirstTrigger aria-label={t('pagination.first_page', 'First Page')} /></TooltipTrigger><TooltipBody>{t('pagination.first_page', 'First Page')}</TooltipBody></Tooltip>
          <Tooltip><TooltipTrigger asChild><PaginationPrevTrigger aria-label={t('pagination.prev_page', 'Previous Page')} /></TooltipTrigger><TooltipBody>{t('pagination.prev_page', 'Previous Page')}</TooltipBody></Tooltip>
          <PaginationItems />
          <Tooltip><TooltipTrigger asChild><PaginationNextTrigger aria-label={t('pagination.next_page', 'Next Page')} /></TooltipTrigger><TooltipBody>{t('pagination.next_page', 'Next Page')}</TooltipBody></Tooltip>
          <Tooltip><TooltipTrigger asChild><PaginationLastTrigger aria-label={t('pagination.last_page', 'Last Page')} /></TooltipTrigger><TooltipBody>{t('pagination.last_page', 'Last Page')}</TooltipBody></Tooltip>
        </Pagination>
      </div>
    </div>
  );
};
