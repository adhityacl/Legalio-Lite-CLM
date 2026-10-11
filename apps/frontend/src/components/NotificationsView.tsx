import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
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
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { TablePagination } from './ui/TablePagination';
import { TableEmptyState } from './ui/table-empty-state';

import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Spinner } from '@legalio/ui-components/spinner';
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
  const [rowsPerPage, setRowsPerPage] = useState(5);

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

  const toggleSelectAll = (_checked?: boolean) => {
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
    <div className="space-y-g21 animate-in fade-in-50 duration-200">
      {/* 1. Standard Header Card */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('notifications.title', 'Pusat Notifikasi & Alarm Notice Period')}</span>
            {unreadCount > 0 && (
              <Badge tone={statusTone('warning')}>
                {unreadCount} {t('notifications.unread_badge', 'Belum Dibaca')}
              </Badge>
            )}
          </Heading>
        </div>

        <div className="flex flex-wrap items-center gap-g8 shrink-0">
          {unreadCount > 0 && onMarkRead && (
            <Button variant="outline"
              onClick={handleMarkAllRead}
              className="shrink-0"
            >
              <CheckCheck className="w-g16 h-g16 text-muted-foreground" />
              <span>{t('notifications.mark_all', 'Tandai Semua Dibaca')}</span>
            </Button>
          )}

          <Button
            onClick={handleManualTrigger}
            disabled={runningCron}
            className="shrink-0"
          >
            {runningCron ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}
            <span>{runningCron ? t('notifications.processing', 'Memproses...') : t('notifications.refresh_logs', 'Refresh Logs')}</span>
          </Button>
        </div>
      </div>

      {/* 2. Standard Filter Bar with 3 Dropdowns and View Column Toggle - Justified Responsive Grid/Flex */}
      <Card className="p-g13">
        <div className="flex w-full flex-wrap items-center gap-g13">
          {/* 1. Search Box */}
          <InputGroup className="relative flex-1 min-w-g233 sm:min-w-g233">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput aria-label={t('notifications.search_ph', 'Cari nomor kontrak, partner, atau IO...')}
              type="text"
              placeholder={t('notifications.search_ph', 'Cari nomor kontrak, partner, atau IO...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </InputGroup>

          {/* 2. Filter 1: Status Notifikasi (Semua / Belum Dibaca / Sudah Dibaca) */}
          <AlphabeticalSelect aria-label={t('notifications.all_status', 'Semua Status')}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('notifications.all_types', 'Semua Jenis Notifikasi')}</option>
            {typeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </AlphabeticalSelect>

          {/* 4. Filter 3: Periode Waktu */}
          <NativeSelect aria-label={t('notifications.all_time_periods', 'Semua Periode Waktu')}
            value={filterTimeRange}
            onChange={(e) => {
              setFilterTimeRange(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('notifications.all_time_periods', 'Semua Periode Waktu')}</option>
            <option value="TODAY">{t('notifications.time_today', 'Hari Ini (24 Jam Terakhir)')}</option>
            <option value="7_DAYS">{t('notifications.time_7_days', '7 Hari Terakhir')}</option>
            <option value="30_DAYS">{t('notifications.time_30_days', '30 Hari Terakhir')}</option>
          </NativeSelect>

          {/* View Column Toggle Menu */}
          <TableViewMenu className="flex-initial" title={t('notifications.view_settings', 'Pengaturan Tampilan Kolom')} label={t('notifications.view', 'View')} heading={t('notifications.toggle_columns', 'Toggle Kolom')}>
            {Object.keys(visibleColumns).map((col) => {
              let label = col;
              if (col === 'time') label = t('notifications.col_time', 'Waktu');
              else if (col === 'type') label = t('notifications.col_type_header', 'Tipe Notifikasi');
              else if (col === 'subject') label = t('notifications.col_subject', 'Subjek');
              else if (col === 'message') label = t('notifications.col_message', 'Pesan');
              else if (col === 'recipient') label = t('notifications.col_recipient', 'Penerima');
              return <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>;
            })}
          </TableViewMenu>
      </div>
    </Card>

      {/* Bulk Action Bar (Visible when items selected) */}
      {selectedIds.length > 0 && (
        <Card className="p-g13 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-g8 text-xs font-medium text-foreground">
            <span className="font-bold text-accent-foreground">{selectedIds.length}</span>
            <span>{t('notifications.selected_count', 'notifikasi dipilih')}</span>
          </div>

          <div className="flex items-center gap-g8">
            {onMarkRead && (
              <Button variant="outline"
                type="button"
                onClick={handleMarkSelectedRead}
              >
                <CheckCircle2 className="w-g13 h-g13 text-accent-foreground" />
                <span>{t('notifications.mark_read_btn', 'Tandai Dibaca')}</span>
              </Button>
            )}

            {onDeleteNotif && (
              <Button variant="destructive-outline"
                type="button"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="w-g13 h-g13 text-status-danger" />
                <span>{t('notifications.delete_selected', 'Hapus Terpilih')}</span>
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* 3. Main Standard Table Card */}
      <Card className="border-border/80 overflow-hidden">
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            {/* Table Header */}
            <TableHeader>
              <TableRow>
                {/* 0. Checkbox */}
                <TableColumnHeader className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox aria-label={t('table.select_all', 'Pilih semua baris')} checked={isAllCurrentSelected} onCheckedChange={(details) => toggleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>

                {/* 1. Created time */}
                {visibleColumns.time && (
                  <TableColumnHeader
                    onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                  >
                    <div className="flex items-center gap-g5">
                      <span>{t('notifications.col_created_time', 'Created time')}</span>
                      {sortOrder === 'desc' ? (
                        <ArrowDown className="w-g13 h-g13 text-muted-foreground" />
                      ) : (
                        <ArrowUp className="w-g13 h-g13 text-muted-foreground" />
                      )}
                    </div>
                  </TableColumnHeader>
                )}

                {/* 2. Type */}
                {visibleColumns.type && (
                  <TableColumnHeader>{t('notifications.col_type_short', 'Type')}</TableColumnHeader>
                )}

                {/* 3. Subject */}
                {visibleColumns.subject && (
                  <TableColumnHeader>{t('notifications.col_subject', 'Subject')}</TableColumnHeader>
                )}

                {/* 4. Message */}
                {visibleColumns.message && (
                  <TableColumnHeader>{t('notifications.col_message', 'Message')}</TableColumnHeader>
                )}

                {/* 5. Recipient */}
                {visibleColumns.recipient && (
                  <TableColumnHeader>{t('notifications.col_recipient', 'Penerima')}</TableColumnHeader>
                )}

                {/* 6. Actions */}
                <TableColumnHeader className="text-right w-g89">
                  <div className="flex items-center justify-end">{t('notifications.col_actions', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>

            {/* Table Body */}
            <TableBody>
              {currentNotifications.length === 0 ? (
                <TableEmptyState colSpan={7} />
              ) : (
                currentNotifications.map((notif) => {
                  const isSelected = selectedIds.includes(notif.notif_id);
                  const isUnread = !notif.is_read;

                  return (
                    <TableRow
                      key={notif.notif_id}
                      className={` ${
 isSelected
 ? ' '
 : isUnread
 ? ' '
 : ''
 }`}
                    >
                      {/* Checkbox */}
                      <TableCell className="w-g42">
                        <div className="flex items-center justify-start">
                          <Checkbox aria-label={t('table.select_row', 'Pilih baris {id}', { id: notif.notif_id })} checked={isSelected} onCheckedChange={() => toggleSelectRow(notif.notif_id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>

                      {/* Created Time */}
                      {visibleColumns.time && (
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(notif.tanggal_terkirim)}
                        </TableCell>
                      )}

                      {/* Type Badge */}
                      {visibleColumns.type && (
                        <TableCell className="whitespace-nowrap">
                          <Badge
                            tone={statusTone(
 notif.jenis_notifikasi
 )}
                          >
                            {notif.jenis_notifikasi}
                          </Badge>
                        </TableCell>
                      )}

                      {/* Subject */}
                      {visibleColumns.subject && (
                        <TableCell className="whitespace-nowrap">
                          <span className="font-medium">
                            {notif.parent_nomor || notif.parent_id}
                          </span>
                          {notif.parent_judul && (
                            <span className="text-muted-foreground ml-g5">
                              • {notif.parent_judul}
                            </span>
                          )}
                        </TableCell>
                      )}

                      {/* Message */}
                      {visibleColumns.message && (
                        <TableCell className="max-w-g377">
                          <Tooltip><TooltipTrigger asChild><span className="block truncate">
                            {notificationMessage(notif, t)}
                          </span></TooltipTrigger><TooltipBody>{notificationMessage(notif, t)}</TooltipBody></Tooltip>
                        </TableCell>
                      )}

                      {/* Recipient */}
                      {visibleColumns.recipient && (
                        <TableCell className="whitespace-nowrap">
                          {notif.penerima}
                        </TableCell>
                      )}

                      {/* Actions */}
                      <TableCell className="text-right whitespace-nowrap w-g89">
                        <div className="flex items-center justify-end gap-g5">
                          {/* Mark Read Checkmark Button */}
                          {isUnread && onMarkRead && (
                            <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
                              type="button"
                              onClick={(e) => handleMarkSingleRead(notif.notif_id, e)} aria-label={t('notifications.mark_read', 'Tandai Dibaca')}
                            >
                              <CheckCircle2 className="w-g16 h-g16" />
                            </Button></TooltipTrigger><TooltipBody>{t('notifications.mark_read', 'Tandai Dibaca')}</TooltipBody></Tooltip>
                          )}

                          {/* Delete Trash Button */}
                          {onDeleteNotif && (
                            <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
                              type="button"
                              onClick={(e) => handleDeleteSingle(notif.notif_id, e)} aria-label={t('notifications.delete_notif', 'Hapus Notifikasi')}
                            >
                              <Trash2 className="w-g16 h-g16" />
                            </Button></TooltipTrigger><TooltipBody>{t('notifications.delete_notif', 'Hapus Notifikasi')}</TooltipBody></Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableScrollArea>

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
      </Card>
    </div>
  );
};
