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
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Badge } from '@legalio/ui-components/badge';
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
    <div className="space-y-g13">
      {/* Controls Bar */}
      <Card className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-g13 p-g13">
        <InputGroup className="relative flex-1 min-w-g233 max-w-g377">
          <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label={t('admin.key_search_ph', 'Cari nama API Key...')}
            type="text"
            placeholder={t('admin.key_search_ph', 'Cari nama API Key...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <Button
          type="button"
          onClick={onOpenCreateKey}
        >
          <Plus className="w-g16 h-g16" />
          <span>{t('admin.btn_generate_key', 'Generate API Key')}</span>
        </Button>
      </Card>

      {/* Keys Table */}
      <Card className="overflow-hidden">
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
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
                      <div className="font-semibold text-foreground flex items-center gap-g8">
                        <Lock className="w-g13 h-g13 text-muted-foreground" />
                        <span>{k.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">
                      <div className="flex items-center gap-g5">
                        <Badge tone="neutral">{k.keyPreview}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-g3">
                        {k.scopes.map((scope) => (
                          <Badge tone="neutral" className="font-mono" key={scope}>{scope}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {k.status === 'active' ? (
                        <Badge tone="success">{t('admin.status_active', 'Aktif')}</Badge>
                      ) : (
                        <Badge tone="danger">{t('admin.status_revoked', 'Dicabut (Revoked)')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(k.createdAt).toLocaleDateString(getActiveFormattingLocale())}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-g3">
                        {k.status === 'active' && (
                          <Button variant="ghost" size="sm"
                            type="button"
                            onClick={() => onRevokeKey(k.id)}
                          >
                            {t('admin.btn_revoke', 'Cabut')}
                          </Button>
                        )}
                        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm"
                          type="button"
                          onClick={() => onDeleteKey(k.id)}
                          className="text-destructive" aria-label={t('admin.title_delete_key', 'Hapus Kunci')}
                        >
                          <Trash2 className="w-g13 h-g13" />
                        </Button></TooltipTrigger><TooltipBody>{t('admin.title_delete_key', 'Hapus Kunci')}</TooltipBody></Tooltip>
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
