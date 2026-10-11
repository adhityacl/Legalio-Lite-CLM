import { ModalFrame } from './ui/modal-frame';
import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
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
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Spinner } from '@legalio/ui-components/spinner';
import { Text } from '@legalio/ui-components/text';
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
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedRows(filteredLogs.map(item => item.id || ''));
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
        return statusTone('Active');
      case 'LOGOUT':
        return statusTone('Neutral');
      case 'CREATE':
        return statusTone('Legal');
      case 'UPDATE':
      case 'DD_UPDATE':
        return statusTone('Expiring');
      case 'DELETE':
      case 'UPLOAD_FAILED':
      case 'SYSTEM_ERROR':
        return statusTone('Expired');
      case 'ADD_USER':
        return statusTone('Admin');
      default:
        return statusTone('Neutral');
    }
  };

  return (
    <div className="space-y-g21">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('logs.title', 'Log Aktivitas Sesi System')}</span>
          </Heading>
        </div>

        <Button
          onClick={loadLogs}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}
          <span>{t('logs.refresh_btn', 'Refresh Log')}</span>
        </Button>
      </div>

      {/* Filter Bar with 3 Dropdowns */}
      <Card className="flex flex-col items-start justify-between gap-g13 p-g13 md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-g13 w-full">
          {/* 1 Box Search */}
          <InputGroup className="relative flex-1 min-w-g233 md:max-w-g377">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput aria-label={t('logs.search_placeholder', 'Cari aktivitas, email, atau deskripsi...')}
              type="text"
              placeholder={t('logs.search_placeholder', 'Cari aktivitas, email, atau deskripsi...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </InputGroup>

          {/* Filter 1: Modul */}
          <AlphabeticalSelect aria-label={t('logs.all_modules', 'Semua Modul')}
            value={filterModule}
            onChange={(e) => {
              setFilterModule(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
          <NativeSelect aria-label={t('notifications.all_time_periods', 'Semua Periode Waktu')}
            value={selectedTimeRange}
            onChange={(e) => {
              setSelectedTimeRange(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('notifications.all_time_periods', 'Semua Periode Waktu')}</option>
            <option value="TODAY">{t('notifications.time_today', 'Hari Ini (24 Jam Terakhir)')}</option>
            <option value="7_DAYS">{t('notifications.time_7_days', '7 Hari Terakhir')}</option>
            <option value="30_DAYS">{t('notifications.time_30_days', '30 Hari Terakhir')}</option>
          </NativeSelect>
        </div>

        {/* View Toggle */}
        <TableViewMenu className="ml-auto" title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
          {Object.keys(visibleColumns).map((col) => {
            let label = col;
            if (col === 'time') label = 'Waktu';
            else if (col === 'user') label = 'Pengguna';
            else if (col === 'action') label = 'Jenis Aksi';
            else if (col === 'module') label = 'Modul';
            else if (col === 'detail') label = 'Rincian Deskripsi';

            return (
              <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>
            );
          })}
        </TableViewMenu>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox checked={selectedRows.length > 0 && selectedRows.length === currentLogs.length} aria-label={t('logs.pilih_semua_log_aktivitas', 'Pilih semua log aktivitas')} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.time && <TableColumnHeader scope="col">{t('logs.col_time', 'Waktu')}</TableColumnHeader>}
                {visibleColumns.user && <TableColumnHeader scope="col">{t('logs.col_user', 'Pengguna')}</TableColumnHeader>}
                {visibleColumns.action && <TableColumnHeader scope="col">{t('logs.col_action', 'Jenis Aksi')}</TableColumnHeader>}
                {visibleColumns.module && <TableColumnHeader scope="col">{t('logs.col_module', 'Modul')}</TableColumnHeader>}
                {visibleColumns.detail && <TableColumnHeader scope="col">{t('logs.col_detail', 'Rincian Deskripsi')}</TableColumnHeader>}
                <TableColumnHeader scope="col" className="text-right w-g89">
                  <div className="flex items-center justify-end">{t('dashboard.action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} message={t('logs.loading', 'Memuat log aktivitas...')} />
              ) : currentLogs.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                currentLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div className="flex items-center justify-start">
                        <Checkbox aria-label={t('logs.pilih_log_oleh', 'Pilih log {actionType} oleh {userEmail}', { actionType: log.actionType, userEmail: log.userName || log.userEmail })} checked={selectedRows.includes(log.id || '')} onCheckedChange={() => handleSelectRow(log.id || '')}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                      </div>
                    </TableCell>

                    {/* 1. Waktu */}
                    {visibleColumns.time && (
                      <TableCell className="whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString(getActiveFormattingLocale(), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </TableCell>
                    )}

                    {/* 2. Pengguna */}
                    {visibleColumns.user && (
                      <TableCell className="whitespace-nowrap">
                        {log.userName || log.userEmail}
                      </TableCell>
                    )}

                    {/* 3. Jenis Aksi */}
                    {visibleColumns.action && (
                      <TableCell>
                        <Badge
                          tone={getActionBadge(
 log.actionType
 )}
                        >
                          {log.actionType}
                        </Badge>
                      </TableCell>
                    )}

                    {/* 4. Modul */}
                    {visibleColumns.module && (
                      <TableCell className="whitespace-nowrap">
                        <Badge tone={statusTone(log.module)}>
                          {log.module}
                        </Badge>
                      </TableCell>
                    )}

                    {/* 5. Rincian Deskripsi */}
                    {visibleColumns.detail && (
                      <TableCell className="max-w-g377">
                        <Tooltip><TooltipTrigger asChild><Text size="sm" className="line-clamp-1">{log.description}</Text></TooltipTrigger><TooltipBody>{log.description}</TooltipBody></Tooltip>
                      </TableCell>
                    )}

                    {/* 6. Aksi */}
                    <TableCell className="text-right w-g89">
                      <div className="flex items-center justify-end">
                        <ActionMenu
                          items={[
                            {
                              label: t('io.action_detail', 'Detail'),
                              icon: <Eye className="w-g13 h-g13" />,
                              onClick: () => setSelectedLogForDetail(log),
                            },
                          ]}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScrollArea>

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
      </Card>

      {/* Detail Modal */}
      {selectedLogForDetail && (
        <ModalFrame onClose={() => setSelectedLogForDetail(null)} className="max-w-g610 w-full overflow-hidden">

            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <div>
                <DialogTitle className="flex items-center gap-g8">{t('logs.rincian_log_aktivitas', 'Rincian Log Aktivitas')}</DialogTitle>
                <Text size="xs" tone="muted" className="mt-g2">{t('logs.id', 'ID: {id}', { id: selectedLogForDetail.id })}</Text>
              </div>
              <Button variant="ghost" aria-label={t('common.close', 'Tutup')}
                onClick={() => setSelectedLogForDetail(null)}
              >
                ✕
              </Button>
            </DialogHeader>

            <div className="p-g21 space-y-g13 text-xs">
              <Card className="grid grid-cols-2 gap-g13 p-g13">
                <div>
                  <span className="text-muted-foreground font-medium block mb-g3">{t('notifications.col_time', 'Waktu')}</span>
                  <span className="font-semibold text-foreground">
                    {new Date(selectedLogForDetail.timestamp).toLocaleString(getActiveFormattingLocale(), {
                      dateStyle: 'full',
                      timeStyle: 'medium',
                    })}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium block mb-g3">{t('admin.generic_user', 'Pengguna')}</span>
                  <span className="font-semibold text-foreground">
                    {selectedLogForDetail.userName || selectedLogForDetail.userEmail} ({selectedLogForDetail.role})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium block mb-g3">{t('logs.col_action', 'Jenis Aksi')}</span>
                  <Badge tone={getActionBadge(selectedLogForDetail.actionType)}>
                    {selectedLogForDetail.actionType}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium block mb-g3">{t('settings.region.modules', 'Modul')}</span>
                  <Badge tone={statusTone(selectedLogForDetail.module)}>
                    {selectedLogForDetail.module}
                  </Badge>
                </div>
              </Card>

              <div>
                <span className="text-muted-foreground font-semibold block mb-g5">{t('logs.deskripsi_detail_teknis', 'Deskripsi / Detail Teknis:')}</span>
                <div className="p-g13 bg-foreground text-primary-foreground rounded-xl font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap max-h-g233 overflow-y-auto">
                  {selectedLogForDetail.description}
                </div>
              </div>

              {(selectedLogForDetail.ipAddress || selectedLogForDetail.userAgent) && (
                <div className="pt-g8 border-t border-border space-y-g3 text-xs text-muted-foreground">
                  {selectedLogForDetail.ipAddress && <div><span className="font-semibold">{t('logs.ip_address', 'IP Address:')}</span> {selectedLogForDetail.ipAddress}</div>}
                  {selectedLogForDetail.userAgent && <div className="truncate"><span className="font-semibold">{t('logs.user_agent', 'User Agent:')}</span> {selectedLogForDetail.userAgent}</div>}
                </div>
              )}
            </div>

            <div className="p-g13 bg-card border-t border-border flex justify-end">
              <Button variant="ghost" size="sm"
                onClick={() => setSelectedLogForDetail(null)}
              >
                {t('redline.close', 'Tutup')}
              </Button>
            </div>

        </ModalFrame>
      )}
    </div>
  );
};
