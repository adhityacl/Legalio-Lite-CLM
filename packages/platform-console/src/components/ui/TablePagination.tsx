import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  rowsPerPageOptions?: number[];
  className?: string;
}

// Same height as the rows-per-page select beside it (see docs/button-sizes.md).
const pageButtonClass = 'ui-button ui-button-lg ui-button-icon border border-hairline  bg-surface  hover:bg-surface dark:hover:bg-surface-2/80 text-ink-soft  disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-2xs';

export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalPages,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPageOptions = [5, 10, 20, 50],
  className = '',
}) => {
  const { t } = useLanguage();
  const safeTotalPages = Math.max(1, totalPages || 1);
  const safeCurrentPage = Math.min(Math.max(1, currentPage || 1), safeTotalPages);

  return (
    <div
      className={`ds-table-pagination mobile-pagination p-4 sm:px-6 sm:py-3.5 border-t border-hairline bg-surface dark:bg-surface/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs select-none ${className}`}
    >
      {/* Left: Rows per page selector */}
      <div className="flex items-center gap-2.5">
        <div className="relative inline-flex items-center">
          <select
            aria-label={t('pagination.rows_per_page', 'Rows per page')}
            value={rowsPerPage}
            onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
            className="ds-input pl-3 pr-7 appearance-none"
          >
            {rowsPerPageOptions.map((opt) => (
              <option
                key={opt}
                value={opt}
                className="bg-surface text-ink"
              >
                {opt}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-ink-soft font-medium">
          {t('pagination.rows_per_page', 'Rows per page')}
        </span>
      </div>

      {/* Right: Page indicator & 4 Nav buttons */}
      <div className="flex items-center gap-4 sm:gap-6">
        <span className="text-xs text-ink-soft font-medium">
          {t('pagination.page', 'Page')} {safeCurrentPage} {t('pagination.of', 'of')} {safeTotalPages}
        </span>

        <div className="flex items-center gap-1.5">
          {/* First Page */}
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={safeCurrentPage <= 1}
            className={pageButtonClass}
            title={t('pagination.first_page', 'First Page')}
            aria-label={t('pagination.first_page', 'First Page')}
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>

          {/* Previous Page */}
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
            disabled={safeCurrentPage <= 1}
            className={pageButtonClass}
            title={t('pagination.prev_page', 'Previous Page')}
            aria-label={t('pagination.prev_page', 'Previous Page')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Next Page */}
          <button
            type="button"
            onClick={() => onPageChange(Math.min(safeTotalPages, safeCurrentPage + 1))}
            disabled={safeCurrentPage >= safeTotalPages}
            className={pageButtonClass}
            title={t('pagination.next_page', 'Next Page')}
            aria-label={t('pagination.next_page', 'Next Page')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Last Page */}
          <button
            type="button"
            onClick={() => onPageChange(safeTotalPages)}
            disabled={safeCurrentPage >= safeTotalPages}
            className={pageButtonClass}
            title={t('pagination.last_page', 'Last Page')}
            aria-label={t('pagination.last_page', 'Last Page')}
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
