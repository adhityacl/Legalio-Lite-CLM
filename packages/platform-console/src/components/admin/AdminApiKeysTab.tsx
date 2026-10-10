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

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Button } from '@legalio/ui-components/button';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
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
      <Card className="mobile-controls-bar flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4">
        <InputGroup className="relative flex-1 min-w-[220px] max-w-md">
          <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label={t('admin.key_search_ph', 'Cari nama API Key...')}
            type="text"
            placeholder={t('admin.key_search_ph', 'Cari nama API Key...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <Button variant="ghost"
          type="button"
          onClick={onOpenCreateKey}
        >
          <Plus className="w-4 h-4" />
          <span>{t('admin.btn_generate_key', 'Generate API Key')}</span>
        </Button>
      </Card>

      {/* Keys Table */}
      <Card className="overflow-hidden">
        <TableScrollArea>
          <Table className="w-full text-left">
            <TableHeader>
              <TableRow className="uppercase">
                <TableColumnHeader>{t('admin.col_key_name', 'Nama Kunci')}</TableColumnHeader>
                <TableColumnHeader>{t('admin.col_key_token', 'Key Token')}</TableColumnHeader>
                <TableColumnHeader>{t('admin.col_scopes', 'Cakupan Izin (Scopes)')}</TableColumnHeader>
                <TableColumnHeader>{t('admin.col_status', 'Status')}</TableColumnHeader>
                <TableColumnHeader>{t('admin.col_created_at', 'Dibuat')}</TableColumnHeader>
                <TableColumnHeader className="text-right">{t('admin.col_action', 'Aksi')}</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredKeys.length === 0 ? (
                <TableEmptyState colSpan={6} />
              ) : (
                filteredKeys.map((k) => (
                  <TableRow
                    key={k.id}
                  >
                    <TableCell>
                      <div className="font-semibold text-foreground flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{k.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="bg-muted px-1.5 py-0.5 rounded-sm text-foreground">
                          {k.keyPreview}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="text-xs font-mono px-1.5 py-0.2 rounded-sm bg-muted text-muted-foreground border border-border"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {k.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-status-success-soft text-status-success ">
                          {t('admin.status_active', 'Aktif')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-status-danger-soft text-status-danger ">
                          {t('admin.status_revoked', 'Dicabut (Revoked)')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(k.createdAt).toLocaleDateString(getActiveFormattingLocale())}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {k.status === 'active' && (
                          <Button variant="ghost" size="sm"
                            type="button"
                            onClick={() => onRevokeKey(k.id)}
                          >
                            {t('admin.btn_revoke', 'Cabut')}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm"
                          type="button"
                          onClick={() => onDeleteKey(k.id)}
                          className="text-destructive"
                          title={t('admin.title_delete_key', 'Hapus Kunci')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScrollArea>
      </Card>
    </div>
  );
};
