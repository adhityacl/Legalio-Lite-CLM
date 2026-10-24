import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Bell, CheckCircle2, FileCheck2, PenLine, Plus, Send, Trash2, Upload, XCircle } from 'lucide-react';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions } from '../../lib/permissions';
import { apiBlob, errorMessage } from '../../api/client';
import { MAX_SIGNATURE_FILE_BYTES, readFileAsDataUrl, signaturesApi, type SignatureEvent, type SignatureRequest, type SignatureStatus, type Signer } from '../../api/signatures';
import { ModalFrame } from '../../components/ui/modal-frame';
import { DialogHeader } from '../../components/settings/dialogParts';

const STATUS_TONE: Record<SignatureStatus, StatusTone> = { draft: 'neutral', sent: 'info', partially_signed: 'warning', completed: 'success', declined: 'danger', expired: 'danger', cancelled: 'neutral' };
const OPEN: SignatureStatus[] = ['draft', 'sent', 'partially_signed'];
const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

type Translate = (key: string, fallback?: string, values?: Record<string, unknown>) => string;

function eventText(t: Translate, event: SignatureEvent): string {
  const detail = event.detail as Record<string, string | number | undefined>;
  return t(`signatures.event.${event.type}`, event.type, { name: String(detail.name ?? ''), fileName: String(detail.fileName ?? ''), signed: detail.signed ?? '', of: detail.of ?? '' });
}
function actorText(t: Translate, actor: string, names: Map<string, string>): string {
  if (actor === 'system') return t('signatures.actor.system', 'the system');
  if (actor.startsWith('webhook:')) return t('signatures.actor.webhook', 'the signing webhook');
  return names.get(actor.replace(/^user:/, '')) ?? '';
}

/** The "Signatures" tab of a contract record: request, status timeline, manual progress, cancel/resend and the signed copy. The server enforces every rule shown here. */
export const ContractSignatures: React.FC<{ contractId: string; contractTitle?: string }> = ({ contractId, contractTitle }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('document.edit');
  const confirm = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<null | { kind: 'create' } | { kind: 'complete'; request: SignatureRequest } | { kind: 'evidence'; request: SignatureRequest } | { kind: 'decline'; request: SignatureRequest; signer: Signer }>(null);
  const queryKey = ['signatures', activeTenantId, contractId];
  const list = useQuery({ queryKey, queryFn: async ({ signal }) => {
    const page = await signaturesApi.forContract(contractId, { signal, organizationId: activeTenantId });
    return Promise.all(page.items.map(async (item) => (await signaturesApi.get(item.id, { signal })).request));
  }, enabled: Boolean(activeTenantId) });
  const requests = list.data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const hasOpen = requests.some((request) => OPEN.includes(request.status));
  const act = async (work: () => Promise<unknown>, done?: string) => {
    try { await work(); if (done) showAlert({ title: done, variant: 'success' }); await refresh(); } catch (err) {
      showAlert({ title: t('signatures.action.failed', 'The action failed'), description: errorMessage(err, ''), variant: 'destructive' });
    }
  };
  const cancel = async (request: SignatureRequest) => {
    if (!(await confirm({ title: t('signatures.action.cancel', 'Cancel request'), description: t('signatures.cancel_confirm', 'Cancel this signature request? Signers will no longer be able to sign it.'), confirmLabel: t('signatures.action.cancel', 'Cancel request'), tone: 'danger' }))) return;
    await act(() => signaturesApi.cancel(request.id));
  };

  return (
    <div className="space-y-g13" data-testid="contract-signatures">
      <div className="flex flex-wrap items-start justify-between gap-g8">
        <div className="min-w-0">
          <Heading as="h3" size="xs" weight="bold" className="flex items-center gap-g5 uppercase tracking-wider text-muted-foreground"><PenLine className="size-g16" aria-hidden />{t('signatures.title', 'Signature requests')}</Heading>
          <Text size="xs" tone="muted" className="mt-g3 max-w-prose">{t('signatures.desc', 'Track a contract through signing.')}</Text>
        </div>
        {canEdit && <Button type="button" size="sm" disabled={hasOpen} title={hasOpen ? t('signatures.open_exists', 'Finish or cancel the open request before starting a new one.') : undefined} onClick={() => setDialog({ kind: 'create' })}><Plus aria-hidden />{t('signatures.request', 'Request signature')}</Button>}
      </div>
      {list.isLoading && <div role="status"><span className="sr-only">{t('common.loading', 'Loading…')}</span><Skeleton className="h-g42 w-full" /></div>}
      {list.isError && <Card role="alert" className="p-g13 text-center"><Text size="sm" tone="destructive">{t('signatures.loading_failed', 'The signature requests could not be loaded.')}</Text></Card>}
      {!list.isLoading && !list.isError && requests.length === 0 && <Card className="p-g13 text-center"><Text size="sm" tone="muted">{t('signatures.none', 'No signature requests for this contract yet.')}</Text></Card>}
      <ul className="space-y-g13">
        {requests.map((request) => <RequestCard key={request.id} request={request} t={t} tenantId={activeTenantId} canEdit={canEdit} act={act} cancel={cancel} setDialog={setDialog} />)}
      </ul>
      {dialog?.kind === 'create' && <CreateDialog contractId={contractId} defaultTitle={contractTitle ?? ''} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); void refresh(); }} />}
      {dialog?.kind === 'complete' && <FilesDialog mode="complete" request={dialog.request} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); void queryClient.invalidateQueries({ queryKey: ['contracts'] }); }} />}
      {dialog?.kind === 'evidence' && <FilesDialog mode="evidence" request={dialog.request} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />}
      {dialog?.kind === 'decline' && <DeclineDialog request={dialog.request} signer={dialog.signer} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />}
    </div>
  );
};

