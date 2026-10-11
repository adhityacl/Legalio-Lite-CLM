import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Search, X } from 'lucide-react';
import { ModalFrame } from '../ui/modal-frame';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { getAuthHeaders } from '../../lib/apiFetch';
import { jurisdictionFromSettings } from '@legalio/shared/data/cooperationAgreementTemplate';
import {
  buildMasterServiceAgreementHtml,
  MASTER_SERVICE_AGREEMENT_CUSTOM_FIELDS,
  MASTER_SERVICE_AGREEMENT_ID,
  MASTER_SERVICE_AGREEMENT_NAME,
} from '@legalio/shared/data/masterServiceAgreementTemplate';

import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { DialogTitle, DialogCloseIcon } from '@legalio/ui-components/dialog';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
/** What the new document starts from; `null` means a blank document. */
export type NewDocumentChoice = { name: string; contentId: string; customFields: any[] } | null;

interface TemplateOption {
  id: string;
  name: string;
  builtIn: boolean;
  updatedAt?: string;
  load: () => Exclude<NewDocumentChoice, null>;
}

export const NewDocumentDialog: React.FC<{
  onSelect: (choice: NewDocumentChoice) => void;
  onClose: () => void;
}> = ({ onSelect, onClose }) => {
  const { t, language } = useLanguage();
  const { policy } = useTenantSettings();
  const [saved, setSaved] = useState<any[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/templates', { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          setSaved(Array.isArray(data) ? data : []);
          setStatus('ready');
        }
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  const templates = useMemo<TemplateOption[]>(() => {
    const builtIn: TemplateOption = {
      id: MASTER_SERVICE_AGREEMENT_ID,
      name: MASTER_SERVICE_AGREEMENT_NAME,
      builtIn: true,
      load: () => ({
        name: MASTER_SERVICE_AGREEMENT_NAME,
        contentId: buildMasterServiceAgreementHtml(jurisdictionFromSettings(policy.settings)),
        customFields: MASTER_SERVICE_AGREEMENT_CUSTOM_FIELDS,
      }),
    };
    const own = [...saved]
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .map<TemplateOption>((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        builtIn: false,
        updatedAt: tpl.updatedAt,
        load: () => ({ name: tpl.name, contentId: tpl.contentId, customFields: tpl.customFields || [] }),
      }));
    return [builtIn, ...own];
  }, [saved, policy.settings]);

  const visible = templates.filter((tpl) => tpl.name.toLowerCase().includes(query.trim().toLowerCase()));
  const dateLocale = language === 'ID' ? 'id-ID' : language === 'ZH' ? 'zh-CN' : 'en-US';
  // Template tiles: moduix outline Buttons laid out as a card grid.
  const cardClass = 'h-auto min-h-g110 w-full flex-col items-start justify-start gap-g8 whitespace-normal p-g13 text-start';
  const gridClass = 'grid grid-cols-1 gap-g13 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <ModalFrame size="lg" onClose={onClose} >
      <div className="flex items-center justify-between gap-g13 px-g21 pt-g21 pb-g13">
        <DialogTitle className="flex items-center gap-g8">
          {t('documents.new_dialog.title', 'Buat dokumen')}
        </DialogTitle>
        <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
      </div>

      <div className="overflow-y-auto px-g21 pb-g21 space-y-g21">
        <InputGroup className="relative">
          <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('documents.new_dialog.search', 'Cari template...')}
            aria-label={t('documents.new_dialog.search', 'Cari template...')}
          />
        </InputGroup>

        <section aria-labelledby="new-doc-scratch">
          <Heading as="h3" size="xs" weight="semibold" id="new-doc-scratch" className="mb-g8">
            {t('documents.new_dialog.scratch', 'Mulai dari awal')}
          </Heading>
          <div className={gridClass}>
            <Button variant="outline"
              type="button"
              onClick={() => onSelect(null)}
              className={cardClass}
            >
              <Plus className="h-g21 w-g21" aria-hidden />
              {t('documents.new_dialog.blank', 'Dokumen kosong')}
            </Button>
          </div>
        </section>

        <section aria-labelledby="new-doc-templates">
          <Heading as="h3" size="xs" weight="semibold" id="new-doc-templates" className="mb-g8">
            {t('documents.new_dialog.templates', 'Template')}
          </Heading>
          {visible.length === 0 ? (
            <Text size="sm" tone="muted">{t('documents.new_dialog.no_match', 'Tidak ada template yang cocok.')}</Text>
          ) : (
            <div className={gridClass}>
              {visible.map((tpl) => (
                <Button variant="outline"
                  key={tpl.id}
                  type="button"
                  onClick={() => onSelect(tpl.load())}
                  className={cardClass}
                >
                  <FileText className="size-g26 text-accent-foreground" aria-hidden />
                  <span className="line-clamp-2">{tpl.name}</span>
                  <Text as="span" size="xs" weight="medium" tone="muted">
                    {tpl.builtIn
                      ? t('documents.new_dialog.built_in', 'Template bawaan')
                      : tpl.updatedAt
                        ? new Date(tpl.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })
                        : ''}
                  </Text>
                </Button>
              ))}
            </div>
          )}
          {status === 'loading' && (
            <Text size="xs" tone="muted" className="mt-g13" role="status">{t('common.loading', 'Loading…')}</Text>
          )}
          {status === 'error' && (
            <Alert status="error" role="alert"><AlertIndicator />
              <AlertContent><AlertDescription>{t('documents.new_dialog.load_failed', 'Template organisasi gagal dimuat. Template bawaan tetap tersedia.')}</AlertDescription></AlertContent>
            </Alert>
          )}
        </section>
      </div>
    </ModalFrame>
  );
};
