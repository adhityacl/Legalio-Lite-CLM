import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RefreshCw } from 'lucide-react';
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

const RESOURCES = ['contracts', 'partners', 'orders', 'spendings'] as const;
interface ApiKeyDto {
  id: string; name: string; prefix: string; scopes: string[]; rateLimitPerMinute: number; createdAt: string; expiresAt: string | null;
  revokedAt: string | null; lastUsedAt: string | null; status: 'active' | 'revoked' | 'expired';
}
const TONE: Record<ApiKeyDto['status'], StatusTone> = { active: 'success', revoked: 'danger', expired: 'warning' };

/** API keys of the organization: create (the secret is shown once), list, revoke. The server rechecks every call. */
export const ApiKeysPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const confirm = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const headingId = useId();
  const queryKey = ['org-api-keys', identity?.id, organizationId];
  const keysQuery = useQuery<{ apiKeys: ApiKeyDto[] }>({ queryKey, queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/api-keys'), { signal }), staleTime: 0 });
  const keys = keysQuery.data?.apiKeys ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const revoke = async (key: ApiKeyDto) => {
    if (!(await confirm({
      title: t('data.keys.revoke', 'Revoke key'),
      description: t('data.keys.revoke_confirm', 'Revoke "{name}"? Integrations using it stop working immediately. This cannot be undone.', { name: key.name }),
      confirmLabel: t('data.keys.revoke', 'Revoke key'), tone: 'danger',
    }))) return;
    try {
      await orgApi(orgPath(organizationId, `/api-keys/${key.id}/revoke`), { method: 'POST' });
      showAlert({ title: t('data.keys.revoked', 'API key revoked.'), variant: 'success' });
      await refresh();
    } catch (err) {
      showAlert({ title: errorText(err), variant: 'destructive' });
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="flex flex-wrap items-start justify-between gap-g13">
        <div className="min-w-0">
          <Heading as="h3" size="sm" weight="semibold" id={headingId} className="flex items-center gap-g8"><KeyRound className="size-g16" aria-hidden="true" />{t('data.keys.title', 'API keys')}</Heading>
          <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('data.keys.desc', 'Keys let your own systems read and write this organization\'s contracts, partners, orders and spendings through /api/v1. A key sees the whole organization, so give it only the scopes it needs. See the API guide for details.')}</Text>
        </div>
        <div className="flex gap-g8">
          <Button type="button" variant="outline" size="sm" onClick={() => void keysQuery.refetch()}><RefreshCw aria-hidden="true" />{t('data.export.refresh', 'Refresh')}</Button>
          <Button type="button" size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />{t('data.keys.create', 'Create key')}</Button>
        </div>
      </div>
      {keysQuery.isError ? (
        <Alert status="error" role="alert">
          <AlertIndicator />
          <AlertContent><AlertDescription>{t('data.keys.load_failed', 'API keys could not be loaded.')}</AlertDescription></AlertContent>
          <AlertActions><Button variant="outline" size="sm" onClick={() => void keysQuery.refetch()}>{t('tb.retry', 'Retry')}</Button></AlertActions>
        </Alert>
      ) : keysQuery.isLoading ? (
        <Skeleton height={64} />
      ) : keys.length === 0 ? (
        <Text size="sm" className="text-muted-foreground">{t('data.keys.none', 'No API keys yet.')}</Text>
      ) : (
        <TableScrollArea>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>{t('data.keys.col_name', 'Name')}</TableColumnHeader>
                <TableColumnHeader>{t('data.keys.col_key', 'Key')}</TableColumnHeader>
                <TableColumnHeader>{t('data.keys.col_scopes', 'Scopes')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_status', 'Status')}</TableColumnHeader>
                <TableColumnHeader>{t('data.keys.col_expires', 'Expires')}</TableColumnHeader>
                <TableColumnHeader>{t('data.keys.col_last_used', 'Last used')}</TableColumnHeader>
                <TableColumnHeader>{t('data.keys.col_limit', 'Limit / min')}</TableColumnHeader>
                <TableColumnHeader><span className="sr-only">{t('data.col_actions', 'Actions')}</span></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell>{key.name}</TableCell>
                  <TableCell><code className="text-xs">{key.prefix}…</code></TableCell>
                  <TableCell className="max-w-64 text-xs">{key.scopes.join(', ')}</TableCell>
                  <TableCell><Badge tone={TONE[key.status]}>{t(`data.keys.status.${key.status}`, key.status)}</Badge></TableCell>
                  <TableCell>{key.expiresAt ? formatTime(key.expiresAt) : t('data.keys.never', 'Never')}</TableCell>
                  <TableCell>{key.lastUsedAt ? formatTime(key.lastUsedAt) : t('data.keys.never_used', 'Never used')}</TableCell>
                  <TableCell>{key.rateLimitPerMinute}</TableCell>
                  <TableCell>{key.status === 'active' && <Button type="button" size="sm" variant="outline" onClick={() => void revoke(key)}>{t('data.keys.revoke', 'Revoke key')}</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScrollArea>
      )}
      {creating && <CreateKeyDialog organizationId={organizationId} onClose={() => setCreating(false)} onCreated={(name, value) => { setCreating(false); setSecret({ name, value }); void refresh(); }} />}
      {secret && <SecretDialog name={secret.name} value={secret.value} onClose={() => setSecret(null)} />}
    </section>
  );
};

const CreateKeyDialog: React.FC<{ organizationId: string; onClose: () => void; onCreated: (name: string, secret: string) => void }> = ({ organizationId, onClose, onCreated }) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresOn, setExpiresOn] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), expires: useId(), limit: useId() };
  const toggle = (scope: string, on: boolean) => setScopes((current) => (on ? [...new Set([...current, scope])] : current.filter((item) => item !== scope)));
  const valid = name.trim().length > 0 && scopes.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim(), scopes };
      if (expiresOn) body.expiresAt = new Date(`${expiresOn}T23:59:59`).toISOString();
      if (limit) body.rateLimitPerMinute = Number(limit);
      const result = await orgApi<{ secret: string }>(orgPath(organizationId, '/api-keys'), { method: 'POST', body });
      onCreated(name.trim(), result.secret);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={t('data.keys.create', 'Create key')} onClose={onClose} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        <Field>
          <FieldLabel htmlFor={ids.name}>{t('data.keys.col_name', 'Name')}</FieldLabel>
          <Input id={ids.name} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <FieldHelperText>{t('data.keys.name_hint', 'What the key is for, for example "ERP sync".')}</FieldHelperText>
        </Field>
        <Fieldset>
          <FieldsetLegend>{t('data.keys.col_scopes', 'Scopes')}</FieldsetLegend>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-g21 gap-y-g8">
            <span />
            <Text size="xs" weight="medium">{t('data.keys.read', 'Read')}</Text>
            <Text size="xs" weight="medium">{t('data.keys.write', 'Write')}</Text>
            {RESOURCES.map((resource) => (
              <React.Fragment key={resource}>
                <Text size="sm">{t(`data.keys.resource.${resource}`, resource)}</Text>
                {(['read', 'write'] as const).map((verb) => (
                  <Checkbox key={verb} checked={scopes.includes(`${resource}:${verb}`)} onCheckedChange={(details) => toggle(`${resource}:${verb}`, details.checked === true)}>
                    <CheckboxControl /><CheckboxLabel className="sr-only">{t(`data.keys.resource.${resource}`, resource)} — {t(`data.keys.${verb}`, verb)}</CheckboxLabel><CheckboxHiddenInput />
                  </Checkbox>
                ))}
              </React.Fragment>
            ))}
          </div>
          <Text size="xs" className="mt-g8 text-muted-foreground">{t('data.keys.scope_hint', 'Write does not include read; choose both when the integration needs both.')}</Text>
        </Fieldset>
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={ids.expires}>{t('data.keys.expires_on', 'Expires on (optional)')}</FieldLabel>
            <Input id={ids.expires} type="date" min={new Date().toISOString().slice(0, 10)} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.limit}>{t('data.keys.limit_label', 'Requests per minute (optional)')}</FieldLabel>
            <Input id={ids.limit} type="number" inputMode="numeric" min={1} max={6000} placeholder="600" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={!valid || busy}>{busy ? t('data.export.requesting', 'Requesting…') : t('data.keys.create', 'Create key')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

/** The secret is shown here once and exists nowhere else afterwards. */
const SecretDialog: React.FC<{ name: string; value: string; onClose: () => void }> = ({ name, value, onClose }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const label = copied ? t('tb.copied', 'Copied') : t('data.keys.copy', 'Copy key');
  return (
    <ModalFrame size="md" onClose={onClose}>
      <DialogHeader title={t('data.keys.created_title', 'Key "{name}" created', { name })} onClose={onClose} />
      <div className="flex flex-col gap-g13 p-g21">
        <Alert status="warning" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('data.keys.show_once', 'Copy the key now. It is shown only once and cannot be retrieved later; if you lose it, revoke it and create a new one.')}</AlertDescription></AlertContent></Alert>
        <Clipboard value={value} onStatusChange={(details) => setCopied(details.copied)}>
          <ClipboardLabel>{t('data.keys.col_key', 'Key')}</ClipboardLabel>
          <ClipboardControl>
            <ClipboardInput readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <ClipboardTrigger asChild>
              <Button type="button" variant="outline" className="shrink-0" aria-label={label}><Copy aria-hidden="true" />{label}</Button>
            </ClipboardTrigger>
          </ClipboardControl>
        </Clipboard>
        <span role="status" className="sr-only">{copied ? t('tb.copied', 'Copied') : ''}</span>
        <div className="flex justify-end"><Button type="button" onClick={onClose}>{t('tb.done', 'Done')}</Button></div>
      </div>
    </ModalFrame>
  );
};
