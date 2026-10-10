import { AlphabeticalSelect } from '../ui/alphabetical-select';
import React, { useEffect, useId, useState } from 'react';
import { Info, PlusCircle, Save, Tags, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { documentsApi, errorMessage } from '../../lib/documentsApi';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  METADATA_FIELD_TYPES,
  formatDateTime,
  isOneOf,
  type DocumentDetail,
  type DocumentStatus,
  type DocumentType,
  type MetadataField,
  type MetadataFieldType,
  type MetadataValues,
} from '@legalio/types/documents';
import { INPUT_CLASS, statusLabel, typeLabel } from './documentLabels';

import { Input } from '@legalio/ui-components/input';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
interface DocumentInfoPanelProps {
  document: DocumentDetail | null;
  organizationName: string;
  canEdit: boolean;
  canManageFields: boolean;
  onUpdate: (patch: { status?: DocumentStatus; type?: DocumentType }) => void;
}

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string };

const SECTION_TITLE = 'text-xs font-bold text-foreground  flex items-center gap-1.5';
const LABEL = 'block text-xs font-bold uppercase tracking-wide text-muted-foreground ';
const BUTTON =
  'theme-action w-full inline-flex items-center justify-center gap-1.5 min-h-10 sm:min-h-8 rounded-md text-xs font-bold text-white disabled:opacity-50 cursor-pointer';

