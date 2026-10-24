import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, PenLine, Plus } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Clipboard, ClipboardControl, ClipboardInput, ClipboardLabel, ClipboardTrigger } from '@legalio/ui-components/clipboard';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Text } from '@legalio/ui-components/text';
import { ModalFrame } from '../ui/modal-frame';
import { endpointsApi, type SignatureEndpoint } from '../../api/signatures';
import { DialogHeader, errorText, formatTime } from './dialogParts';

/** Inbound signing webhook (administrators): create, rename, disable, rotate the secret and delete endpoints. Secrets are shown once. The server rechecks every call. */
export const SignatureEndpointsPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const confirm = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const headingId = useId();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const client = endpointsApi(organizationId);
  const queryKey = ['signature-endpoints', identity?.id, organizationId];
  const query = useQuery({ queryKey, queryFn: () => client.list(), staleTime: 0 });
  const endpoints = query.data?.endpoints ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const run = async (work: () => Promise<unknown>, success?: string) => {
    try { await work(); if (success) showAlert({ title: success, variant: 'success' }); await refresh(); } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); }
  };
  const rotate = async (endpoint: SignatureEndpoint) => {
    if (!(await confirm({ title: t('signatures.endpoints.rotate', 'Rotate secret'), description: t('signatures.endpoints.rotate_confirm', 'Deliveries signed with the old secret stop working immediately.'), confirmLabel: t('signatures.endpoints.rotate', 'Rotate secret'), tone: 'danger' }))) return;
    try { setSecret({ title: t('signatures.endpoints.new_secret', 'New signing secret'), value: (await client.rotate(endpoint.id)).secret }); await refresh(); } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); }
  };
  const remove = async (endpoint: SignatureEndpoint) => {
    if (!(await confirm({ title: t('signatures.endpoints.delete', 'Delete endpoint'), description: t('signatures.endpoints.delete_confirm', 'Delete "{name}"?', { name: endpoint.name }), confirmLabel: t('signatures.endpoints.delete', 'Delete endpoint'), tone: 'danger' }))) return;
    await run(() => client.remove(endpoint.id));
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="flex flex-wrap items-start justify-between gap-g13">
        <div className="min-w-0">
          <Heading as="h3" size="sm" weight="semibold" id={headingId} className="flex items-center gap-g8"><PenLine className="size-g16" aria-hidden="true" />{t('signatures.endpoints.title', 'Signing webhook')}</Heading>
          <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('signatures.endpoints.desc', 'Let your signing tool report signer events and the signed PDF to Legalio.')}</Text>
          <Text size="xs" className="mt-g3 text-muted-foreground">{t('signatures.endpoints.docs', 'Event format and examples: docs/SIGNATURES.md')}</Text>
        </div>
        <Button type="button" size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />{t('signatures.endpoints.add', 'Add endpoint')}</Button>
      </div>
      {query.isError ? (
        <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('signatures.endpoints.load_failed', 'The endpoints could not be loaded.')}</AlertDescription></AlertContent>
          <AlertActions><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('tb.retry', 'Retry')}</Button></AlertActions></Alert>
      ) : query.isLoading ? <Skeleton height={64} /> : endpoints.length === 0 ? (
        <Text size="sm" className="text-muted-foreground">{t('signatures.endpoints.none', 'No endpoints yet.')}</Text>
      ) : (
        <TableScrollArea>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>{t('signatures.endpoints.name', 'Name')}</TableColumnHeader>
                <TableColumnHeader>{t('signatures.endpoints.url', 'URL to call')}</TableColumnHeader>
                <TableColumnHeader>{t('signatures.endpoints.last', 'Last delivery')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_status', 'Status')}</TableColumnHeader>
                <TableColumnHeader><span className="sr-only">{t('data.col_actions', 'Actions')}</span></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.map((endpoint) => (
                <TableRow key={endpoint.id}>
                  <TableCell className="font-medium">{endpoint.name}</TableCell>
                  <TableCell className="max-w-72"><div className="truncate font-mono text-xs" title={endpoint.url}>{endpoint.url}</div></TableCell>
                  <TableCell>{endpoint.lastReceivedAt ? formatTime(endpoint.lastReceivedAt) : t('signatures.endpoints.never', 'Never')}</TableCell>
                  <TableCell><Badge tone={endpoint.enabled ? 'success' : 'warning'}>{endpoint.enabled ? t('signatures.endpoints.enabled', 'Enabled') : t('signatures.endpoints.disabled', 'Disabled')}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-g5">
                      <Button type="button" size="sm" variant="outline" onClick={() => void run(() => client.update(endpoint.id, { enabled: !endpoint.enabled }))}>{endpoint.enabled ? t('signatures.endpoints.disable', 'Disable') : t('signatures.endpoints.enable', 'Enable')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void rotate(endpoint)}>{t('signatures.endpoints.rotate', 'Rotate secret')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void remove(endpoint)}>{t('signatures.endpoints.delete', 'Delete endpoint')}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScrollArea>
      )}
      {creating && <CreateDialog organizationId={organizationId} onClose={() => setCreating(false)} onCreated={(value) => { setCreating(false); setSecret({ title: t('signatures.endpoints.created', 'Endpoint created'), value }); void refresh(); }} />}
      {secret && <SecretDialog title={secret.title} value={secret.value} onClose={() => setSecret(null)} />}
    </section>
  );
};

const CreateDialog: React.FC<{ organizationId: string; onClose: () => void; onCreated: (secret: string) => void }> = ({ organizationId, onClose, onCreated }) => {
  const { t } = useLanguage();
  const id = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try { onCreated((await endpointsApi(organizationId).create(name.trim())).secret); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <ModalFrame size="sm" onClose={onClose}>
      <DialogHeader title={t('signatures.endpoints.add', 'Add endpoint')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 p-g21">
        <Field>
          <FieldLabel htmlFor={id}>{t('signatures.endpoints.name', 'Name')}</FieldLabel>
          <Input id={id} maxLength={100} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          <FieldHelperText>{t('signatures.endpoints.name_hint', 'For example the name of the tool that calls it.')}</FieldHelperText>
        </Field>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{t('signatures.endpoints.add', 'Add endpoint')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const SecretDialog: React.FC<{ title: string; value: string; onClose: () => void }> = ({ title, value, onClose }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const label = copied ? t('tb.copied', 'Copied') : t('signatures.endpoints.copy', 'Copy secret');
  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={title} onClose={onClose} />
      <div className="flex flex-col gap-g13 p-g21">
        <Alert status="warning" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('signatures.endpoints.secret_once', 'Copy the secret now. It is shown only once.')}</AlertDescription></AlertContent></Alert>
        <Clipboard value={value} onStatusChange={(details) => setCopied(details.copied)}>
          <ClipboardLabel>{t('signatures.endpoints.secret', 'Signing secret')}</ClipboardLabel>
          <ClipboardControl>
            <ClipboardInput readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <ClipboardTrigger asChild><Button type="button" variant="outline" className="shrink-0" aria-label={label}><Copy aria-hidden="true" />{label}</Button></ClipboardTrigger>
          </ClipboardControl>
        </Clipboard>
        <span role="status" className="sr-only">{copied ? t('tb.copied', 'Copied') : ''}</span>
        <div className="flex justify-end"><Button type="button" onClick={onClose}>{t('tb.done', 'Done')}</Button></div>
      </div>
    </ModalFrame>
  );
};
