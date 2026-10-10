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
      <div className="ds-panel mobile-controls-bar flex flex-col items-stretch justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
          <input
            type="text"
            aria-label={t('admin.sess_search_ph', 'Cari sesi berdasarkan email, IP, browser, token...')}
            placeholder={t('admin.sess_search_ph', 'Cari sesi berdasarkan email, IP, browser, token...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ds-input w-full pl-9 pr-3"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
          <Radio className="h-4 w-4 animate-pulse text-status-success" aria-hidden="true" />
          <span>
            <strong className="text-ink">{activeSessionCount}</strong> {t('admin.active_sessions_in_database', 'Sesi aktif di database')}
          </span>
        </div>
      </div>
      {copyError && <div role="alert" className="ds-alert ds-status-danger border">{copyError}</div>}

      {/* Sessions Table */}
      <div className="ds-table-surface bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto ds-table-surface bg-surface">
          <table className="ds-table w-full text-left border-collapse text-xs bg-surface">
            <thead className="bg-surface dark:bg-surface-2/50">
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                  {t('admin.col_identifier', 'Pengguna')}
                </th>
                <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                  {t('admin.col_token', 'Session Token')}
                </th>
                <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                  {t('admin.col_ip_agent', 'IP Address & Device')}
                </th>
                <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                  {t('admin.col_started', 'Mulai Login')}
                </th>
                <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                  {t('admin.col_expires', 'Kadaluarsa')}
                </th>
                <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('admin.col_action', 'Aksi')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filteredSessions.length === 0 ? (
                <TableEmptyState colSpan={6} />
              ) : (
                filteredSessions.map((s) => {
                  const isCopied = copiedId === s.id;
                  const isExpired = new Date(s.expiresAt) < new Date();
                  const displayName = s.userName || t('admin.unnamed', 'Unnamed');

                  return (
                    <tr key={s.id} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors">
                      {/* User */}
                      <td className="py-4 px-4 text-left align-middle">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink font-semibold shrink-0">
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-ink truncate">
                              {displayName}
                            </div>
                            <div className="text-xs text-ink-soft truncate">
                              {s.userEmail}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Token Preview */}
                      <td className="py-4 px-4 text-left align-middle font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-ink-soft bg-surface-2 px-1.5 py-0.5 rounded-sm">
                            {s.token ? `${s.token.slice(0, 12)}...` : `${(s.id || '').slice(0, 12)}...`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(s.token || s.id, s.id)}
                            className="inline-flex items-center justify-center size-8 text-ink-soft hover:text-ink-soft dark:hover:text-ink"
                            title={t('admin.copy_token', 'Copy Token')}
                            aria-label={t('admin.copy_token', 'Salin token sesi')}
                          >
                            {isCopied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>

                      {/* IP & User Agent */}
                      <td className="py-4 px-4 text-left align-middle">
                        <div className="font-mono text-xs text-ink">
                          {s.ipAddress || t('admin.not_available', 'Tidak tersedia')}
                        </div>
                        <div className="text-xs text-ink-soft truncate max-w-[200px]" title={s.userAgent}>
                          {s.userAgent || t('admin.standard_browser', 'Standard Browser')}
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="py-4 px-4 text-left align-middle text-ink-soft text-xs">
                        {new Date(s.createdAt).toLocaleString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>

                      {/* Expires At */}
                      <td className="py-4 px-4 text-left align-middle">
                        {isExpired ? (
                          <Badge variant="destructive" className="gap-1 px-2 py-0.5 text-xs">
                            {t('status.expired', 'Expired')}
                          </Badge>
                        ) : (
                          <span className="text-ink-soft text-xs">
                            {new Date(s.expiresAt).toLocaleDateString(getActiveFormattingLocale(), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="pl-2 pr-6 py-4 text-right align-middle w-20">
                        <div className="flex items-center justify-end gap-1">
                          {s.userId && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => onRevokeAllUserSessions(s.userId)}
                              aria-label={t('admin.revoke_all_user_sessions', 'Cabut Semua Sesi User')}
                              title={t('admin.revoke_all_user_sessions', 'Cabut Semua Sesi User')}
                              className="w-7"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onRevokeSession(s.id)}
                            aria-label={t('admin.revoke_session', 'Cabut Sesi')}
                            title={t('admin.revoke_session', 'Cabut Sesi')}
                            className="w-7"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
