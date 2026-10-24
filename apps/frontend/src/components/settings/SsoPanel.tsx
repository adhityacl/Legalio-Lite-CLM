import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Field, FieldHelperText, FieldLabel } from '@legalio/ui-components/field';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { Textarea } from '@legalio/ui-components/textarea';
import { ModalFrame } from '../ui/modal-frame';
import { orgApi, orgPath } from './orgApi';
import { DialogHeader, errorText } from './dialogParts';

type Role = 'admin' | 'manager' | 'editor' | 'viewer';
const ROLES: Role[] = ['viewer', 'editor', 'manager', 'admin'];
interface Mapping { value: string; role: Role; departmentIds: string[] }
interface SsoDto {
  enabled: boolean; issuerUrl: string; clientId: string; clientSecretSet: boolean; scopes: string; allowedDomains: string[]; jitEnabled: boolean; defaultRole: Role;
  defaultDepartmentIds: string[]; roleClaim: string; roleMapping: Mapping[]; syncRoles: boolean; requireSso: boolean; breakGlassUserIds: string[]; version: number;
}
interface SsoResponse { sso: SsoDto | null; redirectUri: string; loginPath: string; slug: string }
interface Department { id: string; name: string }
interface Member { id: string; userId: string; name: string; email: string; tenantRole: Role; status: string }

/** Single sign-on (OIDC) for the organization: provider settings, domain rules, role mapping, "SSO required" and break-glass administrators. */
export const SsoPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const confirm = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const headingId = useId();
  const queryKey = ['org-sso', identity?.id, organizationId];
  const query = useQuery<SsoResponse>({ queryKey, queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/sso'), { signal }), staleTime: 0 });
  const sso = query.data?.sso ?? null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const remove = async () => {
    if (!(await confirm({ title: t('sso.remove', 'Remove SSO'), description: t('sso.remove_confirm', 'Remove the SSO configuration and all linked identities? Members can then only sign in with a password.'), confirmLabel: t('sso.remove', 'Remove SSO'), tone: 'danger' }))) return;
    try {
      await orgApi(orgPath(organizationId, '/sso'), { method: 'DELETE' });
      showAlert({ title: t('sso.removed', 'Single sign-on removed.'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); }
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="flex flex-wrap items-start justify-between gap-g13">
        <div className="min-w-0">
          <Heading as="h3" size="sm" weight="semibold" id={headingId} className="flex items-center gap-g8"><KeyRound className="size-g16" aria-hidden="true" />{t('sso.title', 'Single sign-on (OIDC)')}</Heading>
          <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('sso.desc', 'Let members sign in with your identity provider.')}</Text>
        </div>
        <div className="flex gap-g8">
          {sso && <Button type="button" variant="outline" size="sm" onClick={() => void remove()}><Trash2 aria-hidden="true" />{t('sso.remove', 'Remove SSO')}</Button>}
          <Button type="button" size="sm" disabled={!query.data} onClick={() => setEditing(true)}>{sso ? t('sso.edit', 'Edit settings') : t('sso.configure', 'Configure')}</Button>
        </div>
      </div>
      {query.isError ? (
        <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('sso.load_failed', 'The SSO settings could not be loaded.')}</AlertDescription></AlertContent>
          <AlertActions><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('tb.retry', 'Retry')}</Button></AlertActions></Alert>
      ) : query.isLoading ? <Skeleton height={48} /> : (
        <dl className="grid gap-x-g21 gap-y-g8 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">{t('data.export.col_status', 'Status')}</dt>
          <dd className="flex flex-wrap gap-g5">
            {!sso ? <Badge tone="neutral">{t('sso.status.not_configured', 'Not configured')}</Badge>
              : <Badge tone={sso.enabled ? 'success' : 'warning'}>{sso.enabled ? t('sso.status.enabled', 'Enabled') : t('sso.status.disabled', 'Disabled')}</Badge>}
            {sso?.enabled && sso.requireSso && <Badge tone="info">{t('sso.status.required', 'Required')}</Badge>}
          </dd>
          {sso && <><dt className="text-muted-foreground">{t('sso.summary.issuer', 'Issuer')}</dt><dd className="break-all font-mono text-xs">{sso.issuerUrl}</dd>
            <dt className="text-muted-foreground">{t('sso.summary.domains', 'Allowed domains')}</dt><dd>{sso.allowedDomains.join(', ')}</dd></>}
          {query.data && <><dt className="text-muted-foreground">{t('sso.login_link', 'Sign-in link for members')}</dt><dd className="break-all font-mono text-xs">{`${origin}${query.data.loginPath}`}</dd></>}
        </dl>
      )}
      {editing && query.data && <SsoDialog organizationId={organizationId} data={query.data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void queryClient.invalidateQueries({ queryKey }); }} />}
    </section>
  );
};

