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
import { Alert, AlertContent } from '@legalio/ui-components/alert';
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
  const cardClass =
    'ds-choice';

  return (
    <ModalFrame onClose={onClose} className="max-w-3xl">
      <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
        <DialogTitle className="flex items-center gap-2">
          {t('documents.new_dialog.title', 'Buat dokumen')}
        </DialogTitle>
        <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
      </div>

      <div className="overflow-y-auto px-6 pb-6 space-y-5">
        <InputGroup className="relative">
          <InputGroupAddon><Search className="size-4" aria-hidden="true" aria-hidden /></InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('documents.new_dialog.search', 'Cari template...')}
            aria-label={t('documents.new_dialog.search', 'Cari template...')}
          />
        </InputGroup>

        <section aria-labelledby="new-doc-scratch">
          <h3 id="new-doc-scratch" className="mb-2 text-sm font-semibold text-foreground">
            {t('documents.new_dialog.scratch', 'Mulai dari awal')}
          </h3>
          <div>
            <Button variant="outline"
              type="button"
              onClick={() => onSelect(null)}
              className={`${cardClass} `}
            >
              <Plus className="h-5 w-5" aria-hidden />
              {t('documents.new_dialog.blank', 'Dokumen kosong')}
            </Button>
          </div>
        </section>

        <section aria-labelledby="new-doc-templates">
          <h3 id="new-doc-templates" className="mb-2 text-sm font-semibold text-foreground">
            {t('documents.new_dialog.templates', 'Template')}
          </h3>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('documents.new_dialog.no_match', 'Tidak ada template yang cocok.')}</p>
          ) : (
            <div>
              {visible.map((tpl) => (
                <Button variant="outline"
                  key={tpl.id}
                  type="button"
                  onClick={() => onSelect(tpl.load())}
                  className={`${cardClass} `}
                >
                  <FileText className="h-7 w-7 text-accent-foreground" aria-hidden />
                  <span className="line-clamp-2">{tpl.name}</span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {tpl.builtIn
                      ? t('documents.new_dialog.built_in', 'Template bawaan')
                      : tpl.updatedAt
                        ? new Date(tpl.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })
                        : ''}
                  </span>
                </Button>
              ))}
            </div>
          )}
          {status === 'loading' && (
            <p role="status" className="mt-3 text-xs text-muted-foreground">{t('common.loading', 'Loading…')}</p>
          )}
          {status === 'error' && (
            <Alert status="error" role="alert">
              <AlertContent>{t('documents.new_dialog.load_failed', 'Template organisasi gagal dimuat. Template bawaan tetap tersedia.')}</AlertContent>
            </Alert>
          )}
        </section>
      </div>
    </ModalFrame>
  );
};
