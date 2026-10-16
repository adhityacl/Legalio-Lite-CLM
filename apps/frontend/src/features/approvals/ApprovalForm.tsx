import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, FileText, FolderSearch, Info, Plus, Send, Upload, X } from 'lucide-react';
import { APPROVAL_CATEGORIES, APPROVAL_MAX_FILE_BYTES, type ApprovalCategory } from '@legalio/types/approvals';
import { formatBytes } from '@legalio/types/documents';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { AlphabeticalSelect } from '../../components/ui/alphabetical-select';
import { useDocumentList } from '../documents/useDocumentList';
import { approvalsApi, type NewApproval } from './approvalsApi';
import { PersonAvatar, categoryLabel } from './approvalUi';

export type ApprovalDraft = Pick<NewApproval, 'title' | 'category' | 'note' | 'approverIds' | 'documentId'>;

interface Props {
  initial?: ApprovalDraft;
  onSubmitted: (id: string) => void;
  onCancel: () => void;
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const ApprovalForm: React.FC<Props> = ({ initial, onSubmitted, onCancel }) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const showAlert = useAlertToast();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState<ApprovalCategory>(initial?.category ?? 'contract');
  const [note, setNote] = useState(initial?.note ?? '');
  const [source, setSource] = useState<'document' | 'upload'>(initial && !initial.documentId ? 'upload' : 'document');
  const [documentId, setDocumentId] = useState(initial?.documentId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [approverIds, setApproverIds] = useState<string[]>(initial?.approverIds ?? []);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // shortcut: the picker lists the 50 most recently modified documents; add search when organizations outgrow it.
  const documents = useDocumentList({ limit: '50', sort_by: 'modified_at', sort_dir: 'desc' }).data?.documents ?? [];
  const candidates = useQuery({ queryKey: ['approval-approvers'], queryFn: approvalsApi.approvers }).data?.approvers ?? [];
  const byId = new Map(candidates.map(c => [c.id, c]));
  const available = candidates.filter(c => c.id !== user?.id && !approverIds.includes(c.id));

  const move = (index: number, delta: number) => setApproverIds(ids => {
    const next = [...ids];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    return next;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (source === 'document' && !documentId) return setError(t('approval.form.need_document', 'Choose a document to attach.'));
    if (source === 'upload' && !file) return setError(t('approval.form.need_file', 'Upload a file to attach.'));
    if (approverIds.length === 0) return setError(t('approval.form.need_approver', 'Add at least one approver.'));
    setSubmitting(true);
    try {
      const attachment = source === 'document'
        ? { documentId }
        : { file: { name: file!.name, base64: await readBase64(file!) } };
      const { id } = await approvalsApi.create({ title, category, note, approverIds, ...attachment });
      showAlert({ title: t('approval.form.submitted', 'Approval submitted'), variant: 'success' });
      onSubmitted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const sourceCard = (value: 'document' | 'upload', Icon: typeof FileText, label: string, hint: string) => (
    <button type="button" onClick={() => setSource(value)} aria-pressed={source === value}
      className={`flex items-center gap-g13 rounded-lg border p-g13 text-left transition-colors ${source === value ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:bg-muted'}`}>
      <span className="flex size-g34 shrink-0 items-center justify-center rounded-md border border-border bg-background"><Icon className="size-g16" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <Text size="sm" weight="semibold">{label}</Text>
        <Text size="xs" tone="muted">{hint}</Text>
      </span>
      {source === value && <CheckCircle2 className="size-g16 shrink-0 text-primary" aria-hidden />}
    </button>
  );

  return (
    <form onSubmit={submit} className="w-full min-w-0 space-y-g21" aria-labelledby="approval-form-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <Heading as="h2" size="md" weight="semibold" id="approval-form-heading">{t('approval.form.title', 'Submit a new approval')}</Heading>
        <Button variant="link" size="sm" type="button" onClick={onCancel} className="no-underline hover:underline"><ArrowLeft className="size-g13" aria-hidden />{t('approval.back', 'Back to approvals')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-g21 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-g21">
          <Card className="space-y-g13 p-g21">
            <Heading as="h3" size="sm" weight="semibold">{t('approval.form.details', 'Document details')}</Heading>
            <div className="grid grid-cols-1 gap-g13 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field>
                <FieldLabel htmlFor="approval-title">{t('approval.form.field_title', 'Approval title')}</FieldLabel>
                <Input id="approval-title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="approval-category">{t('documents.field.type', 'Type')}</FieldLabel>
                <AlphabeticalSelect id="approval-category" value={category} onChange={e => setCategory(e.target.value as ApprovalCategory)} className="w-full"
                  disabled={source === 'document' && Boolean(documentId)}>
                  {APPROVAL_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
                </AlphabeticalSelect>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="approval-note">{t('approval.form.field_note', 'Note for approvers')}</FieldLabel>
              <Textarea id="approval-note" rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
            </Field>
          </Card>

          <Card className="space-y-g13 p-g21">
            <div>
              <Heading as="h3" size="sm" weight="semibold">{t('approval.form.attachment', 'Attachment')}</Heading>
              <Text size="xs" tone="muted">{t('approval.form.attachment_hint', 'Choose an existing document or upload a new file.')}</Text>
            </div>
            <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
              {sourceCard('document', FolderSearch, t('approval.form.from_document', 'Choose from documents'), t('approval.form.from_document_hint', 'Use a file from My Documents'))}
              {sourceCard('upload', Upload, t('approval.form.upload', 'Upload new file'), t('approval.form.upload_hint', 'PDF, DOCX, XLSX up to 10 MB'))}
            </div>
            {source === 'document' ? (
              <Field>
                <FieldLabel htmlFor="approval-document">{t('approval.form.saved_document', 'Saved document')}</FieldLabel>
                <AlphabeticalSelect id="approval-document" value={documentId} className="w-full" onChange={e => {
                  setDocumentId(e.target.value);
                  const doc = documents.find(d => d.id === e.target.value);
                  if (doc) setCategory(doc.type);
                }}>
                  <option value="">{t('approval.form.pick_document', 'Choose a document…')}</option>
                  {documents.filter(d => d.status !== 'archived').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </AlphabeticalSelect>
              </Field>
            ) : (
              <FileUpload className="w-full" accept=".pdf,.docx,.xlsx" maxFiles={1} maxFileSize={APPROVAL_MAX_FILE_BYTES}
                onFileAccept={details => { setFile(details.files[0] ?? null); setError(''); }}
                onFileReject={() => setError(t('approval.form.file_rejected', 'Only PDF, DOCX or XLSX files up to 10 MB are allowed.'))}>
                <FileUploadDropzone>
                  <FileUploadDropzoneIcon />
                  <Text size="sm" weight="semibold" className="break-all">
                    {file ? `${file.name} • ${formatBytes(file.size)}` : t('approval.form.drop_file', 'Drop a file here')}
                  </Text>
                  <FileUploadTrigger asChild><Button size="sm" type="button">{t('approval.form.choose_file', 'Choose file')}</Button></FileUploadTrigger>
                </FileUploadDropzone>
                <FileUploadHiddenInput />
              </FileUpload>
            )}
          </Card>
        </div>

        <Card className="flex flex-col gap-g13 p-g21">
          <Heading as="h3" size="sm" weight="semibold">{t('approval.form.flow', 'Approval flow')}</Heading>
          <ol className="space-y-g8">
            {approverIds.map((id, i) => (
              <li key={id} className="flex items-center gap-g8 rounded-lg bg-muted/40 p-g8">
                <span className="flex size-g21 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                <PersonAvatar name={byId.get(id)?.name ?? null} size="md" />
                <span className="min-w-0 flex-1">
                  <Text size="sm" weight="semibold" className="truncate">{byId.get(id)?.name ?? id}</Text>
                  <Text size="xs" tone="muted" className="capitalize">{byId.get(id)?.role}</Text>
                </span>
                <Button variant="ghost" size="icon-sm" type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('approval.form.move_up', 'Move up')}><ArrowUp className="size-g13" aria-hidden /></Button>
                <Button variant="ghost" size="icon-sm" type="button" disabled={i === approverIds.length - 1} onClick={() => move(i, 1)} aria-label={t('approval.form.move_down', 'Move down')}><ArrowDown className="size-g13" aria-hidden /></Button>
                <Button variant="ghost" size="icon-sm" type="button" onClick={() => setApproverIds(ids => ids.filter(x => x !== id))} aria-label={t('approval.form.remove', 'Remove')}><X className="size-g13" aria-hidden /></Button>
              </li>
            ))}
          </ol>
          <div className="flex items-end gap-g8">
            <AlphabeticalSelect aria-label={t('approval.form.add_approver', 'Add approver')} value={adding} onChange={e => setAdding(e.target.value)} className="w-full" controlProps={{ className: 'min-w-0 flex-1' }}>
              <option value="">{t('approval.form.pick_approver', 'Choose an approver…')}</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </AlphabeticalSelect>
            <Button variant="outline" type="button" disabled={!adding} onClick={() => { setApproverIds(ids => [...ids, adding]); setAdding(''); }}>
              <Plus className="size-g16" aria-hidden /><span>{t('approval.form.add', 'Add')}</span>
            </Button>
          </div>
          <div className="flex items-center gap-g8 rounded-lg bg-status-success-soft p-g8 text-status-success">
            <Info className="size-g16 shrink-0" aria-hidden />
            <Text size="xs">{t('approval.form.sequential', 'Approvals are processed in order.')}</Text>
          </div>
          <div className="mt-auto space-y-g8 pt-g13">
            {error && <Text size="sm" tone="destructive" role="alert">{error}</Text>}
            <Button type="submit" className="w-full" loading={submitting}>
              <Send className="size-g16" aria-hidden /><span>{t('approval.form.submit', 'Submit approval')}</span>
            </Button>
          </div>
        </Card>
      </div>
    </form>
  );
};
