import React, { useState } from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import {
  Radio,
  Search,
  Copy,
  Check,
  RotateCcw,
  X,
} from 'lucide-react';
import { ConsoleSession } from './types';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { TableEmptyState } from '../ui/table-empty-state';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
interface AdminSessionsTabProps {
  sessions: ConsoleSession[];
  onRevokeSession: (sessionId: string) => void;
  onRevokeAllUserSessions: (userId: string) => void;
}

export const AdminSessionsTab: React.FC<AdminSessionsTabProps> = ({
  sessions,
  onRevokeSession,
  onRevokeAllUserSessions,
}) => {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError('');
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopyError(t('admin.copy_failed', 'Token tidak dapat disalin.'));
    }
  };

  const activeSessionCount = sessions.filter((session) => new Date(session.expiresAt) >= new Date()).length;

  const filteredSessions = sessions.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      (s.userName || '').toLowerCase().includes(q) ||
      (s.userEmail || '').toLowerCase().includes(q) ||
      (s.ipAddress || '').toLowerCase().includes(q) ||
      (s.userAgent || '').toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <Card className="mobile-controls-bar flex flex-col items-stretch justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <InputGroup className="relative min-w-[220px] max-w-md flex-1">
          <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput
            type="text"
            aria-label={t('admin.sess_search_ph', 'Cari sesi berdasarkan email, IP, browser, token...')}
            placeholder={t('admin.sess_search_ph', 'Cari sesi berdasarkan email, IP, browser, token...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Radio className="h-4 w-4 animate-pulse text-status-success" aria-hidden="true" />
          <span>
            <strong className="text-foreground">{activeSessionCount}</strong> {t('admin.active_sessions_in_database', 'Sesi aktif di database')}
          </span>
        </div>
      </Card>
      {copyError && <Alert status="error" role="alert"><AlertContent>{copyError}</AlertContent></Alert>}

      {/* Sessions Table */}
      <Card className="overflow-hidden">
        <TableScrollArea className="rounded-none border-0">
          <Table className="w-full text-left">
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="text-left align-middle">
                  {t('admin.col_identifier', 'Pengguna')}
                </TableColumnHeader>
                <TableColumnHeader scope="col" className="text-left align-middle">
                  {t('admin.col_token', 'Session Token')}
                </TableColumnHeader>
                <TableColumnHeader scope="col" className="text-left align-middle">
                  {t('admin.col_ip_agent', 'IP Address & Device')}
                </TableColumnHeader>
                <TableColumnHeader scope="col" className="text-left align-middle">
                  {t('admin.col_started', 'Mulai Login')}
                </TableColumnHeader>
                <TableColumnHeader scope="col" className="text-left align-middle">
                  {t('admin.col_expires', 'Kadaluarsa')}
                </TableColumnHeader>
                <TableColumnHeader scope="col" className="text-right w-20 align-middle">
                  <div className="flex items-center justify-end">{t('admin.col_action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSessions.length === 0 ? (
                <TableEmptyState colSpan={6} />
              ) : (
                filteredSessions.map((s) => {
                  const isCopied = copiedId === s.id;
                  const isExpired = new Date(s.expiresAt) < new Date();
                  const displayName = s.userName || t('admin.unnamed', 'Unnamed');

                  return (
                    <TableRow key={s.id}>
                      {/* User */}
                      <TableCell className="text-left align-middle">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-foreground font-semibold shrink-0">
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground truncate">
                              {displayName}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {s.userEmail}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Token Preview */}
                      <TableCell className="text-left align-middle font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm">
                            {s.token ? `${s.token.slice(0, 12)}...` : `${(s.id || '').slice(0, 12)}...`}
                          </span>
                          <Button variant="ghost" size="icon-sm"
                            type="button"
                            onClick={() => handleCopy(s.token || s.id, s.id)}
                            title={t('admin.copy_token', 'Copy Token')}
                            aria-label={t('admin.copy_token', 'Salin token sesi')}
                          >
                            {isCopied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                      </TableCell>

                      {/* IP & User Agent */}
                      <TableCell className="text-left align-middle">
                        <div className="font-mono text-xs text-foreground">
                          {s.ipAddress || t('admin.not_available', 'Tidak tersedia')}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={s.userAgent}>
                          {s.userAgent || t('admin.standard_browser', 'Standard Browser')}
                        </div>
                      </TableCell>

                      {/* Created At */}
                      <TableCell className="text-left align-middle">
                        {new Date(s.createdAt).toLocaleString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>

                      {/* Expires At */}
                      <TableCell className="text-left align-middle">
                        {isExpired ? (
                          <Badge tone="danger" className="gap-1">
                            {t('status.expired', 'Expired')}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {new Date(s.expiresAt).toLocaleDateString(getActiveFormattingLocale(), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right align-middle w-20">
                        <div className="flex items-center justify-end gap-1">
                          {s.userId && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-md"
                              onClick={() => onRevokeAllUserSessions(s.userId)}
                              aria-label={t('admin.revoke_all_user_sessions', 'Cabut Semua Sesi User')}
                              title={t('admin.revoke_all_user_sessions', 'Cabut Semua Sesi User')}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-md"
                            onClick={() => onRevokeSession(s.id)}
                            aria-label={t('admin.revoke_session', 'Cabut Sesi')}
                            title={t('admin.revoke_session', 'Cabut Sesi')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableScrollArea>
      </Card>
    </div>
  );
};
