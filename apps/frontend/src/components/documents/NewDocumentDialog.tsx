import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Search, X } from 'lucide-react';
import { ModalFrame, ModalTitle } from '../ui/modal-frame';
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
        <ModalTitle className="ds-modal-title flex items-center gap-2">
          {t('documents.new_dialog.title', 'Buat dokumen')}
        </ModalTitle>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close', 'Tutup')}
          className="inline-flex size-10 items-center justify-center rounded-md text-ink-soft hover:bg-surface-2 dark:hover:bg-surface-2 cursor-pointer"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="overflow-y-auto px-6 pb-6 space-y-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('documents.new_dialog.search', 'Cari template...')}
            aria-label={t('documents.new_dialog.search', 'Cari template...')}
            className="ds-input w-full pl-10 pr-3"
          />
        </div>

        <section aria-labelledby="new-doc-scratch">
          <h3 id="new-doc-scratch" className="mb-2 text-sm font-semibold text-ink">
            {t('documents.new_dialog.scratch', 'Mulai dari awal')}
          </h3>
          <div className="ds-choice-grid">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={`${cardClass} border-dashed text-accent-text hover:border-accent hover:bg-accent-soft/40`}
            >
              <Plus className="h-5 w-5" aria-hidden />
              {t('documents.new_dialog.blank', 'Dokumen kosong')}
            </button>
          </div>
        </section>

        <section aria-labelledby="new-doc-templates">
          <h3 id="new-doc-templates" className="mb-2 text-sm font-semibold text-ink">
            {t('documents.new_dialog.templates', 'Template')}
          </h3>
          {visible.length === 0 ? (
            <p className="text-sm text-ink-soft">{t('documents.new_dialog.no_match', 'Tidak ada template yang cocok.')}</p>
          ) : (
            <div className="ds-choice-grid">
              {visible.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onSelect(tpl.load())}
                  className={`${cardClass} border border-hairline bg-surface dark:bg-surface-2/60 text-ink hover:border-accent hover:bg-surface dark:hover:bg-surface-2`}
                >
                  <FileText className="h-7 w-7 text-accent-text" aria-hidden />
                  <span className="line-clamp-2">{tpl.name}</span>
                  <span className="text-xs font-medium text-ink-soft">
                    {tpl.builtIn
                      ? t('documents.new_dialog.built_in', 'Template bawaan')
                      : tpl.updatedAt
                        ? new Date(tpl.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })
                        : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {status === 'loading' && (
            <p role="status" className="mt-3 text-xs text-ink-soft">{t('common.loading', 'Loading…')}</p>
          )}
          {status === 'error' && (
            <p role="alert" className="ds-alert ds-status-danger border">
              {t('documents.new_dialog.load_failed', 'Template organisasi gagal dimuat. Template bawaan tetap tersedia.')}
            </p>
          )}
        </section>
      </div>
    </ModalFrame>
  );
};
