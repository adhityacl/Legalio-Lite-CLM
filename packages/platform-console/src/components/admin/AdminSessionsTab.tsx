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
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
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
    <div className="space-y-g13">
      {/* Controls Bar */}
      <Card className="flex flex-col items-stretch justify-between gap-g13 p-g13 sm:flex-row sm:items-center">
        <InputGroup className="relative min-w-g233 max-w-g377 flex-1">
          <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput
            type="text"
            aria-label={t('admin.sess_search_ph', 'Cari sesi berdasarkan email, IP, browser, token...')}
            placeholder={t('admin.sess_search_ph', 'Cari sesi berdasarkan email, IP, browser, token...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <div className="flex shrink-0 items-center gap-g8 text-xs text-muted-foreground">
          <Radio className="h-g16 w-g16 animate-pulse text-status-success" aria-hidden="true" />
          <span>
            <strong className="text-foreground">{activeSessionCount}</strong> {t('admin.active_sessions_in_database', 'Sesi aktif di database')}
          </span>
        </div>
      </Card>
      {copyError && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{copyError}</AlertDescription></AlertContent></Alert>}

      {/* Sessions Table */}
      <Card className="overflow-hidden">
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col">
                  {t('admin.col_identifier', 'Pengguna')}
                </TableColumnHeader>
                <TableColumnHeader scope="col">
                  {t('admin.col_token', 'Session Token')}
                </TableColumnHeader>
                <TableColumnHeader scope="col">
                  {t('admin.col_ip_agent', 'IP Address & Device')}
                </TableColumnHeader>
                <TableColumnHeader scope="col">
                  {t('admin.col_started', 'Mulai Login')}
                </TableColumnHeader>
                <TableColumnHeader scope="col">
                  {t('admin.col_expires', 'Kadaluarsa')}
                </TableColumnHeader>
                <TableColumnHeader scope="col" className="text-right w-g89">
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
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-g8">
                          <Avatar size="sm" className="bg-muted text-foreground shrink-0"><AvatarFallback className="bg-transparent text-inherit">{displayName.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                          <span className="truncate text-foreground">{displayName}</span>
                          <Text as="span" size="xs" tone="muted" className="truncate">{s.userEmail}</Text>
                        </div>
                      </TableCell>

                      {/* Token Preview */}
                      <TableCell className="font-mono">
                        <div className="flex items-center gap-g5">
                          <Badge tone="neutral">{s.token ? `${s.token.slice(0, 12)}...` : `${(s.id || '').slice(0, 12)}...`}</Badge>
                          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm"
                            type="button"
                            onClick={() => handleCopy(s.token || s.id, s.id)}
                            aria-label={t('admin.copy_token', 'Salin token sesi')}
                          >
                            {isCopied ? <Check className="w-g13 h-g13 text-status-success" /> : <Copy className="w-g13 h-g13" />}
                          </Button></TooltipTrigger><TooltipBody>{t('admin.copy_token', 'Copy Token')}</TooltipBody></Tooltip>
                        </div>
                      </TableCell>

                      {/* IP & User Agent */}
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-g8">
                          <Text as="span" size="xs" className="shrink-0 font-mono">{s.ipAddress || t('admin.not_available', 'Tidak tersedia')}</Text>
                          <Tooltip><TooltipTrigger asChild><Text as="span" size="xs" tone="muted" className="max-w-g233 truncate">{s.userAgent || t('admin.standard_browser', 'Standard Browser')}</Text></TooltipTrigger><TooltipBody>{s.userAgent}</TooltipBody></Tooltip>
                        </div>
                      </TableCell>

                      {/* Created At */}
                      <TableCell>
                        {new Date(s.createdAt).toLocaleString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>

                      {/* Expires At */}
                      <TableCell>
                        {isExpired ? (
                          <Badge tone="danger" className="gap-g3">
                            {t('status.expired', 'Expired')}
                          </Badge>
                        ) : (
                          <Text as="span" size="xs" tone="muted">
                            {new Date(s.expiresAt).toLocaleDateString(getActiveFormattingLocale(), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </Text>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right w-g89">
                        <div className="flex items-center justify-end gap-g3">
                          {s.userId && (
                            <Tooltip><TooltipTrigger asChild><Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => onRevokeAllUserSessions(s.userId)}
                              aria-label={t('admin.revoke_all_user_sessions', 'Cabut Semua Sesi User')}
                            >
                              <RotateCcw className="w-g13 h-g13" />
                            </Button></TooltipTrigger><TooltipBody>{t('admin.revoke_all_user_sessions', 'Cabut Semua Sesi User')}</TooltipBody></Tooltip>
                          )}
                          <Tooltip><TooltipTrigger asChild><Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onRevokeSession(s.id)}
                            aria-label={t('admin.revoke_session', 'Cabut Sesi')}
                          >
                            <X className="w-g13 h-g13" />
                          </Button></TooltipTrigger><TooltipBody>{t('admin.revoke_session', 'Cabut Sesi')}</TooltipBody></Tooltip>
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
