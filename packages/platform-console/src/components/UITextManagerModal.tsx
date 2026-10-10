import { ModalFrame, ModalTitle } from './ui/modal-frame';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import React, { useRef, useState } from 'react';
import { LANGUAGE_OPTIONS, useLanguage, type Language } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { AlertCircle, Check, Download, Edit2, FileSpreadsheet, Languages, RotateCcw, Search, Sparkles, Upload, X } from 'lucide-react';
import { TablePagination } from './ui/TablePagination';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

interface UITextManagerModalProps {
  isOpen?: boolean;
  onClose: () => void;
}

const CODES: Language[] = ['ID', 'EN', 'ZH'];
const BADGE = 'text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center justify-center whitespace-nowrap shadow-2xs';

/** Built-in and customised UI texts in every language, with inline editing and CSV round-trip. */
export const UITextManagerModal: React.FC<UITextManagerModalProps> = ({ isOpen = true, onClose }) => {
  const { t, translations, customTranslations, exportToCSV, importFromCSV, resetCustomTranslations, updateSingleTranslation, translationsBusy, translationsError } =
    useLanguage();
  const confirmDialog = useConfirm();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('ALL');
  const [editing, setEditing] = useState<{ key: string; lang: Language; value: string } | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const valueOf = (key: string, lang: Language) => {
    const custom = customTranslations[lang]?.[key];
    return custom !== undefined && custom !== '' ? custom : translations[lang]?.[key] || '';
  };
  const moduleOf = (key: string) => (key.includes('.') ? key.split('.')[0] : key.split('_')[0]) || 'General';
  const moduleLabel = (mod: string) => t(`ui_text.module.${mod}`, mod);

  const allKeys = Array.from(
    new Set(CODES.flatMap((code) => [...Object.keys(translations[code]), ...Object.keys(customTranslations[code] || {})])),
  ).sort();
  const modules = Array.from(new Set(allKeys.map(moduleOf))).sort();
  const search = searchTerm.trim().toLowerCase();
  const filteredKeys = allKeys.filter((key) => {
    const mod = moduleOf(key);
    if (selectedModule !== 'ALL' && mod !== selectedModule) return false;
    if (!search) return true;
    return [key, mod, moduleLabel(mod), ...CODES.map((code) => valueOf(key, code))].some((v) => v.toLowerCase().includes(search));
  });

  const totalPages = Math.ceil(filteredKeys.length / rowsPerPage);
  const currentKeys = filteredKeys.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const totalCustomCount = CODES.reduce((sum, code) => sum + Object.keys(customTranslations[code] || {}).length, 0);
  const languageName = (code: Language) => LANGUAGE_OPTIONS.find((o) => o.code === code)?.nativeName || code;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      const result = await importFromCSV(content);
      setNotice(
        result.success
          ? { type: 'success', message: t('ui_text.import_success', 'Berhasil mengimpor & memperbarui {n} teks UI dari file CSV.', { n: result.updatedCount }) }
          : { type: 'error', message: result.error || t('ui_text.import_failed', 'Gagal memproses file CSV.') },
      );
    };
    reader.onerror = () => setNotice({ type: 'error', message: t('ui_text.read_failed', 'Gagal membaca file CSV.') });
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      await updateSingleTranslation(editing.key, editing.lang, editing.value);
      setNotice({
        type: 'success',
        message: t('ui_text.saved_label', 'Teks untuk key "{key}" ({lang}) berhasil diperbarui.', { key: editing.key, lang: languageName(editing.lang) }),
      });
      setEditing(null);
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : t('tb.texts_save_failed') });
    }
  };

  const handleReset = async () => {
    const ok = await confirmDialog({
      description: t('ui_text.reset_confirm', 'Reset seluruh teks UI ke pengaturan bawaan?'),
      tone: 'danger',
      confirmLabel: t('ui_text.reset_label', 'Reset'),
    });
    if (ok) {
      try {
        await resetCustomTranslations();
        setNotice({ type: 'success', message: t('ui_text.reset_done', 'Seluruh teks UI berhasil dikembalikan ke bawaan sistem.') });
      } catch (error) {
        setNotice({ type: 'error', message: error instanceof Error ? error.message : t('tb.texts_save_failed') });
      }
    }
  };

  const renderCell = (key: string, lang: Language) => {
    const custom = customTranslations[lang]?.[key];
    if (editing?.key === key && editing.lang === lang) {
      return (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveEdit();
          }}
        >
          <label className="sr-only" htmlFor={`ui-text-${key}-${lang}`}>
            {t('ui_text.edit_in', 'Edit dalam {lang}', { lang: languageName(lang) })}
          </label>
          <input
            id={`ui-text-${key}-${lang}`}
            type="text"
            lang={LANGUAGE_OPTIONS.find((o) => o.code === lang)?.htmlLang}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
            className="ds-input w-full"
            autoFocus
          />
          <button
            type="submit"
            disabled={translationsBusy}
            aria-busy={translationsBusy}
            className="ui-button ui-button-lg ui-button-icon cursor-pointer shrink-0 ds-button ds-button-lg ds-button-default"
            aria-label={t('common.save', 'Simpan')}
          >
            <Check className="w-3.5 h-3.5" aria-hidden />
          </button>
        </form>
      );
    }
    return (
      <div className="flex items-center justify-between gap-1 group">
        <span
          lang={LANGUAGE_OPTIONS.find((o) => o.code === lang)?.htmlLang}
          className={custom ? 'font-medium text-accent-text ' : 'text-ink '}
        >
          {valueOf(key, lang) || <em className="text-status-danger not-italic">{t('ui_text.missing', '(belum diterjemahkan)')}</em>}
        </span>
        <button
          type="button"
          onClick={() => setEditing({ key, lang, value: valueOf(key, lang) })}
          disabled={translationsBusy}
          className="inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-soft hover:text-accent-text size-8 cursor-pointer transition-opacity shrink-0"
          aria-label={t('ui_text.edit_in', 'Edit dalam {lang}', { lang: languageName(lang) })}
          title={t('ui_text.edit_in', 'Edit dalam {lang}', { lang: languageName(lang) })}
        >
          <Edit2 className="w-3 h-3" aria-hidden />
        </button>
      </div>
    );
  };

  return (
    <ModalFrame onClose={onClose} className="max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden">

        <div className="ds-section-header">
          <div className="flex flex-wrap items-center gap-2">
            <ModalTitle className="ds-modal-title flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-accent-text" aria-hidden />
              <span>{t('ui_text.title', 'Struktur Teks UI & Ekspor / Impor CSV')}</span>
            </ModalTitle>
            {totalCustomCount > 0 && (
              <span className="text-xs font-bold text-status-success bg-status-success-soft dark:bg-status-success-soft/60 px-2 py-0.5 rounded-sm border border-status-success-border flex items-center gap-1">
                <Sparkles className="w-3 h-3" aria-hidden />
                {t('ui_text.custom_active', '{n} teks kustom aktif', { n: totalCustomCount })}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Tutup')}
            className="inline-flex items-center justify-center text-ink-soft hover:text-ink dark:hover:text-ink size-8 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="mobile-controls-bar p-4 bg-surface dark:bg-surface-2/60 border-b border-hairline flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="mobile-page-actions flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportToCSV}
              disabled={translationsBusy}
              className="ui-button ui-button-lg inline-flex items-center cursor-pointer ds-button ds-button-lg ds-button-outline"
            >
              <Download className="w-4 h-4 text-accent-text" aria-hidden />
              <span>{t('ui_text.export', 'Ekspor CSV')}</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={translationsBusy}
              className="theme-action ui-button ui-button-lg inline-flex items-center cursor-pointer ds-button ds-button-lg ds-button-ghost"
            >
              <Upload className="w-4 h-4" aria-hidden />
              <span>{t('ui_text.import', 'Unggah CSV Hasil Revisi')}</span>
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
            {totalCustomCount > 0 && (
              <button
                type="button"
                onClick={handleReset}
                disabled={translationsBusy}
                className="ui-button ui-button-lg inline-flex items-center cursor-pointer ds-button ds-button-lg ds-button-destructive"
              >
                <RotateCcw className="w-3.5 h-3.5 text-status-danger" aria-hidden />
                <span>{t('ui_text.reset_to_default', 'Kembalikan ke Bawaan')}</span>
              </button>
            )}
          </div>
          <div className="text-xs text-ink-soft font-medium flex items-center gap-1">
            <Languages className="w-4 h-4 text-status-success" aria-hidden />
            <span>{t('ui_text.total_keys', 'Total key teks: {n}', { n: allKeys.length })}</span>
          </div>
        </div>

        {translationsBusy && <p role="status" className="px-4 py-2 text-sm">{t('tb.texts_syncing')}</p>}
        {translationsError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{translationsError}</p>}
        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`px-6 py-3 border-b text-xs font-semibold flex items-center justify-between ${
              notice.type === 'success'
                ? 'bg-status-success-soft dark:bg-status-success-soft/40 border-status-success-border text-status-success '
                : 'bg-status-danger-soft dark:bg-status-danger-soft/40 border-status-danger-border text-status-danger '
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.type === 'success' ? (
                <Check className="w-4 h-4 text-status-success shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="w-4 h-4 text-status-danger shrink-0" aria-hidden />
              )}
              <span>{notice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={t('common.close', 'Tutup')}
              className="text-ink-soft hover:text-ink-soft dark:hover:text-ink cursor-pointer text-xs"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        )}

        <div className="p-4 border-b border-hairline bg-surface grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0 ds-grid">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-ink-soft" aria-hidden />
            <input
              type="search"
              aria-label={t('settings.search_ui_text', 'Cari kata kunci, ID key, atau teks UI...')}
              placeholder={t('settings.search_ui_text', 'Cari kata kunci, ID key, atau teks UI...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="ds-input w-full pl-9 pr-4"
            />
          </div>
          <AlphabeticalSelect
            aria-label={t('ui_text.module_filter', 'Filter modul')}
            value={selectedModule}
            onChange={(e) => {
              setSelectedModule(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input w-full"
          >
            <option value="ALL">{t('ui_text.all_modules', 'Semua modul ({n})', { n: allKeys.length })}</option>
            {modules.map((mod) => (
              <option key={mod} value={mod}>
                {moduleLabel(mod)} ({allKeys.filter((k) => moduleOf(k) === mod).length})
              </option>
            ))}
          </AlphabeticalSelect>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface dark:bg-surface/60">
          <div className="ds-table-surface bg-surface border border-hairline rounded-xl overflow-x-auto shadow-xs">
            <table className="ds-table w-full text-left text-xs border-collapse">
              <thead className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink">
                <tr>
                  <th scope="col" className="p-4 w-1/5">{t('ui_text.col_key', 'Key teks')}</th>
                  <th scope="col" className="p-4 w-1/8">{t('ui_text.col_module', 'Modul')}</th>
                  {CODES.map((code) => (
                    <th key={code} scope="col" className="p-4 w-1/5">
                      {languageName(code)} ({LANGUAGE_OPTIONS.find((o) => o.code === code)?.label})
                    </th>
                  ))}
                  <th scope="col" className="p-4 text-center w-20">{t('ui_text.col_status', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline text-ink">
                {filteredKeys.length === 0 ? (
                  <TableEmptyState colSpan={CODES.length + 3} />
                ) : (
                  currentKeys.map((key) => {
                    const isCustom = CODES.some((code) => customTranslations[code]?.[key]);
                    return (
                      <tr key={key} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors align-top">
                        <td className="py-4 px-4 text-xs font-normal text-ink break-all">{key}</td>
                        <td className="py-4 px-4 text-left">
                          <span className={`${BADGE}  ${getStatusBadgeClass('Neutral')}`}>{moduleLabel(moduleOf(key))}</span>
                        </td>
                        {CODES.map((code) => (
                          <td key={code} className="py-4 px-4 text-xs font-normal text-ink">
                            {renderCell(key, code)}
                          </td>
                        ))}
                        <td className="py-4 px-4 text-center whitespace-nowrap">
                          <span className={`${BADGE}  ${getStatusBadgeClass(isCustom ? 'Aktif' : 'Neutral')}`}>
                            {isCustom ? t('ui_text.status_custom', 'Kustom') : t('ui_text.status_default', 'Bawaan')}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              rowsPerPage={rowsPerPage}
              onPageChange={setCurrentPage}
              onRowsPerPageChange={(n) => {
                setRowsPerPage(n);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        <div className="p-4 sm:p-5 bg-surface border-t border-hairline flex items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-ink-soft">
            {t(
              'ui_text.hint',
              'Petunjuk: ekspor CSV untuk mengunduh semua teks (Indonesia, Inggris, Mandarin), edit di Excel / Google Sheets, lalu unggah kembali file CSV tersebut di sini.',
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center px-4 min-h-8 bg-ink hover:bg-ink dark:bg-surface-2 dark:hover:bg-surface-2 text-white font-semibold text-xs rounded-md cursor-pointer transition-colors shrink-0"
          >
            {t('ui_text.done', 'Selesai & Tutup')}
          </button>
        </div>

    </ModalFrame>
  );
};