export const DocumentInfoPanel: React.FC<DocumentInfoPanelProps> = ({ document, organizationName, canEdit, canManageFields, onUpdate }) => {
  const { t, language } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const idPrefix = useId();
  const [fields, setFields] = useState<MetadataField[]>([]);
  const [values, setValues] = useState<MetadataValues>({});
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [newField, setNewField] = useState<{ name: string; type: MetadataFieldType; options: string }>({ name: '', type: 'text', options: '' });

  const documentId = document?.id ?? null;

  useEffect(() => {
    documentsApi.listFields().then(setFields).catch(() => setFields([]));
  }, []);

  useEffect(() => {
    setValues({});
    if (!documentId) return;
    let cancelled = false;
    documentsApi
      .getMetadata(documentId)
      .then((v) => !cancelled && setValues(v))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const saveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentId) return;
    setSaveState({ status: 'saving' });
    try {
      const payload: MetadataValues = {};
      for (const field of fields) payload[field.id] = values[field.id] ?? (field.field_type === 'multi_select' ? [] : '');
      await documentsApi.saveMetadata(documentId, payload);
      setSaveState({ status: 'idle' });
      showAlert({ title: t('documents.metadata.saved', 'Metadata tersimpan'), variant: 'success' });
    } catch (err) {
      setSaveState({ status: 'error', message: errorMessage(err) });
    }
  };

  const addField = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await documentsApi.createField({
        name: newField.name,
        field_type: newField.type,
        options: newField.options.split(',').map((o) => o.trim()).filter(Boolean),
      });
      setFields((prev) => [...prev, created]);
      setNewField({ name: '', type: 'text', options: '' });
    } catch (err) {
      showAlert({ title: t('documents.msg.action_failed', 'Aksi gagal'), description: errorMessage(err), variant: 'destructive' });
    }
  };

  const removeField = async (field: MetadataField) => {
    const ok = await confirmDialog({
      description: t('documents.metadata.delete_field_confirm', 'Hapus kolom "{name}"? Nilainya di semua dokumen ikut terhapus.', { name: field.name }),
      tone: 'danger',
      confirmLabel: t('documents.action.delete', 'Hapus'),
    });
    if (!ok) return;
    try {
      await documentsApi.deleteField(field.id);
      setFields((prev) => prev.filter((f) => f.id !== field.id));
    } catch (err) {
      showAlert({ title: t('documents.msg.action_failed', 'Aksi gagal'), description: errorMessage(err), variant: 'destructive' });
    }
  };

  const fieldTypeLabel = (type: MetadataFieldType) =>
    ({
      text: t('documents.metadata.type_text', 'Teks'),
      select: t('documents.metadata.type_select', 'Pilihan'),
      date: t('documents.metadata.type_date', 'Tanggal'),
      multi_select: t('documents.metadata.type_multi_select', 'Pilihan ganda'),
    })[type];

  const renderInput = (field: MetadataField) => {
    const inputId = `${idPrefix}-field-${field.id}`;
    const value = values[field.id];
    const set = (next: string | string[]) => setValues((prev) => ({ ...prev, [field.id]: next }));
    if (field.field_type === 'multi_select') {
      const picked = Array.isArray(value) ? value : [];
      return (
        <fieldset key={field.id} className="space-y-1">
          <legend className={LABEL}>{field.name}</legend>
          {field.options.map((option) => (
            <Checkbox disabled={!canEdit} checked={picked.includes(option)} onCheckedChange={(details) => set(details.checked === true ? [...picked, option] : picked.filter((p) => p !== option))}><CheckboxControl /><CheckboxLabel>{option}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
          ))}
        </fieldset>
      );
    }
    const text = typeof value === 'string' ? value : '';
    return (
      <div key={field.id} className="space-y-1">
        <label htmlFor={inputId} className={LABEL}>
          {field.name}
        </label>
        {field.field_type === 'select' ? (
          <AlphabeticalSelect id={inputId} disabled={!canEdit} value={text} onChange={(e) => set(e.target.value)} className={INPUT_CLASS}>
            <option value="">—</option>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </AlphabeticalSelect>
        ) : (
          <Input
            id={inputId}
            type={field.field_type === 'date' ? 'date' : 'text'}
            disabled={!canEdit}
            value={text}
            onChange={(e) => set(e.target.value)}
            className={INPUT_CLASS}
          />
        )}
      </div>
    );
  };

  const typeSelectId = `${idPrefix}-type`;
  const statusSelectId = `${idPrefix}-status`;

  return (
    <div className="space-y-5">
      <section className="space-y-2.5" aria-labelledby={`${idPrefix}-info`}>
        <h3 id={`${idPrefix}-info`} className={SECTION_TITLE}>
          <Info className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
          {t('documents.info.title', 'Informasi Dokumen')}
        </h3>
        {!document ? (
          <p className="text-xs text-muted-foreground p-3 border border-dashed border-border rounded-lg">
            {t('documents.info.unsaved', 'Dokumen belum disimpan. Pembuat dan waktu dicatat otomatis saat penyimpanan pertama.')}
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-xs text-foreground">
            <div className="col-span-2 space-y-1">
              <dt className={LABEL}>{t('documents.field.name', 'Nama')}</dt>
              <dd className="font-semibold break-words">{document.name}</dd>
            </div>
            <div className="space-y-1">
              <dt>
                <label htmlFor={typeSelectId} className={LABEL}>
                  {t('documents.field.type', 'Jenis')}
                </label>
              </dt>
              <dd>
                <AlphabeticalSelect
                  id={typeSelectId}
                  disabled={!canEdit}
                  value={document.type}
                  onChange={(e) => isOneOf(DOCUMENT_TYPES, e.target.value) && onUpdate({ type: e.target.value })}
                  className={INPUT_CLASS}
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(t, type)}
                    </option>
                  ))}
                </AlphabeticalSelect>
              </dd>
            </div>
            <div className="space-y-1">
              <dt>
                <label htmlFor={statusSelectId} className={LABEL}>
                  {t('documents.field.status', 'Status')}
                </label>
              </dt>
              <dd>
                <AlphabeticalSelect
                  id={statusSelectId}
                  disabled={!canEdit}
                  value={document.status}
                  onChange={(e) => isOneOf(DOCUMENT_STATUSES, e.target.value) && onUpdate({ status: e.target.value })}
                  className={INPUT_CLASS}
                >
                  {DOCUMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(t, status)}
                    </option>
                  ))}
                </AlphabeticalSelect>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className={LABEL}>{t('documents.field.created', 'Dibuat')}</dt>
              <dd>
                {t('documents.info.by', 'oleh {name}', { name: document.created_by_name || '—' })}
                <br />
                <span className="text-muted-foreground">{formatDateTime(document.created_at, language)}</span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className={LABEL}>{t('documents.field.modified', 'Diubah')}</dt>
              <dd>
                {t('documents.info.by', 'oleh {name}', { name: document.modified_by_name || '—' })}
                <br />
                <span className="text-muted-foreground">{formatDateTime(document.modified_at, language)}</span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className={LABEL}>{t('documents.info.organization', 'Organisasi')}</dt>
              <dd className="break-words">{organizationName}</dd>
            </div>
            <div className="space-y-1">
              <dt className={LABEL}>{t('documents.info.versions', 'Versi')}</dt>
              <dd>
                v{document.current_version} · {t('documents.info.version_count', '{n} tersimpan', { n: document.draft_count })}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="space-y-2.5 pt-3 border-t border-border" aria-labelledby={`${idPrefix}-meta`}>
        <h3 id={`${idPrefix}-meta`} className={SECTION_TITLE}>
          <Tags className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
          {t('documents.metadata.title', 'Metadata')}
        </h3>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {canManageFields
              ? t('documents.metadata.empty_admin', 'Belum ada kolom metadata. Tambahkan di bawah (mis. Kode Matter, Nama Klien).')
              : t('documents.metadata.empty', 'Admin organisasi belum menambahkan kolom metadata.')}
          </p>
        ) : !document ? (
          <p className="text-xs text-muted-foreground">
            {t('documents.metadata.unsaved', 'Simpan dokumen terlebih dahulu untuk mengisi metadata.')}
          </p>
        ) : (
          <form onSubmit={saveMetadata} className="space-y-2.5" aria-busy={saveState.status === 'saving'}>
            {fields.map(renderInput)}
            {saveState.status === 'error' && (
              <Alert status="error" role="alert">
                <AlertContent>{saveState.message}</AlertContent>
              </Alert>
            )}
            {canEdit && (
              <Button variant="ghost" type="submit" disabled={saveState.status === 'saving'} className={BUTTON}>
                <Save className="w-3.5 h-3.5" aria-hidden />
                {saveState.status === 'saving' ? t('common.saving', 'Menyimpan…') : t('documents.metadata.save', 'Simpan Metadata')}
              </Button>
            )}
          </form>
        )}
      </section>

      {canManageFields && (
        <section className="space-y-2.5 pt-3 border-t border-border" aria-labelledby={`${idPrefix}-fields`}>
          <h3 id={`${idPrefix}-fields`} className={SECTION_TITLE}>
            <PlusCircle className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            {t('documents.metadata.manage_title', 'Kelola Kolom Metadata (Organisasi)')}
          </h3>
          {fields.length > 0 && (
            <ul className="space-y-1">
              {fields.map((field) => (
                <li key={field.id} className="flex items-center justify-between gap-2 text-xs p-1.5 rounded-lg border border-border">
                  <span className="min-w-0">
                    <span className="font-semibold text-foreground">{field.name}</span>
                    <span className="text-xs text-muted-foreground"> · {fieldTypeLabel(field.field_type)}</span>
                  </span>
                  <Button variant="ghost" size="icon-sm"
                    type="button"
                    onClick={() => removeField(field)}
                    className="text-destructive"
                    aria-label={`${t('documents.action.delete', 'Hapus')}: ${field.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addField} className="space-y-2 editor-panel-card p-4 rounded-xl border border-dashed border-status-success-border">
            <label className="block space-y-1">
              <span className={LABEL}>{t('documents.metadata.field_name', 'Nama kolom')}</span>
              <Input
                required
                value={newField.name}
                onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                placeholder={t('documents.metadata.field_name_placeholder', 'mis. Kode Matter')}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block space-y-1">
              <span className={LABEL}>{t('documents.metadata.field_type', 'Tipe')}</span>
              <AlphabeticalSelect
                value={newField.type}
                onChange={(e) => isOneOf(METADATA_FIELD_TYPES, e.target.value) && setNewField({ ...newField, type: e.target.value })}
                className={INPUT_CLASS}
              >
                {METADATA_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {fieldTypeLabel(type)}
                  </option>
                ))}
              </AlphabeticalSelect>
            </label>
            {(newField.type === 'select' || newField.type === 'multi_select') && (
              <label className="block space-y-1">
                <span className={LABEL}>{t('documents.metadata.options', 'Opsi (pisahkan dengan koma)')}</span>
                <Input
                  required
                  value={newField.options}
                  onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                  placeholder={t('documents.ip_employment_real_estate_corporate', 'IP, Employment, Real Estate, Corporate')}
                  className={INPUT_CLASS}
                />
              </label>
            )}
            <Button variant="ghost" type="submit" className={BUTTON}>
              <PlusCircle className="w-3.5 h-3.5" aria-hidden />
              {t('documents.metadata.add_field', 'Tambah Kolom')}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
};
