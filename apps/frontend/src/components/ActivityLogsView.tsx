import { ModalFrame, ModalTitle } from './ui/modal-frame';
import { TableViewMenu } from './ui/table-view-menu';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import React, { useState, useEffect } from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { ActivityLog } from '@legalio/types';
import { Clock, Search, RefreshCw, Shield, Monitor, Filter, CheckCircle2, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useQuery } from '@tanstack/react-query';
import { getAuthHeaders } from '../lib/apiFetch';
import { useLanguage } from '../context/LanguageContext';
import { ActionMenu } from './ui/action-menu';
import { TablePagination } from './ui/TablePagination';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

export const ActivityLogsView: React.FC = () => {
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const logsQuery = useQuery<ActivityLog[]>({
    queryKey: ['activity-logs', user?.email, activeTenantId],
    enabled: Boolean(user?.email && activeTenantId),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/activity-logs', {
        headers: { ...getAuthHeaders(), 'x-tenant-id': activeTenantId, 'x-organization-id': activeTenantId }, credentials: 'include', cache: 'no-store', signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
  });
  const logs = logsQuery.data || [];
  const loading = logsQuery.isFetching;
  const loadLogs = () => { void logsQuery.refetch(); };
  const { t, language } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterModule, setFilterModule] = useState('ALL');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>('ALL');
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    time: true,
    user: true,
    action: true,
    module: true,
    detail: true,
  });
  const toggleColumnVisibility = (col: string) => {
    setVisibleColumns((prev) => ({ ...prev, [col]: !prev[col] }));
  };

  const filteredLogs = logs.filter((log) => {
    const matchSearch =
      log.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.ipAddress && log.ipAddress.includes(searchTerm));

    const matchAction = selectedAction === 'ALL' || log.actionType === selectedAction;
    const matchModule = filterModule === 'ALL' || log.module === filterModule;

    let matchTime = true;
    if (selectedTimeRange !== 'ALL') {
      const logDate = new Date(log.timestamp).getTime();
      const now = Date.now();
      if (selectedTimeRange === 'TODAY') {
        matchTime = now - logDate <= 24 * 60 * 60 * 1000;
      } else if (selectedTimeRange === '7_DAYS') {
        matchTime = now - logDate <= 7 * 24 * 60 * 60 * 1000;
      } else if (selectedTimeRange === '30_DAYS') {
        matchTime = now - logDate <= 30 * 24 * 60 * 60 * 1000;
      }
    }

    return matchSearch && matchAction && matchModule && matchTime;
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedRows(filteredLogs.map(item => item.id || ''));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const totalPages = Math.ceil(filteredLogs.length / rowsPerPage);
  const indexOfLast = currentPage * rowsPerPage;
  const indexOfFirst = indexOfLast - rowsPerPage;
  const currentLogs = filteredLogs.slice(indexOfFirst, indexOfLast);

  const [selectedLogForDetail, setSelectedLogForDetail] = useState<ActivityLog | null>(null);

  const moduleOptions = Array.from(new Set(logs.map((l) => l.module).filter(Boolean)));
  const getActionBadge = (action: ActivityLog['actionType']) => {
    switch (action) {
      case 'LOGIN':
      case 'UPLOAD_SUCCESS':
        return getStatusBadgeClass('Active');
      case 'LOGOUT':
        return getStatusBadgeClass('Neutral');
      case 'CREATE':
        return getStatusBadgeClass('Legal');
      case 'UPDATE':
      case 'DD_UPDATE':
        return getStatusBadgeClass('Expiring');
      case 'DELETE':
      case 'UPLOAD_FAILED':
      case 'SYSTEM_ERROR':
        return getStatusBadgeClass('Expired');
      case 'ADD_USER':
        return getStatusBadgeClass('Admin');
      default:
        return getStatusBadgeClass('Neutral');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="ds-page-bar">
        <div>
          <h2 className="ds-page-heading">
            <span>{t('logs.title', 'Log Aktivitas Sesi System')}</span>
          </h2>
        </div>

        <button
          onClick={loadLogs}
          disabled={loading}
          className="ui-button ui-button-lg mobile-page-action cursor-pointer flex items-center shrink-0 disabled:opacity-50 ds-button ds-button-lg ds-button-default"
        >
          <RefreshCw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
          <span>{t('logs.refresh_btn', 'Refresh Log')}</span>
        </button>
      </div>

      {/* Filter Bar with 3 Dropdowns */}
      <div className="ds-panel p-6 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5">
        <div className="mobile-filter-grid flex flex-1 flex-wrap items-center gap-2 w-full ds-grid">
          {/* 1 Box Search */}
          <div className="relative flex-1 min-w-[200px] md:max-w-xs">
            <Search className="w-4 h-4 text-ink-soft absolute left-3 top-2.5" />
            <input aria-label={t('logs.search_placeholder', 'Cari aktivitas, email, atau deskripsi...')}
              type="text"
              placeholder={t('logs.search_placeholder', 'Cari aktivitas, email, atau deskripsi...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="ds-input w-full pl-9 pr-3"
            />
          </div>

          {/* Filter 1: Modul */}
          <AlphabeticalSelect aria-label={t('logs.all_modules', 'Semua Modul')}
            value={filterModule}
            onChange={(e) => {
              setFilterModule(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[140px] appearance-none pr-8"
          >
            <option value="ALL">{t('logs.all_modules', 'Semua Modul')}</option>
            {moduleOptions.map((mod) => (
              <option key={mod} value={mod}>
                {mod}
              </option>
            ))}
          </AlphabeticalSelect>

          {/* Filter 2: Jenis Aksi */}
          <AlphabeticalSelect aria-label={t('logs.all_actions', 'Semua Jenis Aksi')}
            value={selectedAction}
            onChange={(e) => {
              setSelectedAction(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[140px] appearance-none pr-8"
          >
            <option value="ALL">{t('logs.all_actions', 'Semua Jenis Aksi')}</option>
            <option value="LOGIN">{t('logs.login', 'LOGIN')}</option>
            <option value="LOGOUT">{t('logs.logout', 'LOGOUT')}</option>
            <option value="CREATE">{t('logs.create', 'CREATE')}</option>
            <option value="UPDATE">{t('logs.update', 'UPDATE')}</option>
            <option value="DELETE">{t('logs.delete', 'DELETE')}</option>
            <option value="UPLOAD_SUCCESS">{t('logs.upload_success', 'UPLOAD_SUCCESS')}</option>
            <option value="UPLOAD_FAILED">{t('logs.upload_failed', 'UPLOAD_FAILED')}</option>
            <option value="SYSTEM_ERROR">{t('logs.system_error', 'SYSTEM_ERROR')}</option>
            <option value="ADD_USER">{t('logs.add_user', 'ADD_USER')}</option>
          </AlphabeticalSelect>

          {/* Filter 3: Periode Waktu */}
          <select aria-label={t('notifications.all_time_periods', 'Semua Periode Waktu')}
            value={selectedTimeRange}
            onChange={(e) => {
              setSelectedTimeRange(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[140px] appearance-none pr-8"
          >
            <option value="ALL">{t('notifications.all_time_periods', 'Semua Periode Waktu')}</option>
            <option value="TODAY">{t('notifications.time_today', 'Hari Ini (24 Jam Terakhir)')}</option>
            <option value="7_DAYS">{t('notifications.time_7_days', '7 Hari Terakhir')}</option>
            <option value="30_DAYS">{t('notifications.time_30_days', '30 Hari Terakhir')}</option>
          </select>
        </div>

        {/* View Toggle */}
        <TableViewMenu className="ml-auto" title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
          <div className="px-3.5 py-1.5 text-xs font-bold text-ink-soft uppercase tracking-wider mb-1 border-b border-hairline">
            {t('io.toggle_columns', 'Toggle Kolom')}
          </div>
          {Object.keys(visibleColumns).map((col) => {
            let label = col;
            if (col === 'time') label = 'Waktu';
            else if (col === 'user') label = 'Pengguna';
            else if (col === 'action') label = 'Jenis Aksi';
            else if (col === 'module') label = 'Modul';
            else if (col === 'detail') label = 'Rincian Deskripsi';

            return (
              <label key={col} className="flex items-center gap-2.5 px-3.5 py-1.5 hover:bg-surface cursor-pointer text-xs font-medium text-ink select-none">
                <input
                  type="checkbox"
                  checked={visibleColumns[col]}
                  onChange={() => toggleColumnVisibility(col)}
                  className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                />
                <span className="capitalize">{label}</span>
              </label>
            );
          })}
        </TableViewMenu>
      </div>

      {/* Table */}
      <div className="ds-table-surface bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto ds-table-surface bg-surface">
          <table className="ds-table w-full text-left border-collapse text-xs bg-surface">
            <thead className="bg-surface dark:bg-surface-2/50">
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                <th scope="col" className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <input
                      type="checkbox"
                      aria-label={t('logs.pilih_semua_log_aktivitas', 'Pilih semua log aktivitas')}
                      onChange={handleSelectAll}
                      checked={selectedRows.length > 0 && selectedRows.length === currentLogs.length}
                      className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                    />
                  </div>
                </th>
                {visibleColumns.time && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('logs.col_time', 'Waktu')}</th>}
                {visibleColumns.user && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('logs.col_user', 'Pengguna')}</th>}
                {visibleColumns.action && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('logs.col_action', 'Jenis Aksi')}</th>}
                {visibleColumns.module && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('logs.col_module', 'Modul')}</th>}
                {visibleColumns.detail && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('logs.col_detail', 'Rincian Deskripsi')}</th>}
                <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('dashboard.action', 'Aksi')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {loading ? (
                <tr>
                  <td colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} className="py-12 text-center text-ink-soft">
                    {t('logs.loading', 'Memuat log aktivitas...')}
                  </td>
                </tr>
              ) : currentLogs.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                currentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors">
                    <td className="pl-6 pr-2 py-4 text-left align-middle">
                      <div className="flex items-center justify-start">
                        <input
                          type="checkbox"
                          aria-label={t('logs.pilih_log_oleh', 'Pilih log {actionType} oleh {userEmail}', { actionType: log.actionType, userEmail: log.userName || log.userEmail })}
                          checked={selectedRows.includes(log.id || '')}
                          onChange={() => handleSelectRow(log.id || '')}
                          className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                        />
                      </div>
                    </td>

                    {/* 1. Waktu */}
                    {visibleColumns.time && (
                      <td className="py-4 px-4 text-xs font-semibold text-ink whitespace-nowrap text-left">
                        {new Date(log.timestamp).toLocaleString(getActiveFormattingLocale(), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                    )}

                    {/* 2. Pengguna */}
                    {visibleColumns.user && (
                      <td className="py-4 px-4 text-xs font-normal text-ink whitespace-nowrap text-left">
                        {log.userName || log.userEmail}
                      </td>
                    )}

                    {/* 3. Jenis Aksi */}
                    {visibleColumns.action && (
                      <td className="py-4 px-4 text-left">
                        <span
                          className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center justify-center gap-1.5 shadow-2xs whitespace-nowrap ${getActionBadge(
                            log.actionType
                          )}`}
                        >
                          {log.actionType}
                        </span>
                      </td>
                    )}

                    {/* 4. Modul */}
                    {visibleColumns.module && (
                      <td className="py-4 px-4 text-xs font-normal text-ink uppercase whitespace-nowrap text-left">
                        <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center justify-center whitespace-nowrap shadow-2xs ${getStatusBadgeClass(log.module)}`}>
                          {log.module}
                        </span>
                      </td>
                    )}

                    {/* 5. Rincian Deskripsi */}
                    {visibleColumns.detail && (
                      <td className="py-4 px-4 max-w-sm text-left text-xs font-normal text-ink">
                        <p className="line-clamp-1" title={log.description}>{log.description}</p>
                      </td>
                    )}

                    {/* 6. Aksi */}
                    <td className="pl-2 pr-6 py-4 text-right align-middle w-20">
                      <div className="flex items-center justify-end">
                        <ActionMenu
                          items={[
                            {
                              label: t('io.action_detail', 'Detail'),
                              icon: <Eye className="w-3.5 h-3.5" />,
                              onClick: () => setSelectedLogForDetail(log),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage}
          onRowsPerPageChange={(size) => {
            setRowsPerPage(size);
            setCurrentPage(1);
          }}
        />
      </div>

      {/* Detail Modal */}
      {selectedLogForDetail && (
        <ModalFrame onClose={() => setSelectedLogForDetail(null)} className="max-w-lg w-full overflow-hidden">

            <div className="ds-section-header">
              <div>
                <ModalTitle className="ds-modal-title flex items-center gap-2">{t('logs.rincian_log_aktivitas', 'Rincian Log Aktivitas')}</ModalTitle>
                <p className="text-xs text-ink-soft mt-0.5">{t('logs.id', 'ID: {id}', { id: selectedLogForDetail.id })}</p>
              </div>
              <button aria-label={t('common.close', 'Tutup')}
                onClick={() => setSelectedLogForDetail(null)}
                className="text-ink-soft hover:text-ink-soft dark:hover:text-ink p-1 rounded-md transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="ds-panel grid grid-cols-2 gap-4 p-4 ds-grid">
                <div>
                  <span className="text-ink-soft font-medium block mb-1">{t('notifications.col_time', 'Waktu')}</span>
                  <span className="font-semibold text-ink">
                    {new Date(selectedLogForDetail.timestamp).toLocaleString(getActiveFormattingLocale(), {
                      dateStyle: 'full',
                      timeStyle: 'medium',
                    })}
                  </span>
                </div>
                <div>
                  <span className="text-ink-soft font-medium block mb-1">{t('admin.generic_user', 'Pengguna')}</span>
                  <span className="font-semibold text-ink">
                    {selectedLogForDetail.userName || selectedLogForDetail.userEmail} ({selectedLogForDetail.role})
                  </span>
                </div>
                <div>
                  <span className="text-ink-soft font-medium block mb-1">{t('logs.col_action', 'Jenis Aksi')}</span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border inline-block ${getActionBadge(selectedLogForDetail.actionType)}`}>
                    {selectedLogForDetail.actionType}
                  </span>
                </div>
                <div>
                  <span className="text-ink-soft font-medium block mb-1">{t('settings.region.modules', 'Modul')}</span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border inline-block ${getStatusBadgeClass(selectedLogForDetail.module)}`}>
                    {selectedLogForDetail.module}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-ink-soft font-semibold block mb-1.5">{t('logs.deskripsi_detail_teknis', 'Deskripsi / Detail Teknis:')}</span>
                <div className="p-3.5 bg-ink text-on-solid rounded-xl font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selectedLogForDetail.description}
                </div>
              </div>

              {(selectedLogForDetail.ipAddress || selectedLogForDetail.userAgent) && (
                <div className="pt-2 border-t border-hairline space-y-1 text-xs text-ink-soft">
                  {selectedLogForDetail.ipAddress && <div><span className="font-semibold">{t('logs.ip_address', 'IP Address:')}</span> {selectedLogForDetail.ipAddress}</div>}
                  {selectedLogForDetail.userAgent && <div className="truncate"><span className="font-semibold">{t('logs.user_agent', 'User Agent:')}</span> {selectedLogForDetail.userAgent}</div>}
                </div>
              )}
            </div>

            <div className="p-4 bg-surface dark:bg-surface-2/50 border-t border-hairline flex justify-end">
              <button
                onClick={() => setSelectedLogForDetail(null)}
                className="inline-flex items-center px-4 min-h-8 bg-surface-2 hover:bg-ink-faint dark:hover:bg-surface-2 text-ink rounded-md font-semibold text-xs transition-all cursor-pointer"
              >
                {t('redline.close', 'Tutup')}
              </button>
            </div>

        </ModalFrame>
      )}
    </div>
  );
};
