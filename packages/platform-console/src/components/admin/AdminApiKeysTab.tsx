import React, { useState } from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import {
  KeyRound,
  Plus,
  Search,
  Copy,
  Check,
  Shield,
  Ban,
  Trash2,
  Lock,
} from 'lucide-react';
import { ConsoleApiKey } from './types';
import { useLanguage } from '../../context/LanguageContext';
import { TableEmptyState } from '../ui/table-empty-state';

interface AdminApiKeysTabProps {
  apiKeys: ConsoleApiKey[];
  onOpenCreateKey: () => void;
  onRevokeKey: (keyId: string) => void;
  onDeleteKey: (keyId: string) => void;
}

export const AdminApiKeysTab: React.FC<AdminApiKeysTabProps> = ({
  apiKeys,
  onOpenCreateKey,
  onRevokeKey,
  onDeleteKey,
}) => {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredKeys = apiKeys.filter((k) =>
    k.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="ds-panel mobile-controls-bar flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input aria-label={t('admin.key_search_ph', 'Cari nama API Key...')}
            type="text"
            placeholder={t('admin.key_search_ph', 'Cari nama API Key...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ds-input w-full pl-9 pr-3"
          />
        </div>

        <button
          type="button"
          onClick={onOpenCreateKey}
          className="theme-action ui-button ui-button-lg ds-button ds-button-lg ds-button-ghost"
        >
          <Plus className="w-4 h-4" />
          <span>{t('admin.btn_generate_key', 'Generate API Key')}</span>
        </button>
      </div>

      {/* Keys Table */}
      <div className="ds-table-surface bg-surface rounded-xl border border-hairline overflow-hidden shadow-xs">
        <div className="overflow-x-auto ds-table-surface">
          <table className="ds-table w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-ink-soft font-semibold uppercase tracking-wider text-xs">
                <th className="py-3 px-4">{t('admin.col_key_name', 'Nama Kunci')}</th>
                <th className="py-3 px-4">{t('admin.col_key_token', 'Key Token')}</th>
                <th className="py-3 px-4">{t('admin.col_scopes', 'Cakupan Izin (Scopes)')}</th>
                <th className="py-3 px-4">{t('admin.col_status', 'Status')}</th>
                <th className="py-3 px-4">{t('admin.col_created_at', 'Dibuat')}</th>
                <th className="py-3 px-4 text-right">{t('admin.col_action', 'Aksi')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filteredKeys.length === 0 ? (
                <TableEmptyState colSpan={6} />
              ) : (
                filteredKeys.map((k) => (
                  <tr
                    key={k.id}
                    className="hover:bg-surface/70 dark:hover:bg-surface-2/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-ink flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-ink-soft" />
                        <span>{k.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="bg-surface-2 px-1.5 py-0.5 rounded-sm text-ink">
                          {k.keyPreview}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="text-xs font-mono px-1.5 py-0.2 rounded-sm bg-surface-2 text-ink-soft border border-hairline"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {k.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-status-success-soft text-status-success dark:bg-status-success-soft/50">
                          {t('admin.status_active', 'Aktif')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-status-danger-soft text-status-danger dark:bg-status-danger-soft/50">
                          {t('admin.status_revoked', 'Dicabut (Revoked)')}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-ink-soft text-xs">
                      {new Date(k.createdAt).toLocaleDateString(getActiveFormattingLocale())}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {k.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => onRevokeKey(k.id)}
                            className="inline-flex items-center px-2 min-h-8 rounded-sm text-xs font-semibold text-status-warning hover:bg-status-warning-soft dark:hover:bg-status-warning-soft/40 transition-colors"
                          >
                            {t('admin.btn_revoke', 'Cabut')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteKey(k.id)}
                          className="inline-flex items-center justify-center size-8 text-ink-soft hover:text-status-danger dark:hover:text-status-danger rounded-sm transition-colors"
                          title={t('admin.title_delete_key', 'Hapus Kunci')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