const SsoDialog: React.FC<{ organizationId: string; data: SsoResponse; onClose: () => void; onSaved: () => void }> = ({ organizationId, data, onClose, onSaved }) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const { identity } = useIdentity();
  const current = data.sso;
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [issuerUrl, setIssuerUrl] = useState(current?.issuerUrl ?? 'https://');
  const [clientId, setClientId] = useState(current?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState(current?.scopes ?? 'openid email profile');
  const [domains, setDomains] = useState((current?.allowedDomains ?? []).join('\n'));
  const [jit, setJit] = useState(current?.jitEnabled ?? false);
  const [defaultRole, setDefaultRole] = useState<Role>(current?.defaultRole ?? 'viewer');
  const [defaultDepartments, setDefaultDepartments] = useState<string[]>(current?.defaultDepartmentIds ?? []);
  const [roleClaim, setRoleClaim] = useState(current?.roleClaim ?? '');
  const [mapping, setMapping] = useState<Mapping[]>(current?.roleMapping ?? []);
  const [syncRoles, setSyncRoles] = useState(current?.syncRoles ?? false);
  const [requireSso, setRequireSso] = useState(current?.requireSso ?? false);
  const [breakGlass, setBreakGlass] = useState<string[]>(current?.breakGlassUserIds?.length ? current.breakGlassUserIds : identity ? [identity.id] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ids = { issuer: useId(), clientId: useId(), secret: useId(), scopes: useId(), domains: useId(), role: useId(), claim: useId(), redirect: useId() };

  const departmentsQuery = useQuery<{ departments: Department[] }>({ queryKey: ['org-sso-departments', organizationId], queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/departments?limit=100'), { signal }), staleTime: 30_000 });
  const membersQuery = useQuery<{ members: Member[] }>({ queryKey: ['org-sso-admins', organizationId], queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/members?status=active&limit=100'), { signal }), staleTime: 30_000 });
  const departments = departmentsQuery.data?.departments ?? [];
  const admins = (membersQuery.data?.members ?? []).filter((member) => member.tenantRole === 'admin' && member.status === 'active');
  const roleLabel = (role: Role) => t(`tb.role_${role}`, role);

  const body = () => ({
    enabled, issuerUrl: issuerUrl.trim(), clientId: clientId.trim(), ...(clientSecret ? { clientSecret } : {}), scopes: scopes.trim(),
    allowedDomains: domains.split(/[\s,;]+/).map((domain) => domain.trim()).filter(Boolean), jitEnabled: jit, defaultRole,
    defaultDepartmentIds: defaultRole === 'admin' ? [] : defaultDepartments, roleClaim: roleClaim.trim(),
    roleMapping: mapping.filter((entry) => entry.value.trim()).map((entry) => ({ ...entry, value: entry.value.trim(), departmentIds: entry.role === 'admin' ? [] : entry.departmentIds })),
    syncRoles, requireSso, breakGlassUserIds: requireSso ? breakGlass : breakGlass.filter((id) => admins.some((admin) => admin.userId === id)),
    ...(current ? { expectedVersion: current.version } : {}),
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await orgApi(orgPath(organizationId, '/sso'), { method: 'PUT', body: body() });
      showAlert({ title: t('sso.saved', 'Single sign-on settings saved.'), variant: 'success' });
      onSaved();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const test = async () => {
    try {
      const result = await orgApi<{ ok: boolean; issuer?: string; message?: string }>(orgPath(organizationId, '/sso/test'), { method: 'POST' });
      showAlert(result.ok ? { title: t('sso.test_ok', 'The provider answered: {issuer}', { issuer: result.issuer ?? '' }), variant: 'success' }
        : { title: t('sso.test_failed', 'The connection test failed: {message}', { message: result.message ?? '' }), variant: 'destructive' });
    } catch (err) { showAlert({ title: errorText(err), variant: 'destructive' }); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.redirectUri); setCopied(true); } catch { /* clipboard unavailable */ }
  };
  const pickDepartments = (value: string[], onChange: (next: string[]) => void, legend: string) => (
    <Fieldset>
      <FieldsetLegend className="pb-0 text-sm font-medium">{legend}</FieldsetLegend>
      <Card className="grid max-h-g233 gap-g3 overflow-y-auto p-g8 sm:grid-cols-2">
        {departments.map((department) => (
          <Checkbox key={department.id} checked={value.includes(department.id)} onCheckedChange={(details) => onChange(details.checked === true ? [...value, department.id] : value.filter((id) => id !== department.id))}>
            <CheckboxControl /><CheckboxLabel>{department.name}</CheckboxLabel><CheckboxHiddenInput />
          </Checkbox>
        ))}
      </Card>
    </Fieldset>
  );
  const valid = issuerUrl.trim().length > 8 && clientId.trim().length > 0 && (current?.clientSecretSet || clientSecret.length > 0);

  return (
    <ModalFrame size="xl" onClose={onClose}>
      <DialogHeader title={t('sso.dialog.title', 'Single sign-on settings')} onClose={onClose} />
      <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-g21 overflow-y-auto p-g21">
        <Field>
          <FieldLabel htmlFor={ids.redirect}>{t('sso.redirect_uri', 'Redirect URI (register this at your provider)')}</FieldLabel>
          <div className="flex gap-g8">
            <Input id={ids.redirect} readOnly value={data.redirectUri} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" className="shrink-0" onClick={() => void copy()}><Copy aria-hidden="true" />{copied ? t('sso.copied', 'Copied') : t('sso.copy', 'Copy')}</Button>
          </div>
        </Field>
        <Checkbox checked={enabled} onCheckedChange={(details) => setEnabled(details.checked === true)}><CheckboxControl /><CheckboxLabel>{t('sso.field.enabled', 'Enable single sign-on for this organization')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
        <div className="grid gap-g13 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={ids.issuer}>{t('sso.field.issuer', 'Issuer URL')}</FieldLabel>
            <Input id={ids.issuer} type="url" inputMode="url" autoComplete="off" spellCheck={false} value={issuerUrl} onChange={(e) => setIssuerUrl(e.target.value)} />
            <FieldHelperText>{t('sso.field.issuer_hint', 'The provider\'s OpenID Connect issuer.')}</FieldHelperText>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.clientId}>{t('sso.field.client_id', 'Client ID')}</FieldLabel>
            <Input id={ids.clientId} autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.secret}>{t('sso.field.client_secret', 'Client secret')}</FieldLabel>
            <Input id={ids.secret} type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
            <FieldHelperText>{current?.clientSecretSet ? t('sso.field.client_secret_keep', 'A secret is stored. Leave empty to keep it.') : t('sso.field.client_secret_new', 'Stored encrypted and never shown again.')}</FieldHelperText>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.scopes}>{t('sso.field.scopes', 'Scopes')}</FieldLabel>
            <Input id={ids.scopes} autoComplete="off" spellCheck={false} value={scopes} onChange={(e) => setScopes(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.domains}>{t('sso.field.domains', 'Allowed e-mail domains')}</FieldLabel>
            <Textarea id={ids.domains} rows={3} spellCheck={false} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com" />
            <FieldHelperText>{t('sso.field.domains_hint', 'One per line or separated by commas.')}</FieldHelperText>
          </Field>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-g13 border-t border-border pt-g13">
          <legend className="text-sm font-semibold">{t('sso.field.jit', 'Create accounts automatically on first sign-in')}</legend>
          <Checkbox checked={jit} onCheckedChange={(details) => setJit(details.checked === true)}><CheckboxControl /><CheckboxLabel>{t('sso.field.jit', 'Create accounts automatically on first sign-in')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
          <Text size="xs" className="text-muted-foreground">{t('sso.field.jit_hint', 'Limited to the allowed domains.')}</Text>
          <Field>
            <FieldLabel htmlFor={ids.role}>{t('sso.field.default_role', 'Default role for new accounts')}</FieldLabel>
            <NativeSelect id={ids.role} value={defaultRole} onChange={(e) => setDefaultRole(e.target.value as Role)}>
              {ROLES.filter((role) => role !== 'admin').map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </NativeSelect>
          </Field>
          {pickDepartments(defaultDepartments, setDefaultDepartments, t('sso.field.default_departments', 'Default departments for new accounts'))}
          <Field>
            <FieldLabel htmlFor={ids.claim}>{t('sso.field.role_claim', 'Group or role claim')}</FieldLabel>
            <Input id={ids.claim} autoComplete="off" spellCheck={false} value={roleClaim} onChange={(e) => setRoleClaim(e.target.value)} placeholder="groups" />
            <FieldHelperText>{t('sso.field.role_claim_hint', 'Name of the ID-token claim that lists groups or roles.')}</FieldHelperText>
          </Field>
          <div className="flex flex-col gap-g8">
            <div className="flex items-center justify-between gap-g8">
              <Text size="sm" weight="medium">{t('sso.mapping.title', 'Claim to role mapping')}</Text>
              <Button type="button" size="sm" variant="outline" onClick={() => setMapping((rows) => [...rows, { value: '', role: 'viewer', departmentIds: [] }])}><Plus aria-hidden="true" />{t('sso.mapping.add', 'Add mapping')}</Button>
            </div>
            {mapping.length === 0 && <Text size="xs" className="text-muted-foreground">{t('sso.mapping.none', 'No mappings. New accounts get the default role.')}</Text>}
            {mapping.map((entry, index) => (
              <Card key={index} className="flex flex-col gap-g8 p-g13">
                <div className="grid gap-g8 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
                  <Field>
                    <FieldLabel htmlFor={`${ids.claim}-v${index}`}>{t('sso.mapping.value', 'Claim value')}</FieldLabel>
                    <Input id={`${ids.claim}-v${index}`} autoComplete="off" spellCheck={false} value={entry.value} onChange={(e) => setMapping((rows) => rows.map((row, i) => (i === index ? { ...row, value: e.target.value } : row)))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${ids.claim}-r${index}`}>{t('tb.col_role', 'Role')}</FieldLabel>
                    <NativeSelect id={`${ids.claim}-r${index}`} value={entry.role} onChange={(e) => setMapping((rows) => rows.map((row, i) => (i === index ? { ...row, role: e.target.value as Role } : row)))}>
                      {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    </NativeSelect>
                  </Field>
                  <Button type="button" variant="outline" size="icon-md" aria-label={t('sso.mapping.remove', 'Remove mapping {n}', { n: String(index + 1) })} onClick={() => setMapping((rows) => rows.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></Button>
                </div>
                {entry.role !== 'admin' && pickDepartments(entry.departmentIds, (next) => setMapping((rows) => rows.map((row, i) => (i === index ? { ...row, departmentIds: next } : row))), t('tb.col_departments', 'Departments'))}
              </Card>
            ))}
            {mapping.length > 0 && <Text size="xs" className="text-muted-foreground">{t('sso.mapping.hint', 'When several mappings match, the highest role wins.')}</Text>}
          </div>
          <Checkbox checked={syncRoles} onCheckedChange={(details) => setSyncRoles(details.checked === true)}><CheckboxControl /><CheckboxLabel>{t('sso.field.sync_roles', 'Update role and departments at every sign-in from the mapping')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-g13 border-t border-border pt-g13">
          <legend className="text-sm font-semibold">{t('sso.field.require', 'Require single sign-on')}</legend>
          <Checkbox checked={requireSso} onCheckedChange={(details) => setRequireSso(details.checked === true)}><CheckboxControl /><CheckboxLabel>{t('sso.field.require', 'Require single sign-on')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
          <Text size="xs" className="text-muted-foreground">{t('sso.field.require_hint', 'Members can no longer sign in with a password.')}</Text>
          <Fieldset>
            <FieldsetLegend className="pb-0 text-sm font-medium">{t('sso.field.break_glass', 'Break-glass administrators')}</FieldsetLegend>
            <Text size="xs" className="mb-g5 text-muted-foreground">{t('sso.field.break_glass_hint', 'Administrators who can still sign in with a password.')}</Text>
            <Card className="grid max-h-g233 gap-g3 overflow-y-auto p-g8 sm:grid-cols-2">
              {admins.map((admin) => (
                <Checkbox key={admin.userId} checked={breakGlass.includes(admin.userId)} onCheckedChange={(details) => setBreakGlass((cur) => (details.checked === true ? [...new Set([...cur, admin.userId])].slice(0, 5) : cur.filter((id) => id !== admin.userId)))}>
                  <CheckboxControl /><CheckboxLabel>{admin.name || admin.email} <span className="text-muted-foreground">{admin.email}</span></CheckboxLabel><CheckboxHiddenInput />
                </Checkbox>
              ))}
            </Card>
          </Fieldset>
        </fieldset>

        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex flex-wrap justify-end gap-g8">
          {current && <Button type="button" variant="outline" onClick={() => void test()}>{t('sso.test', 'Test connection')}</Button>}
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !valid}>{busy ? t('sso.saving', 'Saving…') : t('sso.save', 'Save settings')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};
