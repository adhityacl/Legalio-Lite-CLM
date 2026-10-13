import { ModalFrame } from './ui/modal-frame';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import React, { useRef, useState } from 'react';
import { LANGUAGE_OPTIONS, useLanguage, type Language } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { AlertCircle, Check, Download, Edit2, FileSpreadsheet, Languages, RotateCcw, Search, Sparkles, Upload, X } from 'lucide-react';
import { TablePagination } from './ui/TablePagination';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

import { Input } from '@legalio/ui-components/input';
import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell } from '@legalio/ui-components/table';
import { DialogHeader, DialogTitle, DialogCloseIcon } from '@legalio/ui-components/dialog';
import { Card } from '@legalio/ui-components/card';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { FileUpload, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Editable, EditableArea, EditableContext, EditableControl, EditableEditTrigger, EditableInput, EditablePreview, EditableSubmitTrigger } from '@legalio/ui-components/editable';
import { Text } from '@legalio/ui-components/text';
interface UITextManagerModalProps {
  isOpen?: boolean;
  onClose: () => void;
}

const CODES: Language[] = ['ID', 'EN', 'ZH'];
const BADGE = 'text-xs font-normal px-g13 py-g2 rounded-full border inline-flex items-center justify-center whitespace-nowrap shadow-2xs';

