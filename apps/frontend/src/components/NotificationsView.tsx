import { AlphabeticalSelect } from './ui/alphabetical-select';
import { formatDateTime } from '../lib/displayDate';
import { notificationMessage } from '../lib/notificationText';
import React, { useState, useMemo } from 'react';
import { NotificationLog } from '@legalio/types';
import {
  RefreshCw,
  CheckCheck,
  CheckCircle2,
  Trash2,
  Search,
  ArrowDown,
  ArrowUp,
  Inbox,
  SlidersHorizontal,
  Bell,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { TablePagination } from './ui/TablePagination';
import { TableEmptyState } from './ui/table-empty-state';

interface NotificationsViewProps {
  notifications: NotificationLog[];
  onTriggerCheck: () => Promise<void>;
  onMarkRead?: (notifId?: string, markAll?: boolean) => Promise<void>;
  onDeleteNotif?: (notifId?: string, notifIds?: string[], deleteAll?: boolean) => Promise<void>;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  onTriggerCheck,
  onMarkRead,
  onDeleteNotif,
}) => {
  const { t, language } = useLanguage();
  const confirmDialog = useConfirm();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterTimeRange, setFilterTimeRange] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [runningCron, setRunningCron] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    time: true,
    type: true,
    subject: true,
    message: true,
    recipient: false,
  });

  const toggleColumnVisibility = (col: string) => {
    setVisibleColumns((prev) => ({ ...prev, [col]: !prev[col] }));
  };

  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications]);

  // Unique notification types for filter dropdown
  const typeOptions = useMemo(() => {
    const types = new Set<string>();
    notifications.forEach((n) => {
      if (n.jenis_notifikasi) types.add(n.jenis_notifikasi);
    });
    return Array.from(types).sort();
  }, [notifications]);

  const handleManualTrigger = async () => {
    setRunningCron(true);
    await onTriggerCheck();
    setTimeout(() => setRunningCron(false), 500);
  };

  const handleMarkAllRead = async () => {
    if (onMarkRead) {
      await onMarkRead(undefined, true);
    }
  };

  const handleMarkSingleRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMarkRead) {
      await onMarkRead(id);
    }
  };

  const handleDeleteSingle = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      description: t('notifications.confirm_delete', 'Hapus notifikasi ini?'),
      tone: 'danger',
    });
    if (ok) {
      if (onDeleteNotif) {
        await onDeleteNotif(id);
        setSelectedIds((prev) => prev.filter((item) => item !== id));
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    const ok = await confirmDialog({
      description: t('notifications.confirm_delete_selected', 'Hapus notifikasi yang dipilih?'),
      tone: 'danger',
    });
    if (ok) {
      if (onDeleteNotif) {
        await onDeleteNotif(undefined, selectedIds);
        setSelectedIds([]);
      }
    }
  };

  const handleMarkSelectedRead = async () => {
    if (selectedIds.length === 0 || !onMarkRead) return;
    for (const id of selectedIds) {
      await onMarkRead(id);
    }
    setSelectedIds([]);
  };

  // Filter and Sort Notifications
  const filteredNotifications = useMemo(() => {
    let list = [...notifications];

    // Status filter
    if (filterStatus === 'UNREAD') {
      list = list.filter((n) => !n.is_read);
    } else if (filterStatus === 'READ') {
      list = list.filter((n) => n.is_read);
    }

    // Type filter
    if (filterType !== 'ALL') {
      list = list.filter((n) => n.jenis_notifikasi === filterType);
    }

    // Time range filter
    if (filterTimeRange !== 'ALL') {
      const now = new Date().getTime();
      list = list.filter((n) => {
        const notifTime = new Date(n.tanggal_terkirim).getTime();
        const diffMs = now - notifTime;
        if (filterTimeRange === 'TODAY') return diffMs <= 24 * 60 * 60 * 1000;
        if (filterTimeRange === '7_DAYS') return diffMs <= 7 * 24 * 60 * 60 * 1000;
        if (filterTimeRange === '30_DAYS') return diffMs <= 30 * 24 * 60 * 60 * 1000;
        return true;
      });
    }

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (n) =>
          (n.pesan && notificationMessage(n, t).toLowerCase().includes(q)) ||
          (n.parent_nomor && n.parent_nomor.toLowerCase().includes(q)) ||
          (n.parent_judul && n.parent_judul.toLowerCase().includes(q)) ||
          (n.jenis_notifikasi && n.jenis_notifikasi.toLowerCase().includes(q)) ||
          (n.penerima && n.penerima.toLowerCase().includes(q))
      );
    }

    // Sort by created time
    list.sort((a, b) => {
      const timeA = new Date(a.tanggal_terkirim).getTime();
      const timeB = new Date(b.tanggal_terkirim).getTime();
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

    return list;
  }, [notifications, filterStatus, filterType, filterTimeRange, searchTerm, sortOrder, t]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / rowsPerPage));
  const indexOfLast = currentPage * rowsPerPage;
  const indexOfFirst = indexOfLast - rowsPerPage;
  const currentNotifications = filteredNotifications.slice(indexOfFirst, indexOfLast);

  // Checkbox handlers
  const isAllCurrentSelected =
    currentNotifications.length > 0 &&
    currentNotifications.every((n) => selectedIds.includes(n.notif_id));

  const toggleSelectAll = () => {
    if (isAllCurrentSelected) {
      const currentIds = currentNotifications.map((n) => n.notif_id);
      setSelectedIds((prev) => prev.filter((id) => !currentIds.includes(id)));
    } else {
      const currentIds = currentNotifications.map((n) => n.notif_id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      {/* 1. Standard Header Card */}
      <div className="ds-page-bar">
        <div>
          <h2 className="ds-page-heading">
            <span>{t('notifications.title', 'Pusat Notifikasi & Alarm Notice Period')}</span>
            {unreadCount > 0 && (
              <span className={`text-xs font-normal px-3 py-0.5 rounded-full border shadow-2xs whitespace-nowrap ${getStatusBadgeClass('warning')}`}>
                {unreadCount} {t('notifications.unread_badge', 'Belum Dibaca')}
              </span>
            )}
          </h2>
        </div>

        <div className="mobile-page-actions flex flex-wrap items-center gap-2.5 shrink-0">
          {unreadCount > 0 && onMarkRead && (
            <button
              onClick={handleMarkAllRead}
              className="ui-button ui-button-lg ui-button-lg cursor-pointer flex items-center shrink-0 ds-button ds-button-lg ds-button-outline"
            >
              <CheckCheck className="w-4 h-4 text-ink-soft" />
              <span>{t('notifications.mark_all', 'Tandai Semua Dibaca')}</span>
            </button>
          )}

          <button
            onClick={handleManualTrigger}
            disabled={runningCron}
            className="ui-button ui-button-lg ui-button-lg cursor-pointer flex items-center shrink-0 disabled:opacity-50 ds-button ds-button-lg ds-button-default"
          >
            <RefreshCw className={`w-4 h-4 text-white ${runningCron ? 'animate-spin' : ''}`} />
            <span>{runningCron ? t('notifications.processing', 'Memproses...') : t('notifications.refresh_logs', 'Refresh Logs')}</span>
          </button>
        </div>
      </div>

      {/* 2. Standard Filter Bar with 3 Dropdowns and View Column Toggle - Justified Responsive Grid/Flex */}
      <div className="ds-panel p-6 mb-6">
        <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full ds-grid">
          {/* 1. Search Box */}
          <div className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
            <Search className="w-4 h-4 text-ink-soft absolute left-3 top-2.5" />
            <input aria-label={t('notifications.search_ph', 'Cari nomor kontrak, partner, atau IO...')}
              type="text"
              placeholder={t('notifications.search_ph', 'Cari nomor kontrak, partner, atau IO...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="ds-input w-full pl-9 pr-3"
            />
          </div>

          {/* 2. Filter 1: Status Notifikasi (Semua / Belum Dibaca / Sudah Dibaca) */}
          <AlphabeticalSelect aria-label={t('notifications.all_status', 'Semua Status')}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="ALL">{t('notifications.all_status', 'Semua Status')} ({notifications.length})</option>
            <option value="UNREAD">{t('notifications.status_unread', 'Belum Dibaca')} ({unreadCount})</option>
            <option value="READ">{t('notifications.status_read', 'Sudah Dibaca')} ({notifications.length - unreadCount})</option>
          </AlphabeticalSelect>

          {/* 3. Filter 2: Jenis Notifikasi */}
          <AlphabeticalSelect aria-label={t('notifications.all_types', 'Semua Jenis Notifikasi')}
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="ALL">{t('notifications.all_types', 'Semua Jenis Notifikasi')}</option>
            {typeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </AlphabeticalSelect>

          {/* 4. Filter 3: Periode Waktu */}
          <select aria-label={t('notifications.all_time_periods', 'Semua Periode Waktu')}
            value={filterTimeRange}
            onChange={(e) => {
              setFilterTimeRange(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="ALL">{t('notifications.all_time_periods', 'Semua Periode Waktu')}</option>
            <option value="TODAY">{t('notifications.time_today', 'Hari Ini (24 Jam Terakhir)')}</option>
            <option value="7_DAYS">{t('notifications.time_7_days', '7 Hari Terakhir')}</option>
            <option value="30_DAYS">{t('notifications.time_30_days', '30 Hari Terakhir')}</option>
          </select>

          {/* View Column Toggle Menu */}
          <div className="relative flex-initial">
            <button
              onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
              className="ui-button ui-button-lg flex items-center justify-center cursor-pointer active:scale-[0.98] w-full ds-button ds-button-lg ds-button-outline"
              title={t('notifications.view_settings', 'Pengaturan Tampilan Kolom')}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-ink-soft" />
              <span>{t('notifications.view', 'View')}</span>
            </button>
            {isViewMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIsViewMenuOpen(false)}></div>
                <div className="ds-panel absolute right-0 top-11 w-52 z-30 py-2 animate-in fade-in zoom-in-95">
                <div className="px-3.5 py-1.5 text-xs font-bold text-ink-soft uppercase tracking-wider mb-1 border-b border-hairline">
                  {t('notifications.toggle_columns', 'Toggle Kolom')}
                </div>
                {Object.keys(visibleColumns).map((col) => {
                  let label = col;
                  if (col === 'time') label = t('notifications.col_time', 'Waktu');
                  else if (col === 'type') label = t('notifications.col_type_header', 'Tipe Notifikasi');
                  else if (col === 'subject') label = t('notifications.col_subject', 'Subjek');
                  else if (col === 'message') label = t('notifications.col_message', 'Pesan');
                  else if (col === 'recipient') label = t('notifications.col_recipient', 'Penerima');

                  return (
                    <label
                      key={col}
                      className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-surface dark:hover:bg-surface-2 cursor-pointer text-xs font-semibold text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns[col]}
                        onChange={() => toggleColumnVisibility(col)}
                        className="rounded-sm border-hairline text-accent-text focus:ring-accent w-3.5 h-3.5"
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>

      {/* Bulk Action Bar (Visible when items selected) */}
      {selectedIds.length > 0 && (
        <div className="ds-panel p-3 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-xs font-medium text-ink">
            <span className="font-bold text-accent-text">{selectedIds.length}</span>
            <span>{t('notifications.selected_count', 'notifikasi dipilih')}</span>
          </div>

          <div className="flex items-center gap-2">
            {onMarkRead && (
              <button
                type="button"
                onClick={handleMarkSelectedRead}
                className="min-h-10 h-10 px-4 text-sm bg-surface dark:bg-surface-2 border border-hairline rounded-md text-ink hover:text-accent-text font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-accent-text" />
                <span>{t('notifications.mark_read_btn', 'Tandai Dibaca')}</span>
              </button>
            )}

            {onDeleteNotif && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="min-h-10 h-10 px-4 text-sm bg-status-danger-soft dark:bg-status-danger-soft/40 border border-status-danger-border rounded-md text-status-danger hover:bg-status-danger-soft font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-status-danger" />
                <span>{t('notifications.delete_selected', 'Hapus Terpilih')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Main Standard Table Card */}
      <div className="ds-table-surface bg-surface rounded-2xl border border-hairline/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto ds-table-surface">
          <table className="ds-table w-full text-left text-xs border-collapse">
            {/* Table Header */}
            <thead className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink">
              <tr>
                {/* 0. Checkbox */}
                <th className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <input aria-label={t('table.select_all', 'Pilih semua baris')}
                      type="checkbox"
                      checked={isAllCurrentSelected}
                      onChange={toggleSelectAll}
                      className="rounded-sm border-hairline text-accent-text focus:ring-accent cursor-pointer"
                    />
                  </div>
                </th>

                {/* 1. Created time */}
                {visibleColumns.time && (
                  <th
                    onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                    className="p-4 cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors select-none align-middle"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{t('notifications.col_created_time', 'Created time')}</span>
                      {sortOrder === 'desc' ? (
                        <ArrowDown className="w-3.5 h-3.5 text-ink-soft" />
                      ) : (
                        <ArrowUp className="w-3.5 h-3.5 text-ink-soft" />
                      )}
                    </div>
                  </th>
                )}

                {/* 2. Type */}
                {visibleColumns.type && (
                  <th className="p-4 align-middle">{t('notifications.col_type_short', 'Type')}</th>
                )}

                {/* 3. Subject */}
                {visibleColumns.subject && (
                  <th className="p-4 align-middle">{t('notifications.col_subject', 'Subject')}</th>
                )}

                {/* 4. Message */}
                {visibleColumns.message && (
                  <th className="p-4 align-middle">{t('notifications.col_message', 'Message')}</th>
                )}

                {/* 5. Recipient */}
                {visibleColumns.recipient && (
                  <th className="p-4 align-middle">{t('notifications.col_recipient', 'Penerima')}</th>
                )}

                {/* 6. Actions */}
                <th className="pl-2 pr-6 py-4 text-right w-24 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('notifications.col_actions', 'Aksi')}</div>
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-hairline text-ink">
              {currentNotifications.length === 0 ? (
                <TableEmptyState colSpan={7} />
              ) : (
                currentNotifications.map((notif) => {
                  const isSelected = selectedIds.includes(notif.notif_id);
                  const isUnread = !notif.is_read;

                  return (
                    <tr
                      key={notif.notif_id}
                      className={`hover:bg-surface/80 dark:hover:bg-surface-2/50 transition-colors ${
                        isSelected
                          ? 'bg-surface/90 dark:bg-surface-2/80'
                          : isUnread
                          ? 'bg-status-success-soft/20 dark:bg-status-success-soft/10'
                          : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                        <div className="flex items-center justify-start">
                          <input aria-label={t('table.select_row', 'Pilih baris {id}', { id: notif.notif_id })}
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(notif.notif_id)}
                            className="rounded-sm border-hairline text-accent-text focus:ring-accent cursor-pointer"
                          />
                        </div>
                      </td>

                      {/* Created Time */}
                      {visibleColumns.time && (
                        <td className="py-4 px-4 text-xs font-semibold text-ink whitespace-nowrap align-middle">
                          {formatDateTime(notif.tanggal_terkirim)}
                        </td>
                      )}

                      {/* Type Badge */}
                      {visibleColumns.type && (
                        <td className="py-4 px-4 text-xs font-normal text-ink whitespace-nowrap align-middle">
                          <span
                            className={`text-xs font-normal px-3 py-0.5 rounded-full border shadow-2xs whitespace-nowrap inline-flex items-center justify-center ${getStatusBadgeClass(
                              notif.jenis_notifikasi
                            )}`}
                          >
                            {notif.jenis_notifikasi}
                          </span>
                        </td>
                      )}

                      {/* Subject */}
                      {visibleColumns.subject && (
                        <td className="py-4 px-4 text-xs font-normal text-ink whitespace-nowrap align-middle">
                          <span className="font-medium">
                            {notif.parent_nomor || notif.parent_id}
                          </span>
                          {notif.parent_judul && (
                            <span className="text-ink-soft ml-1.5">
                              • {notif.parent_judul}
                            </span>
                          )}
                        </td>
                      )}

                      {/* Message */}
                      {visibleColumns.message && (
                        <td className="py-4 px-4 text-xs font-normal text-ink max-w-[400px] align-middle">
                          <span className="line-clamp-2" title={notificationMessage(notif, t)}>
                            {notificationMessage(notif, t)}
                          </span>
                        </td>
                      )}

                      {/* Recipient */}
                      {visibleColumns.recipient && (
                        <td className="py-4 px-4 text-xs font-normal text-ink whitespace-nowrap align-middle">
                          {notif.penerima}
                        </td>
                      )}

                      {/* Actions */}
                      <td className="pl-2 pr-6 py-4 text-right whitespace-nowrap w-24 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Mark Read Checkmark Button */}
                          {isUnread && onMarkRead && (
                            <button
                              type="button"
                              onClick={(e) => handleMarkSingleRead(notif.notif_id, e)}
                              className="inline-flex size-10 items-center justify-center rounded-md text-ink-soft hover:text-accent-text hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
                              title={t('notifications.mark_read', 'Tandai Dibaca')}
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}

                          {/* Delete Trash Button */}
                          {onDeleteNotif && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSingle(notif.notif_id, e)}
                              className="inline-flex size-10 items-center justify-center rounded-md text-ink-soft hover:text-status-danger hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
                              title={t('notifications.delete_notif', 'Hapus Notifikasi')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage}
          onRowsPerPageChange={(n) => {
            setRowsPerPage(n);
            setCurrentPage(1);
          }}
        />
      </div>
    </div>
  );
};