const RequestCard: React.FC<{
  request: SignatureRequest; t: Translate; tenantId: string | null; canEdit: boolean; act: (work: () => Promise<unknown>, done?: string) => Promise<void>; cancel: (request: SignatureRequest) => Promise<void>;
  setDialog: (dialog: any) => void;
}> = ({ request, t, tenantId, canEdit, act, cancel, setDialog }) => {
  const open = OPEN.includes(request.status);
  const live = request.status === 'sent' || request.status === 'partially_signed';
  const names = new Map<string, string>();
  if (request.requestedByName) names.set(request.requestedBy, request.requestedByName);
  const downloadEvidence = async (url: string, name: string) => {
    // Files are served through the authenticated API; the browser fetches the bytes with the session and saves them.
    let blob: Blob;
    try { blob = await apiBlob(url, { organizationId: tenantId ?? undefined }); } catch { return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <li>
      <Card className="space-y-g13 p-g13" aria-label={request.title}>
        <div className="flex flex-wrap items-start justify-between gap-g8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-g8">
              <Text size="sm" weight="semibold" className="truncate">{request.title}</Text>
              <Badge tone={STATUS_TONE[request.status]}>{t(`signatures.status.${request.status}`, request.status)}</Badge>
              <Badge tone="neutral">{t(`signatures.mode.${request.mode}`, request.mode)}</Badge>
            </div>
            <Text size="xs" tone="muted" className="mt-g3">
              {request.requestedByName ? t('signatures.requested_by', 'Requested by {name}', { name: request.requestedByName }) : ''}
              {live && request.expiresAt ? ` · ${t('signatures.expires', 'Expires {time}', { time: time(request.expiresAt) })}` : ''}
            </Text>
          </div>
          {canEdit && open && (
            <div className="flex flex-wrap gap-g5">
              {request.status === 'draft' && <Button type="button" size="sm" onClick={() => void act(() => signaturesApi.send(request.id))}><Send aria-hidden />{t('signatures.action.send', 'Send')}</Button>}
              {live && <Button type="button" size="sm" variant="outline" onClick={() => void act(() => signaturesApi.resend(request.id), t('signatures.action.done', 'Done'))}><Bell aria-hidden />{t('signatures.action.resend', 'Send reminder')}</Button>}
              {live && <Button type="button" size="sm" onClick={() => setDialog({ kind: 'complete', request })}><FileCheck2 aria-hidden />{t('signatures.action.complete', 'Mark as signed / upload signed copy')}</Button>}
              {live && <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: 'evidence', request })}><Upload aria-hidden />{t('signatures.action.evidence', 'Add evidence')}</Button>}
              <Button type="button" size="sm" variant="outline" onClick={() => void cancel(request)}><Ban aria-hidden />{t('signatures.action.cancel', 'Cancel request')}</Button>
            </div>
          )}
        </div>
        <section aria-label={t('signatures.signers', 'Signers')}>
          <Heading as="h4" size="xs" weight="semibold" className="mb-g5 text-muted-foreground">{t('signatures.signers', 'Signers')}</Heading>
          <ul className="space-y-g5">
            {request.signers.map((signer) => (
              <li key={signer.id} className="flex flex-wrap items-center justify-between gap-g8 rounded-md border border-border px-g8 py-g5">
                <div className="min-w-0">
                  <Text size="sm" weight="medium" className="truncate">{signer.name}</Text>
                  <Text size="xs" tone="muted" className="truncate">{signer.email}{request.mode === 'sequential' ? ` · ${t('signatures.signer.order', 'Order {n}', { n: signer.order })}` : ''}</Text>
                  {signer.status === 'signed' && <Text size="xs" tone="muted">{t('signatures.signer.signed_at', 'Signed {time}', { time: time(signer.signedAt) })}</Text>}
                  {signer.status === 'declined' && <Text size="xs" tone="destructive">{t('signatures.signer.declined', 'Declined: {reason}', { reason: signer.declineReason ?? '—' })}</Text>}
                </div>
                <div className="flex flex-wrap items-center gap-g5">
                  {signer.canSignNow && <Badge tone="info">{t('signatures.signer.your_turn', 'Next to sign')}</Badge>}
                  <Badge tone={signer.status === 'signed' ? 'success' : signer.status === 'declined' ? 'danger' : 'neutral'}>{t(`signatures.signer_status.${signer.status}`, signer.status)}</Badge>
                  {canEdit && signer.canSignNow && (
                    <>
                      <Button type="button" size="sm" variant="outline" aria-label={t('signatures.mark_signed', 'Mark {name} as signed', { name: signer.name })} onClick={() => void act(() => signaturesApi.signerSigned(request.id, signer.id))}><CheckCircle2 aria-hidden />{t('signatures.signer_status.signed', 'Signed')}</Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={`${t('signatures.mark_declined', 'Record decline')}: ${signer.name}`} onClick={() => setDialog({ kind: 'decline', request, signer })}><XCircle aria-hidden />{t('signatures.signer_status.declined', 'Declined')}</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
        {(request.status === 'completed' || (request.files?.length ?? 0) > 0) && (
          <section aria-label={t('signatures.files', 'Files')}>
            <Heading as="h4" size="xs" weight="semibold" className="mb-g5 text-muted-foreground">{t('signatures.files', 'Files')}</Heading>
            {request.status === 'completed' && !request.signedFile && <Text size="xs" tone="muted">{t('signatures.no_signed_copy', 'No signed copy attached yet.')}</Text>}
            <ul className="space-y-g3">
              {(request.files ?? []).map((file) => (
                <li key={file.id} className="flex flex-wrap items-center gap-g8">
                  <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => void downloadEvidence(file.downloadUrl, file.fileName)} aria-label={t('signatures.download', 'Download {name}', { name: file.fileName })}>{file.fileName}</Button>
                  <Badge tone={file.kind === 'signed' ? 'success' : 'neutral'}>{file.kind === 'signed' ? t('signatures.signed_copy', 'Signed copy') : t('signatures.evidence.label', 'Evidence')}</Badge>
                </li>
              ))}
            </ul>
            {request.status === 'completed' && canEdit && <Button type="button" size="sm" variant="outline" className="mt-g8" onClick={() => setDialog({ kind: 'evidence', request })}><Upload aria-hidden />{t('signatures.action.evidence', 'Add evidence')}</Button>}
          </section>
        )}
        <section aria-label={t('signatures.timeline', 'Timeline')}>
          <Heading as="h4" size="xs" weight="semibold" className="mb-g5 text-muted-foreground">{t('signatures.timeline', 'Timeline')}</Heading>
          <ol className="space-y-g3 border-s border-border ps-g13">
            {(request.events ?? []).map((event) => {
              const who = actorText(t, event.actor, names);
              return (
                <li key={event.id} className="text-xs">
                  <span className="font-medium">{eventText(t, event)}</span>
                  <span className="text-muted-foreground"> · {time(event.createdAt)}{who ? ` · ${t('signatures.event.by', 'by {actor}', { actor: who })}` : ''}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </Card>
    </li>
  );
};

const CreateDialog: React.FC<{ contractId: string; defaultTitle: string; onClose: () => void; onCreated: () => void }> = ({ contractId, defaultTitle, onClose, onCreated }) => {
  const { t } = useLanguage();
  const ids = { title: useId(), message: useId(), mode: useId(), days: useId() };
  const [title, setTitle] = useState(defaultTitle);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'sequential' | 'parallel'>('sequential');
  const [days, setDays] = useState('30');
  const [sendNow, setSendNow] = useState(false);
  const [rows, setRows] = useState([{ name: '', email: '' }, { name: '', email: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = rows.length > 0 && rows.every((row) => row.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email.trim()));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signaturesApi.create({
        contract_id: contractId, title: title.trim() || undefined, message: message.trim() || undefined, mode, expiresInDays: Number(days) || undefined, send: sendNow,
        signers: rows.map((row, index) => ({ name: row.name.trim(), email: row.email.trim(), order: mode === 'sequential' ? index + 1 : undefined })),
      });
      onCreated();
    } catch (err) { setError(errorMessage(err, t('signatures.create.error', 'The request could not be created.'))); } finally { setBusy(false); }
  };
  return (
    <ModalFrame size="lg" onClose={onClose}>
      <DialogHeader title={t('signatures.create.title', 'Request signature')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        <Field>
          <FieldLabel htmlFor={ids.title}>{t('signatures.create.field.title', 'Title')}</FieldLabel>
          <Input id={ids.title} maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.mode}>{t('signatures.create.field.mode', 'Signing order')}</FieldLabel>
            <NativeSelect id={ids.mode} value={mode} onChange={(e) => setMode(e.target.value as 'sequential' | 'parallel')}>
              <option value="sequential">{t('signatures.mode.sequential', 'In order')}</option>
              <option value="parallel">{t('signatures.mode.parallel', 'All at once')}</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.days}>{t('signatures.create.field.expires', 'Expires after (days)')}</FieldLabel>
            <Input id={ids.days} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <fieldset className="flex min-w-0 flex-col gap-g8">
          <legend className="mb-g5 text-sm font-medium">{t('signatures.create.signers', 'Signers')}</legend>
          {rows.map((row, index) => (
            <div key={index} className="grid items-end gap-g8 sm:grid-cols-[1fr_1fr_auto]">
              <Field>
                <FieldLabel htmlFor={`${ids.title}-n${index}`}>{t('signatures.create.signer_name', 'Name')}{mode === 'sequential' ? ` (${t('signatures.signer.order', 'Order {n}', { n: index + 1 })})` : ''}</FieldLabel>
                <Input id={`${ids.title}-n${index}`} autoComplete="off" value={row.name} onChange={(e) => setRows((cur) => cur.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${ids.title}-e${index}`}>{t('signatures.create.signer_email', 'E-mail')}</FieldLabel>
                <Input id={`${ids.title}-e${index}`} type="email" autoComplete="off" value={row.email} onChange={(e) => setRows((cur) => cur.map((item, i) => (i === index ? { ...item, email: e.target.value } : item)))} />
              </Field>
              <Button type="button" variant="outline" size="icon-md" disabled={rows.length === 1} aria-label={t('signatures.create.remove_signer', 'Remove signer {n}', { n: String(index + 1) })} onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))}><Trash2 aria-hidden /></Button>
            </div>
          ))}
          <div><Button type="button" size="sm" variant="outline" disabled={rows.length >= 20} onClick={() => setRows((cur) => [...cur, { name: '', email: '' }])}><Plus aria-hidden />{t('signatures.create.add_signer', 'Add signer')}</Button></div>
        </fieldset>
        <Field>
          <FieldLabel htmlFor={ids.message}>{t('signatures.create.field.message', 'Message to the signers (optional)')}</FieldLabel>
          <Textarea id={ids.message} rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div>
          <Checkbox checked={sendNow} onCheckedChange={(details) => setSendNow(details.checked === true)}><CheckboxControl /><CheckboxLabel>{t('signatures.create.field.send', 'Mark as sent right away')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
          <FieldHelperText>{t('signatures.create.field.send_hint', '')}</FieldHelperText>
        </div>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !valid}>{t('signatures.create.submit', 'Create request')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const FilesDialog: React.FC<{ mode: 'complete' | 'evidence'; request: SignatureRequest; onClose: () => void; onDone: () => void }> = ({ mode, request, onClose, onDone }) => {
  const { t } = useLanguage();
  const ids = { signed: useId(), evidence: useId() };
  const [signed, setSigned] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mb = Math.floor(MAX_SIGNATURE_FILE_BYTES / 1024 / 1024);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const read = async (file: File) => ({ fileName: file.name, fileData: await readFileAsDataUrl(file, MAX_SIGNATURE_FILE_BYTES) });
      const extra = await Promise.all(evidence.slice(0, 5).map(read));
      if (mode === 'complete') await signaturesApi.complete(request.id, await read(signed!), extra);
      else await signaturesApi.addEvidence(request.id, extra);
      onDone();
    } catch (err) {
      setError(err instanceof RangeError ? t('signatures.complete.too_large', 'That file is larger than {mb} MB.', { mb }) : errorMessage(err, t('signatures.complete.error', 'The request could not be completed.')));
    } finally { setBusy(false); }
  };
  const title = mode === 'complete' ? t('signatures.complete.title', 'Mark as signed') : t('signatures.evidence.title', 'Add evidence');
  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={title} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        {mode === 'complete' && <Text size="sm" tone="muted">{t('signatures.complete.desc', 'Upload the fully signed PDF.')}</Text>}
        {mode === 'complete' && (
          <Field>
            <FieldLabel htmlFor={ids.signed}>{t('signatures.complete.file', 'Signed copy (PDF)')}</FieldLabel>
            <Input id={ids.signed} type="file" accept="application/pdf,.pdf" onChange={(e) => setSigned(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={ids.evidence}>{t('signatures.complete.evidence', 'Evidence (optional: PDF, PNG or JPEG, up to 5 files)')}</FieldLabel>
          <Input id={ids.evidence} type="file" multiple accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" onChange={(e) => setEvidence(Array.from(e.target.files ?? []).slice(0, 5))} />
        </Field>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || (mode === 'complete' ? !signed : evidence.length === 0)}>{mode === 'complete' ? t('signatures.complete.submit', 'Mark as signed') : t('signatures.evidence.submit', 'Upload')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const DeclineDialog: React.FC<{ request: SignatureRequest; signer: Signer; onClose: () => void; onDone: () => void }> = ({ request, signer, onClose, onDone }) => {
  const { t } = useLanguage();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try { await signaturesApi.signerDeclined(request.id, signer.id, reason.trim() || undefined); onDone(); } catch (err) { setError(errorMessage(err, t('signatures.action.failed', 'The action failed'))); } finally { setBusy(false); }
  };
  return (
    <ModalFrame size="sm" onClose={onClose}>
      <DialogHeader title={`${t('signatures.decline.title', 'Record decline')}: ${signer.name}`} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 p-g21">
        <Field>
          <FieldLabel htmlFor={id}>{t('signatures.decline.reason', 'Reason (optional)')}</FieldLabel>
          <Textarea id={id} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy}>{t('signatures.decline.submit', 'Record decline')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

export default ContractSignatures;
