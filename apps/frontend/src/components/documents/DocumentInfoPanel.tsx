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
import { statusLabel, typeLabel } from './documentLabels';

import { Input } from '@legalio/ui-components/input';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Checkbox, CheckboxControl, CheckboxGroup, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { List, ListItem } from '@legalio/ui-components/list';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { Separator } from '@legalio/ui-components/separator';
import { Card } from '@legalio/ui-components/card';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { voidHandler } from '@legalio/shared/voidHandler';
interface DocumentInfoPanelProps {
  document: DocumentDetail | null;
  organizationName: string;
  canEdit: boolean;
  canManageFields: boolean;
  onUpdate: (patch: { status?: DocumentStatus; type?: DocumentType }) => void;
}

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string };

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
        <Fieldset key={field.id} disabled={!canEdit}>
          <FieldsetLegend>{field.name}</FieldsetLegend>
          <CheckboxGroup value={picked} onValueChange={next => set(next)}>
            {field.options.map(option => (
              <Checkbox key={option} value={option}><CheckboxControl /><CheckboxLabel>{option}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
            ))}
          </CheckboxGroup>
        </Fieldset>
      );
    }
    const text = typeof value === 'string' ? value : '';
    return (
      <Field key={field.id} disabled={!canEdit}>
        <FieldLabel htmlFor={inputId}>{field.name}</FieldLabel>
        {field.field_type === 'select' ? (
          <AlphabeticalSelect id={inputId} value={text} onChange={(e) => set(e.target.value)} className="w-full" controlProps={{ className: 'w-full' }}>
            <option value="">—</option>
            {field.options.map(option => <option key={option} value={option}>{option}</option>)}
          </AlphabeticalSelect>
        ) : (
          <Input id={inputId} type={field.field_type === 'date' ? 'date' : 'text'} value={text} onChange={(e) => set(e.target.value)} />
        )}
      </Field>
    );
  };

  const typeSelectId = `${idPrefix}-type`;
  const statusSelectId = `${idPrefix}-status`;

  const sectionTitle = (id: string, icon: React.ReactNode, label: string) => (
    <Heading as="h3" size="sm" weight="semibold" id={id} className="flex items-center gap-g8">{icon}{label}</Heading>
  );
  // Type/Status labels read as the same uppercase terms as the read-only facts above them.
  const termClass = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const term = (label: React.ReactNode) => <dt><Text as="span" size="xs" weight="semibold" tone="muted" className="uppercase tracking-wide">{label}</Text></dt>;

  return (
    <div className="flex flex-col gap-g21">
      <section className="flex flex-col gap-g13" aria-labelledby={`${idPrefix}-info`}>
        {sectionTitle(`${idPrefix}-info`, <Info className="size-g16 text-muted-foreground" aria-hidden="true" />, t('documents.info.title', 'Informasi Dokumen'))}
        {!document ? (
          <Alert status="info"><AlertIndicator /><AlertContent><AlertDescription>{t('documents.info.unsaved', 'Dokumen belum disimpan. Pembuat dan waktu dicatat otomatis saat penyimpanan pertama.')}</AlertDescription></AlertContent></Alert>
        ) : (
          <dl className="grid grid-cols-2 gap-x-g13 gap-y-g16 text-sm">
            <div className="col-span-2 grid gap-g3">{term(t('documents.field.name', 'Nama'))}<dd className="break-words">{document.name}</dd></div>
            <div className="grid gap-g3">{term(t('documents.field.created', 'Dibuat'))}<dd>{t('documents.info.by', 'oleh {name}', { name: document.created_by_name || '—' })}<Text as="span" size="xs" tone="muted" className="block">{formatDateTime(document.created_at, language)}</Text></dd></div>
            <div className="grid gap-g3">{term(t('documents.field.modified', 'Diubah'))}<dd>{t('documents.info.by', 'oleh {name}', { name: document.modified_by_name || '—' })}<Text as="span" size="xs" tone="muted" className="block">{formatDateTime(document.modified_at, language)}</Text></dd></div>
            <div className="grid gap-g3">{term(t('documents.info.organization', 'Organisasi'))}<dd className="break-words">{organizationName}</dd></div>
            <div className="grid gap-g3">{term(t('documents.info.versions', 'Versi'))}<dd>v{document.current_version} · {t('documents.info.version_count', '{n} tersimpan', { n: document.draft_count })}</dd></div>
            <Field disabled={!canEdit} className="gap-g3">
              <FieldLabel htmlFor={typeSelectId} className={termClass}>{t('documents.field.type', 'Jenis')}</FieldLabel>
              <AlphabeticalSelect id={typeSelectId} value={document.type} onChange={(e) => isOneOf(DOCUMENT_TYPES, e.target.value) && onUpdate({ type: e.target.value })} className="w-full" controlProps={{ className: 'w-full' }}>
                {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{typeLabel(t, type)}</option>)}
              </AlphabeticalSelect>
            </Field>
            <Field disabled={!canEdit} className="gap-g3">
              <FieldLabel htmlFor={statusSelectId} className={termClass}>{t('documents.field.status', 'Status')}</FieldLabel>
              <AlphabeticalSelect id={statusSelectId} value={document.status} onChange={(e) => isOneOf(DOCUMENT_STATUSES, e.target.value) && onUpdate({ status: e.target.value })} className="w-full" controlProps={{ className: 'w-full' }}>
                {DOCUMENT_STATUSES.map(status => (
                  <option key={status} value={status} disabled={status !== document.status && (status === 'pending_review' || status === 'approved' || (document.status === 'approved' && status === 'draft'))}>
                    {statusLabel(t, status)}
                  </option>
                ))}
              </AlphabeticalSelect>
              <Text size="xs" tone="muted">{t('documents.info.status_by_approval', 'Review and approval statuses are set through My Approval.')}</Text>
            </Field>
          </dl>
        )}
      </section>

      <Separator />
      <section className="flex flex-col gap-g13" aria-labelledby={`${idPrefix}-meta`}>
        {sectionTitle(`${idPrefix}-meta`, <Tags className="size-g16 text-muted-foreground" aria-hidden="true" />, t('documents.metadata.title', 'Metadata'))}
        {fields.length === 0 ? (
          <Text size="sm" tone="muted">
            {canManageFields
              ? t('documents.metadata.empty_admin', 'Belum ada kolom metadata. Tambahkan di bawah (mis. Kode Matter, Nama Klien).')
              : t('documents.metadata.empty', 'Admin organisasi belum menambahkan kolom metadata.')}
          </Text>
        ) : !document ? (
          <Text size="sm" tone="muted">{t('documents.metadata.unsaved', 'Simpan dokumen terlebih dahulu untuk mengisi metadata.')}</Text>
        ) : (
          <form onSubmit={voidHandler(saveMetadata)} className="flex flex-col gap-g13" aria-busy={saveState.status === 'saving'}>
            {fields.map(renderInput)}
            {saveState.status === 'error' && (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{saveState.message}</AlertDescription></AlertContent></Alert>
            )}
            {canEdit && (
              <Button type="submit" loading={saveState.status === 'saving'} className="w-full">
                <Save aria-hidden="true" />
                {saveState.status === 'saving' ? t('common.saving', 'Menyimpan…') : t('documents.metadata.save', 'Simpan Metadata')}
              </Button>
            )}
          </form>
        )}
      </section>

      {canManageFields && (
        <>
          <Separator />
          <section className="flex flex-col gap-g13" aria-labelledby={`${idPrefix}-fields`}>
            {sectionTitle(`${idPrefix}-fields`, <PlusCircle className="size-g16 text-muted-foreground" aria-hidden="true" />, t('documents.metadata.manage_title', 'Kelola Kolom Metadata (Organisasi)'))}
            {fields.length > 0 && (
              <List className="gap-g3">
                {fields.map(field => (
                  <ListItem key={field.id} className="flex items-center justify-between gap-g8 rounded-md border border-border p-g5 ps-g13 text-sm">
                    <span className="min-w-0"><span className="font-semibold">{field.name}</span><Text as="span" size="xs" tone="muted"> · {fieldTypeLabel(field.field_type)}</Text></span>
                    <Button variant="ghost" size="icon-sm" onClick={() => void removeField(field)} className="text-destructive" aria-label={`${t('documents.action.delete', 'Hapus')}: ${field.name}`}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </ListItem>
                ))}
              </List>
            )}
            <Card size="sm" className="p-g13">
              <form onSubmit={voidHandler(addField)} className="flex flex-col gap-g13">
                <Field required>
                  <FieldLabel className="font-semibold">{t('documents.metadata.field_name', 'Nama kolom')}</FieldLabel>
                  <Input value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value })} placeholder={t('documents.metadata.field_name_placeholder', 'mis. Kode Matter')} />
                </Field>
                <Field>
                  <FieldLabel className="font-semibold">{t('documents.metadata.field_type', 'Tipe')}</FieldLabel>
                  <AlphabeticalSelect value={newField.type} onChange={(e) => isOneOf(METADATA_FIELD_TYPES, e.target.value) && setNewField({ ...newField, type: e.target.value })} className="w-full" controlProps={{ className: 'w-full' }}>
                    {METADATA_FIELD_TYPES.map(type => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}
                  </AlphabeticalSelect>
                </Field>
                {(newField.type === 'select' || newField.type === 'multi_select') && (
                  <Field required>
                    <FieldLabel className="font-semibold">{t('documents.metadata.options', 'Opsi (pisahkan dengan koma)')}</FieldLabel>
                    <Input value={newField.options} onChange={(e) => setNewField({ ...newField, options: e.target.value })} placeholder={t('documents.ip_employment_real_estate_corporate', 'IP, Employment, Real Estate, Corporate')} />
                  </Field>
                )}
                <Button type="submit" variant="outline" className="w-full"><PlusCircle aria-hidden="true" />{t('documents.metadata.add_field', 'Tambah Kolom')}</Button>
              </form>
            </Card>
          </section>
        </>
      )}
    </div>
  );
};