/** Built-in and customised UI texts in every language, with inline editing and CSV round-trip. */
export const UITextManagerModal: React.FC<UITextManagerModalProps> = ({ isOpen = true, onClose }) => {
  const { t, translations, customTranslations, exportToCSV, importFromCSV, resetCustomTranslations, updateSingleTranslation, translationsBusy, translationsError } =
    useLanguage();
  const confirmDialog = useConfirm();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('ALL');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  // FileUpload keeps accepted files; remount after each import so the same CSV can be chosen again.
  const [importKey, setImportKey] = useState(0);

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

  const handleFileUpload = (file: File | undefined) => {
    setImportKey(k => k + 1);
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
  };

  const handleSaveEdit = async (key: string, lang: Language, value: string) => {
    try {
      await updateSingleTranslation(key, lang, value);
      setNotice({
        type: 'success',
        message: t('ui_text.saved_label', 'Teks untuk key "{key}" ({lang}) berhasil diperbarui.', { key, lang: languageName(lang) }),
      });
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
    const htmlLang = LANGUAGE_OPTIONS.find((o) => o.code === lang)?.htmlLang;
    const label = t('ui_text.edit_in', 'Edit dalam {lang}', { lang: languageName(lang) });
    return (
      <Editable key={`${key}-${lang}-${valueOf(key, lang)}`} defaultValue={valueOf(key, lang)} disabled={translationsBusy}
        placeholder={t('ui_text.missing', '(belum diterjemahkan)')}
        translations={{ input: label, edit: label, submit: t('common.save', 'Simpan'), cancel: t('common.cancel', 'Batal') }}
        onValueCommit={(details) => { if (details.value !== valueOf(key, lang)) void handleSaveEdit(key, lang, details.value); }}
        className="group/text-cell grid w-full items-center gap-g5">
        <EditableContext>
          {({ editing, cancel }) => (
            <>
              <EditableArea className={editing
                ? 'min-w-0 border-status-success bg-background px-g8 py-g3 data-focus:outline-status-success'
                : 'min-w-0 border-transparent bg-transparent px-0 py-g3'}>
                {editing && <EditableInput lang={htmlLang} autoFocus onKeyDownCapture={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                  }
                }} />}
                <EditablePreview lang={htmlLang} className="whitespace-normal wrap-anywhere font-normal" />
              </EditableArea>
              <EditableControl>
                {editing ? (
                  <EditableSubmitTrigger className="size-g26 rounded-full border-0 bg-status-success text-primary-foreground hover:bg-status-success/90" />
                ) : (
                  <EditableEditTrigger aria-label={label} title={label} className="size-g26 border-0 bg-transparent text-status-success opacity-0 group-hover/text-cell:opacity-100 group-focus-within/text-cell:opacity-100 focus-visible:opacity-100 hover:bg-status-success-soft [@media(hover:none)]:opacity-100" />
                )}
              </EditableControl>
            </>
          )}
        </EditableContext>
      </Editable>
    );
  };

  return (
    <ModalFrame size="xl" onClose={onClose} onEscapeKeyDown={event => {
      if (document.activeElement?.getAttribute('data-slot') === 'editable-input') event.preventDefault();
    }} className="flex flex-col overflow-hidden">

        <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
          <div className="flex flex-wrap items-center gap-g8">
            <DialogTitle className="flex items-center gap-g8">
              <FileSpreadsheet className="w-g21 h-g21 text-accent-foreground" aria-hidden />
              <span>{t('ui_text.title', 'Struktur Teks UI & Ekspor / Impor CSV')}</span>
            </DialogTitle>
            {totalCustomCount > 0 && (
              <Badge tone="success"><Sparkles aria-hidden="true" />{t('ui_text.custom_active', '{n} teks kustom aktif', { n: totalCustomCount })}</Badge>
            )}
          </div>
          <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
        </DialogHeader>

        <div className="p-g13 bg-card border-b border-border flex flex-wrap items-center justify-between gap-g13 shrink-0">
          <div className="flex flex-wrap items-center gap-g8">
            <Button variant="outline"
              type="button"
              onClick={exportToCSV}
              disabled={translationsBusy}
            >
              <Download className="w-g16 h-g16 text-accent-foreground" aria-hidden />
              <span>{t('ui_text.export', 'Ekspor CSV')}</span>
            </Button>
            <FileUpload key={importKey} accept=".csv,text/csv" maxFiles={1} disabled={translationsBusy} onFileAccept={(details) => handleFileUpload(details.files[0])} className="w-auto">
              <FileUploadTrigger asChild>
                <Button variant="ghost" type="button">
                  <Upload aria-hidden />
                  {t('ui_text.import', 'Unggah CSV')}
                </Button>
              </FileUploadTrigger>
              <FileUploadHiddenInput aria-label={t('ui_text.import', 'Unggah CSV')} />
            </FileUpload>
            {totalCustomCount > 0 && (
              <Button variant="destructive"
                type="button"
                onClick={handleReset}
                disabled={translationsBusy}
              >
                <RotateCcw className="size-g16" aria-hidden="true" />
                <span>{t('ui_text.reset_to_default', 'Kembalikan ke Bawaan')}</span>
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-medium flex items-center gap-g3">
            <Languages className="w-g16 h-g16 text-status-success" aria-hidden />
            <span>{t('ui_text.total_keys', 'Total key teks: {n}', { n: allKeys.length })}</span>
          </div>
        </div>

        {translationsBusy && <Text size="sm" className="px-g13 py-g8" role="status">{t('tb.texts_syncing')}</Text>}
        {translationsError && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{translationsError}</AlertDescription></AlertContent></Alert>}
        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`px-g21 py-g13 border-b text-xs font-semibold flex items-center justify-between ${
 notice.type === 'success'
 ? 'bg-status-success-soft border-status-success-border text-status-success '
 : 'bg-status-danger-soft border-status-danger-border text-status-danger '
 }`}
          >
            <div className="flex items-center gap-g8">
              {notice.type === 'success' ? (
                <Check className="w-g16 h-g16 text-status-success shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="w-g16 h-g16 text-status-danger shrink-0" aria-hidden />
              )}
              <span>{notice.message}</span>
            </div>
            <Button variant="ghost" size="icon-sm"
              type="button"
              onClick={() => setNotice(null)}
              aria-label={t('common.close', 'Tutup')}
            >
              <X className="w-g13 h-g13" aria-hidden />
            </Button>
          </div>
        )}

        <div className="p-g13 border-b border-border bg-card grid grid-cols-1 sm:grid-cols-3 gap-g13 shrink-0">
          <InputGroup className="sm:col-span-2 relative">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label={t('settings.search_ui_text', 'Cari kata kunci, ID key, atau teks UI...')}
              placeholder={t('settings.search_ui_text', 'Cari kata kunci, ID key, atau teks UI...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </InputGroup>
          <AlphabeticalSelect
            aria-label={t('ui_text.module_filter', 'Filter modul')}
            value={selectedModule}
            onChange={(e) => {
              setSelectedModule(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "w-full" }}
          >
            <option value="ALL">{t('ui_text.all_modules', 'Semua modul ({n})', { n: allKeys.length })}</option>
            {modules.map((mod) => (
              <option key={mod} value={mod}>
                {moduleLabel(mod)} ({allKeys.filter((k) => moduleOf(k) === mod).length})
              </option>
            ))}
          </AlphabeticalSelect>
        </div>

        <div className="flex-1 overflow-y-auto p-g13 sm:p-g21 bg-card ">
          <Card className="overflow-x-auto">
            <Table className="w-full min-w-[960px] table-fixed text-left">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader scope="col" className="w-[19%]">{t('ui_text.col_key', 'Key teks')}</TableColumnHeader>
                  <TableColumnHeader scope="col" className="w-[13%]">{t('ui_text.col_module', 'Modul')}</TableColumnHeader>
                  {CODES.map((code) => (
                    <TableColumnHeader key={code} scope="col" className="w-1/5">
                      {languageName(code)} ({LANGUAGE_OPTIONS.find((o) => o.code === code)?.label})
                    </TableColumnHeader>
                  ))}
                  <TableColumnHeader scope="col" className="w-[8%] text-center">{t('ui_text.col_status', 'Status')}</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKeys.length === 0 ? (
                  <TableEmptyState colSpan={CODES.length + 3} />
                ) : (
                  currentKeys.map((key) => {
                    const isCustom = CODES.some((code) => customTranslations[code]?.[key]);
                    return (
                      <TableRow key={key} className="hover:bg-muted/35 focus-within:bg-muted/35">
                        <TableCell className="py-g13 whitespace-normal wrap-anywhere">{key}</TableCell>
                        <TableCell className="py-g13">
                          <Badge tone={statusTone('Neutral')} className={BADGE}>{moduleLabel(moduleOf(key))}</Badge>
                        </TableCell>
                        {CODES.map((code) => (
                          <TableCell key={code} className="py-g13">
                            {renderCell(key, code)}
                          </TableCell>
                        ))}
                        <TableCell className="py-g13 text-center whitespace-nowrap">
                          <Badge tone={statusTone(isCustom ? 'Aktif' : 'Neutral')} className={BADGE}>
                            {isCustom ? t('ui_text.status_custom', 'Kustom') : t('ui_text.status_default', 'Bawaan')}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
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
          </Card>
        </div>

        <div className="p-g13 sm:p-g21 bg-card border-t border-border flex items-center justify-between gap-g13 shrink-0">
          <Text size="xs" tone="muted">
            {t(
              'ui_text.hint',
              'Petunjuk: ekspor CSV untuk mengunduh semua teks (Indonesia, Inggris, Mandarin), edit di Excel / Google Sheets, lalu unggah kembali file CSV tersebut di sini.',
            )}
          </Text>
          <Button variant="ghost" size="sm"
            type="button"
            onClick={onClose}
            className="shrink-0"
          >
            {t('ui_text.done', 'Selesai & Tutup')}
          </Button>
        </div>

    </ModalFrame>
  );
};
