import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ListChecks, Plus, RefreshCw, Webhook as WebhookIcon } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Clipboard, ClipboardControl, ClipboardInput, ClipboardLabel, ClipboardTrigger } from '@legalio/ui-components/clipboard';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Text } from '@legalio/ui-components/text';
import { ModalFrame } from '../ui/modal-frame';
import { orgApi, orgPath } from './orgApi';
import { DialogHeader, errorText, formatTime } from './dialogParts';

interface EndpointDto {
  id: string; url: string; description: string; eventTypes: string[]; enabled: boolean; disabledReason: string | null; consecutiveFailures: number; createdAt: string;
}
interface DeliveryDto {
  id: string; eventType: string; status: 'pending' | 'sent' | 'failed' | 'dead' | 'skipped'; attempts: number; nextAttemptAt: string | null;
  lastStatusCode: number | null; lastError: string | null; durationMs: number | null; createdAt: string; sentAt: string | null;
}
const DELIVERY_TONE: Record<DeliveryDto['status'], StatusTone> = { pending: 'neutral', sent: 'success', failed: 'warning', dead: 'danger', skipped: 'neutral' };

/** Outbound webhooks: endpoints, event filter, test delivery, secret rotation and the delivery log. The server rechecks every call. */
export const WebhooksPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const confirm = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [log, setLog] = useState<EndpointDto | null>(null);
  const headingId = useId();
  const queryKey = ['org-webhooks', identity?.id, organizationId];
  const hooksQuery = useQuery<{ webhooks: EndpointDto[]; eventTypes: string[] }>({ queryKey, queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/webhooks'), { signal }), staleTime: 0 });
  const hooks = hooksQuery.data?.webhooks ?? [];
  const eventTypes = hooksQuery.data?.eventTypes ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const toast = (title: string, variant: 'success' | 'destructive' = 'success') => showAlert({ title, variant });
  const run = async (action: () => Promise<unknown>, success?: string) => {
    try { await action(); if (success) toast(success); await refresh(); } catch (err) { toast(errorText(err), 'destructive'); }
  };

  const test = (hook: EndpointDto) => run(async () => {
    const result = await orgApi<{ ok: boolean; statusCode: number | null; error: string | null }>(orgPath(organizationId, `/webhooks/${hook.id}/test`), { method: 'POST' });
    if (result.ok) toast(t('data.hooks.test_ok', 'Test delivered (HTTP {code}).', { code: String(result.statusCode ?? '') }));
    else toast(t('data.hooks.test_failed', 'Test failed: {error}', { error: result.error ?? '' }), 'destructive');
  });
  const rotate = async (hook: EndpointDto) => {
    if (!(await confirm({ title: t('data.hooks.rotate', 'Rotate secret'), description: t('data.hooks.rotate_confirm', 'Deliveries to "{url}" are signed with a new secret from now on. Update your receiver right away.', { url: hook.url }), confirmLabel: t('data.hooks.rotate', 'Rotate secret'), tone: 'danger' }))) return;
    try {
      const result = await orgApi<{ secret: string }>(orgPath(organizationId, `/webhooks/${hook.id}/rotate-secret`), { method: 'POST' });
      setSecret({ title: t('data.hooks.new_secret_title', 'New signing secret'), value: result.secret });
    } catch (err) { toast(errorText(err), 'destructive'); }
  };
  const remove = async (hook: EndpointDto) => {
    if (!(await confirm({ title: t('data.hooks.delete', 'Delete endpoint'), description: t('data.hooks.delete_confirm', 'Delete "{url}" and its delivery log?', { url: hook.url }), confirmLabel: t('data.hooks.delete', 'Delete endpoint'), tone: 'danger' }))) return;
    await run(() => orgApi(orgPath(organizationId, `/webhooks/${hook.id}`), { method: 'DELETE' }), t('data.hooks.deleted', 'Endpoint deleted.'));
  };
  const toggle = (hook: EndpointDto) => run(() => orgApi(orgPath(organizationId, `/webhooks/${hook.id}`), { method: 'PATCH', body: { enabled: !hook.enabled } }),
    hook.enabled ? t('data.hooks.disabled_done', 'Endpoint disabled.') : t('data.hooks.enabled_done', 'Endpoint enabled.'));

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="flex flex-wrap items-start justify-between gap-g13">
        <div className="min-w-0">
          <Heading as="h3" size="sm" weight="semibold" id={headingId} className="flex items-center gap-g8"><WebhookIcon className="size-g16" aria-hidden="true" />{t('data.hooks.title', 'Webhooks')}</Heading>
          <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('data.hooks.desc', 'Legalio sends a signed HTTPS request to your endpoint when contracts change, reminders are sent, approvals are requested or decided, and exports finish. Failed deliveries are retried with increasing delays.')}</Text>
        </div>
        <div className="flex gap-g8">
          <Button type="button" variant="outline" size="sm" onClick={() => void hooksQuery.refetch()}><RefreshCw aria-hidden="true" />{t('data.export.refresh', 'Refresh')}</Button>
          <Button type="button" size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />{t('data.hooks.add', 'Add endpoint')}</Button>
        </div>
      </div>
      {hooksQuery.isError ? (
        <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('data.hooks.load_failed', 'Webhooks could not be loaded.')}</AlertDescription></AlertContent>
          <AlertActions><Button variant="outline" size="sm" onClick={() => void hooksQuery.refetch()}>{t('tb.retry', 'Retry')}</Button></AlertActions></Alert>
      ) : hooksQuery.isLoading ? <Skeleton height={64} /> : hooks.length === 0 ? (
        <Text size="sm" className="text-muted-foreground">{t('data.hooks.none', 'No webhook endpoints yet.')}</Text>
      ) : (
        <TableScrollArea>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>{t('data.hooks.col_url', 'Endpoint')}</TableColumnHeader>
                <TableColumnHeader>{t('data.hooks.col_events', 'Events')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_status', 'Status')}</TableColumnHeader>
                <TableColumnHeader><span className="sr-only">{t('data.col_actions', 'Actions')}</span></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks.map((hook) => (
                <TableRow key={hook.id}>
                  <TableCell className="max-w-72"><div className="truncate font-mono text-xs" title={hook.url}>{hook.url}</div>{hook.description && <Text size="xs" className="text-muted-foreground">{hook.description}</Text>}</TableCell>
                  <TableCell className="max-w-64 text-xs">{hook.eventTypes.length ? hook.eventTypes.join(', ') : t('data.hooks.all_events', 'All events')}</TableCell>
                  <TableCell>
                    <Badge tone={hook.enabled ? 'success' : 'warning'}>{hook.enabled ? t('data.hooks.status_enabled', 'Enabled') : t('data.hooks.status_disabled', 'Disabled')}</Badge>
                    {hook.disabledReason === 'too_many_failures' && <Text size="xs" tone="destructive" className="mt-g3">{t('data.hooks.auto_disabled', 'Disabled after repeated failures.')}</Text>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-g5">
                      <Button type="button" size="sm" variant="outline" onClick={() => void test(hook)}>{t('data.hooks.test', 'Send test')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setLog(hook)}><ListChecks aria-hidden="true" />{t('data.hooks.log', 'Deliveries')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void toggle(hook)}>{hook.enabled ? t('data.hooks.disable', 'Disable') : t('data.hooks.enable', 'Enable')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void rotate(hook)}>{t('data.hooks.rotate', 'Rotate secret')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void remove(hook)}>{t('data.hooks.delete', 'Delete endpoint')}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScrollArea>
      )}
      {creating && <CreateDialog organizationId={organizationId} eventTypes={eventTypes} onClose={() => setCreating(false)}
        onCreated={(value) => { setCreating(false); setSecret({ title: t('data.hooks.created_title', 'Endpoint created'), value }); void refresh(); }} />}
      {secret && <SecretDialog title={secret.title} value={secret.value} onClose={() => setSecret(null)} />}
      {log && <DeliveriesDialog organizationId={organizationId} hook={log} onClose={() => { setLog(null); void refresh(); }} />}
    </section>
  );
};

const CreateDialog: React.FC<{ organizationId: string; eventTypes: string[]; onClose: () => void; onCreated: (secret: string) => void }> = ({ organizationId, eventTypes, onClose, onCreated }) => {
  const { t } = useLanguage();
  const [url, setUrl] = useState('https://');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { url: useId(), description: useId() };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await orgApi<{ secret: string }>(orgPath(organizationId, '/webhooks'), { method: 'POST', body: { url: url.trim(), description: description.trim(), eventTypes: selected } });
      onCreated(result.secret);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={t('data.hooks.add', 'Add endpoint')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        <Field>
          <FieldLabel htmlFor={ids.url}>{t('data.hooks.url', 'Endpoint URL')}</FieldLabel>
          <Input id={ids.url} type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
          <FieldHelperText>{t('data.hooks.url_hint', 'Must be https and reachable from the internet; private and internal addresses are refused.')}</FieldHelperText>
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.description}>{t('data.hooks.description', 'Description (optional)')}</FieldLabel>
          <Input id={ids.description} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Fieldset>
          <FieldsetLegend>{t('data.hooks.col_events', 'Events')}</FieldsetLegend>
          <Text size="xs" className="mb-g8 text-muted-foreground">{selected.length === 0 ? t('data.hooks.all_events_hint', 'No event selected: every event is sent.') : t('data.hooks.some_events_hint', 'Only the selected events are sent.')}</Text>
          <div className="grid gap-g5 sm:grid-cols-2">
            {eventTypes.map((type) => (
              <Checkbox key={type} checked={selected.includes(type)} onCheckedChange={(details) => setSelected((cur) => (details.checked === true ? [...new Set([...cur, type])] : cur.filter((item) => item !== type)))}>
                <CheckboxControl /><CheckboxLabel className="font-mono text-xs">{type}</CheckboxLabel><CheckboxHiddenInput />
              </Checkbox>
            ))}
          </div>
        </Fieldset>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || url.trim().length < 9}>{busy ? t('data.export.requesting', 'Requesting…') : t('data.hooks.add', 'Add endpoint')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const SecretDialog: React.FC<{ title: string; value: string; onClose: () => void }> = ({ title, value, onClose }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const label = copied ? t('tb.copied', 'Copied') : t('data.hooks.copy_secret', 'Copy secret');
  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={title} onClose={onClose} />
      <div className="flex flex-col gap-g13 p-g21">
        <Alert status="warning" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('data.hooks.secret_once', 'Copy the signing secret now. It is shown only once. Use it to verify the Legalio-Signature header of every delivery.')}</AlertDescription></AlertContent></Alert>
        <Clipboard value={value} onStatusChange={(details) => setCopied(details.copied)}>
          <ClipboardLabel>{t('data.hooks.secret', 'Signing secret')}</ClipboardLabel>
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

const DeliveriesDialog: React.FC<{ organizationId: string; hook: EndpointDto; onClose: () => void }> = ({ organizationId, hook, onClose }) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const query = useQuery<{ deliveries: DeliveryDto[]; total: number }>({
    queryKey: ['org-webhook-deliveries', organizationId, hook.id],
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, `/webhooks/${hook.id}/deliveries?limit=50`), { signal }),
    staleTime: 0,
    refetchInterval: 5000,
  });
  const retry = async (delivery: DeliveryDto) => {
    try {
      await orgApi(orgPath(organizationId, `/webhooks/${hook.id}/deliveries/${delivery.id}/retry`), { method: 'POST' });
      showAlert({ title: t('data.hooks.retry_queued', 'Delivery queued again.'), variant: 'success' });
      await query.refetch();
    } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); }
  };
  return (
    <ModalFrame size="xl" onClose={onClose}>
      <DialogHeader title={t('data.hooks.log_title', 'Deliveries: {url}', { url: hook.url })} onClose={onClose} />
      <div className="flex flex-col gap-g13 overflow-y-auto p-g21">
        {query.isError ? <Text size="sm" tone="destructive">{t('data.hooks.log_failed', 'The delivery log could not be loaded.')}</Text>
          : query.isLoading ? <Skeleton height={64} />
          : (query.data?.deliveries.length ?? 0) === 0 ? <Text size="sm" className="text-muted-foreground">{t('data.hooks.log_none', 'No deliveries yet.')}</Text> : (
            <TableScrollArea>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>{t('data.hooks.col_time', 'Time')}</TableColumnHeader>
                    <TableColumnHeader>{t('data.hooks.col_event', 'Event')}</TableColumnHeader>
                    <TableColumnHeader>{t('data.export.col_status', 'Status')}</TableColumnHeader>
                    <TableColumnHeader>{t('data.hooks.col_http', 'HTTP')}</TableColumnHeader>
                    <TableColumnHeader>{t('data.hooks.col_attempts', 'Attempts')}</TableColumnHeader>
                    <TableColumnHeader>{t('data.hooks.col_detail', 'Detail')}</TableColumnHeader>
                    <TableColumnHeader><span className="sr-only">{t('data.col_actions', 'Actions')}</span></TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data!.deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell>{formatTime(delivery.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
                      <TableCell><Badge tone={DELIVERY_TONE[delivery.status]}>{t(`data.hooks.delivery.${delivery.status}`, delivery.status)}</Badge></TableCell>
                      <TableCell>{delivery.lastStatusCode ?? '—'}</TableCell>
                      <TableCell>{delivery.attempts}</TableCell>
                      <TableCell className="max-w-64 text-xs">{delivery.lastError ?? (delivery.status === 'failed' && delivery.nextAttemptAt ? t('data.hooks.next_retry', 'Next retry {time}', { time: formatTime(delivery.nextAttemptAt) }) : '')}</TableCell>
                      <TableCell>{(delivery.status === 'dead' || delivery.status === 'failed') && delivery.eventType !== 'webhook.test' && <Button type="button" size="sm" variant="outline" onClick={() => void retry(delivery)}>{t('data.hooks.retry', 'Retry')}</Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollArea>
          )}
        <div className="flex justify-end"><Button type="button" onClick={onClose}>{t('tb.done', 'Done')}</Button></div>
      </div>
    </ModalFrame>
  );
};
