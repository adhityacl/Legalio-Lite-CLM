import React, { Suspense, lazy, useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Copy, KeyRound, History, Layers, Loader2, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Trash2, UserMinus, UserCheck, UserX, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions, type TenantRole } from '../../lib/permissions';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { ModalFrame } from '../ui/modal-frame';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { OrgApiError, orgApi, orgPath } from './orgApi';

import { fieldControlClass, Input } from '@legalio/ui-components/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Card, CardHeader } from '@legalio/ui-components/card';
import { DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
const LazyActivityLogsView = lazy(() => import('../ActivityLogsView').then((m) => ({ default: m.ActivityLogsView })));

interface Member { id: string; userId: string; name: string; email: string; tenantRole: TenantRole; status: 'active' | 'suspended'; departmentIds: string[]; createdAt: string }
interface Department { id: string; organizationId: string; name: string; createdAt: string }
interface Invitation { id: string; organizationId: string; email: string; tenantRole: TenantRole; departmentIds: string[]; status: 'pending' | 'accepted' | 'canceled' | 'expired'; expiresAt: string; createdAt: string }
interface AuditEvent { id: string; createdAt: string; actorId: string; actorName: string; action: string; targetType: string; targetId: string; outcome: string; changedFields: string[]; accessMode: string }

type Filter = 'active' | 'suspended' | 'pending';
const PAGE_SIZE = 25;
const RANK: Record<TenantRole, number> = { admin: 4, manager: 3, editor: 2, viewer: 1 };

const labelClass = 'mb-1.5 block text-sm font-medium text-foreground ';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Department checkboxes limited to the departments this context can see. */
const DepartmentPicker: React.FC<{ departments: Department[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; legend: string; 'aria-describedby'?: string }> = ({ departments, value, onChange, disabled, legend, 'aria-describedby': ariaDescribedby }) => (
  <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled} aria-describedby={ariaDescribedby}>
    <legend className={labelClass}>{legend}</legend>
    <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2">
      {departments.map((d) => (
        <Checkbox checked={value.includes(d.id)} onCheckedChange={(details) => onChange(details.checked === true ? [...value, d.id] : value.filter((id) => id !== d.id))}><CheckboxControl /><CheckboxLabel>{d.name}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
      ))}
      {departments.length === 0 && <p className="p-2 text-sm text-muted-foreground">—</p>}
    </div>
  </fieldset>
);

/**
 * Members & Access tab (PRD §6.4): active/suspended memberships and pending
 * invitations of the selected organization, with Invite, Departments and
 * History dialogs. Global-account controls (ban, delete account, password,
 * email, platform role) never appear here; the server rechecks every action.
 */
export const MembersAccessTab: React.FC<{ organizationId: string; intent?: string | null }> = ({ organizationId, intent }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const confirm = useConfirm();
  const showAlert = useAlertToast();
  const toast = {
    success: (title: string) => showAlert({ title, variant: 'success' }),
    error: (title: string) => showAlert({ title, variant: 'destructive' }),
  };
  const caps = usePermissions();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>(intent === 'pending-invitations' ? 'pending' : 'active');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<null | { kind: 'invite'; codeOnly?: boolean } | { kind: 'departments' } | { kind: 'history' } | { kind: 'edit'; member: Member } | { kind: 'link'; url: string; code?: string; expiresAt?: string }>(
    intent === 'departments' ? { kind: 'departments' } : intent === 'history' ? { kind: 'history' } : null,
  );
  const searchId = useId();

  useEffect(() => {
    const handle = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  const can = caps.hasPermission;
  const isPlatform = caps.accessMode === 'platform';
  const myRole = caps.tenantRole;
  const myDepartments = caps.departmentIds;
  const roleLabel = (role: string) => ({
    admin: t('tb.role_admin', 'Admin'), manager: t('tb.role_manager', 'Manager'), editor: t('tb.role_editor', 'Editor'), viewer: t('tb.role_viewer', 'Viewer'),
  } as Record<string, string>)[role] || role;

  const key = (...parts: unknown[]) => ['org-access', identity?.id, organizationId, ...parts];
  const departmentsQuery = useQuery<{ departments: Department[]; total: number }>({
    queryKey: key('departments'),
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/departments?limit=100'), { signal }),
    enabled: can('department.view'),
  });
  const departments = departmentsQuery.data?.departments || [];
  const departmentName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const names = (ids: string[]) => ids.map((id) => departmentName.get(id) || t('tb.other_department', 'Other department')).join(', ') || '—';

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), ...(debounced ? { search: debounced } : {}) });
  const membersQuery = useQuery<{ members: Member[]; total: number }>({
    queryKey: key('members', filter, debounced, page),
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, `/members?status=${filter}&${query}`), { signal }),
    enabled: filter !== 'pending',
  });
  const invitationsQuery = useQuery<{ invitations: Invitation[]; total: number }>({
    queryKey: key('invitations', debounced, page),
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, `/invitations?status=pending&${query}`), { signal }),
    enabled: filter === 'pending' && can('tenant.invitation.read'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key() });

  /** Client mirror of §4.3 for showing actions; the server is authoritative. */
  const canManage = (m: Member) => {
    if (m.userId === identity?.id) return false;
    if (isPlatform) return true;
    if (myRole === 'admin') return m.tenantRole !== 'admin';
    if (myRole === 'manager') return RANK[m.tenantRole] < RANK.manager && m.departmentIds.length > 0 && m.departmentIds.every((d) => myDepartments.includes(d));
    return false;
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const setStatus = async (m: Member, status: 'active' | 'suspended') => {
    if (status === 'suspended' && !(await confirm({
      title: t('tb.suspend_membership', 'Suspend membership'),
      description: t('tb.suspend_confirm', '{name} loses access to this organization until reactivated. Their account and other organizations are not affected.', { name: m.name || m.email }),
      confirmLabel: t('tb.suspend_membership', 'Suspend membership'), tone: 'danger',
    }))) return;
    await run(() => orgApi(orgPath(organizationId, `/members/${m.id}`), { method: 'PATCH', body: { status } }),
      status === 'suspended' ? t('tb.membership_suspended', 'Membership suspended.') : t('tb.membership_reactivated', 'Membership reactivated.'));
  };

  const remove = async (m: Member) => {
    if (!(await confirm({
      title: t('tb.remove_membership', 'Remove membership'),
      description: t('tb.remove_confirm', 'Remove {name} from this organization? Their account, credentials and other organizations stay unchanged.', { name: m.name || m.email }),
      confirmLabel: t('tb.remove_membership', 'Remove membership'), tone: 'danger',
    }))) return;
    await run(() => orgApi(orgPath(organizationId, `/members/${m.id}`), { method: 'DELETE' }), t('tb.membership_removed', 'Membership removed.'));
  };

  const resend = async (inv: Invitation) => {
    try {
      const result = await orgApi<{ inviteUrl: string; delivery: 'sent' | 'not_sent'; inviteCode?: string; expiresAt?: string }>(orgPath(organizationId, `/invitations/${inv.id}/resend`), { method: 'POST' });
      await refresh();
      if (result.delivery === 'sent') toast.success(t('tb.invitation_resent', 'Invitation sent again.'));
      else setDialog({ kind: 'link', url: result.inviteUrl, code: result.inviteCode, expiresAt: result.expiresAt });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const cancel = async (inv: Invitation) => {
    if (!(await confirm({ description: t('tb.cancel_invitation_confirm', 'Cancel the invitation for {email}?', { email: inv.email }), confirmLabel: t('tb.cancel_invitation', 'Cancel invitation'), tone: 'danger' }))) return;
    await run(() => orgApi(orgPath(organizationId, `/invitations/${inv.id}`), { method: 'DELETE' }), t('tb.invitation_canceled', 'Invitation canceled.'));
  };

  const loading = filter === 'pending' ? invitationsQuery.isLoading : membersQuery.isLoading;
  const failed = filter === 'pending' ? invitationsQuery.isError : membersQuery.isError;
  const total = filter === 'pending' ? invitationsQuery.data?.total || 0 : membersQuery.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="mobile-controls-bar flex flex-col items-stretch justify-between gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <Card
            role="group"
            aria-label={t('tb.member_status_filter', 'Member status')}
            className="flex h-10 shrink-0 items-center p-0.75"
          >
            {([['active', t('tb.filter_active', 'Active')], ['suspended', t('tb.filter_suspended', 'Suspended')], ...(can('tenant.invitation.read') ? [['pending', t('tb.filter_pending', 'Pending')]] : [])] as Array<[Filter, string]>).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}
                className={` cursor-pointer ${filter === value ? '' : ' '}`}>
                {label}
              </button>
            ))}
          </Card>
          <InputGroup className="relative min-w-55 max-w-md flex-1">
            <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              id={searchId}
              type="search"
              aria-label={t('tb.search_members', 'Search members')}
              placeholder={t('tb.search_members', 'Search members...')}
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {can('tenant.audit.read') && <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'history' })}><History className="h-4 w-4" aria-hidden="true" />{t('tb.history', 'History')}</Button>}
          {can('department.view') && <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'departments' })}><Layers className="h-4 w-4" aria-hidden="true" />{t('tb.departments', 'Departments')}</Button>}
          {(myRole === 'admin' || isPlatform) && <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'invite', codeOnly: true })}><KeyRound className="h-4 w-4" aria-hidden="true" />{t('onboarding.generate_code', 'Generate invite code')}</Button>}
          {can('tenant.member.invite') && <Button type="button" onClick={() => setDialog({ kind: 'invite' })}><Mail className="h-4 w-4" aria-hidden="true" />{t('tb.invite_member', 'Invite member')}</Button>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {failed ? (
          <div role="alert" className="flex flex-col items-start gap-3 p-5 text-sm text-status-danger">
            {t('tb.members_load_error', 'Members could not be loaded.')}
            <Button type="button" variant="outline" size="sm" onClick={() => refresh()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('tb.retry', 'Retry')}</Button>
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : filter === 'pending' ? (
          <TableScrollArea>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('tb.col_email', 'Email')}</TableHead><TableHead>{t('tb.col_role', 'Role')}</TableHead>
                <TableHead>{t('tb.col_departments', 'Departments')}</TableHead><TableHead>{t('tb.col_expires', 'Expires')}</TableHead>
                <TableHead className="text-right">{t('tb.col_action', 'Action')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(invitationsQuery.data?.invitations || []).map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email || t('onboarding.invite_code', 'Invite code')}</TableCell>
                    <TableCell>{roleLabel(inv.tenantRole)}</TableCell>
                    <TableCell>{names(inv.departmentIds)}</TableCell>
                    <TableCell>{new Date(inv.expiresAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {can('tenant.invitation.resend') && <Button type="button" variant="ghost" size="sm" onClick={() => resend(inv)}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('tb.resend', 'Resend')}</Button>}
                        {can('tenant.invitation.cancel') && <Button type="button" variant="ghost" size="sm" onClick={() => cancel(inv)}><X className="h-4 w-4" aria-hidden="true" />{t('tb.cancel_invitation', 'Cancel invitation')}</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(invitationsQuery.data?.invitations || []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('tb.no_invitations', 'No pending invitations.')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableScrollArea>
        ) : (
          <TableScrollArea>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('tb.col_name', 'Name')}</TableHead><TableHead>{t('tb.col_email', 'Email')}</TableHead><TableHead>{t('tb.col_role', 'Role')}</TableHead>
                <TableHead>{t('tb.col_departments', 'Departments')}</TableHead><TableHead>{t('tb.col_status', 'Membership status')}</TableHead>
                <TableHead className="text-right">{t('tb.col_action', 'Action')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(membersQuery.data?.members || []).map((m) => {
                  const manage = canManage(m);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name || '—'}{m.userId === identity?.id && <span className="ml-2 text-xs text-muted-foreground">({t('tb.you', 'you')})</span>}</TableCell>
                      <TableCell>{m.email}</TableCell>
                      <TableCell>{roleLabel(m.tenantRole)}</TableCell>
                      <TableCell>{m.tenantRole === 'admin' ? t('tb.all_departments', 'All departments') : names(m.departmentIds)}</TableCell>
                      <TableCell><Badge tone={m.status === 'active' ? 'success' : 'warning'}>{m.status === 'active' ? t('tb.status_active', 'Active') : t('tb.status_suspended', 'Suspended')}</Badge></TableCell>
                      <TableCell className="text-right">
                        {manage ? (
                          <div className="flex justify-end gap-1">
                            {(can('tenant.member.role.update') || can('tenant.member.departments.update')) && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ kind: 'edit', member: m })} aria-label={t('tb.edit_access_for', 'Edit access for {name}', { name: m.name || m.email })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                            )}
                            {can('tenant.member.status.update') && (m.status === 'active'
                              ? <Button type="button" variant="ghost" size="sm" onClick={() => setStatus(m, 'suspended')} aria-label={t('tb.suspend_for', 'Suspend membership of {name}', { name: m.name || m.email })}><UserX className="h-4 w-4" aria-hidden="true" /></Button>
                              : <Button type="button" variant="ghost" size="sm" onClick={() => setStatus(m, 'active')} aria-label={t('tb.reactivate_for', 'Reactivate membership of {name}', { name: m.name || m.email })}><UserCheck className="h-4 w-4" aria-hidden="true" /></Button>)}
                            {can('tenant.member.remove') && <Button type="button" variant="ghost" size="sm" onClick={() => remove(m)} aria-label={t('tb.remove_for', 'Remove membership of {name}', { name: m.name || m.email })}><UserMinus className="h-4 w-4" aria-hidden="true" /></Button>}
                          </div>
                        ) : <MoreHorizontal className="ml-auto h-4 w-4 text-primary-foreground" aria-hidden="true" />}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(membersQuery.data?.members || []).length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('tb.no_members', 'No members match this view.')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableScrollArea>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">{t('tb.page_of', 'Page {page} of {pages}', { page: page + 1, pages })}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('tb.previous', 'Previous')}</Button>
              <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t('tb.next', 'Next')}</Button>
            </div>
          </div>
        )}
      </Card>

      {dialog?.kind === 'invite' && (
        <InviteDialog codeOnly={dialog.codeOnly} organizationId={organizationId} departments={departments} assignable={caps.assignableTenantRoles} roleLabel={roleLabel}
          onClose={() => { setDialog(null); void refresh(); }}
          onCreated={(result) => { void refresh(); if (result.delivery === 'sent') { toast.success(t('tb.invitation_sent', 'Invitation sent.')); setDialog(null); } else setDialog({ kind: 'link', url: result.inviteUrl, code: result.inviteCode, expiresAt: result.expiresAt }); }} />
      )}
      {dialog?.kind === 'link' && <InviteLinkDialog url={dialog.url} code={dialog.code} expiresAt={dialog.expiresAt} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && (
        <EditMemberDialog organizationId={organizationId} member={dialog.member} departments={departments} roleLabel={roleLabel}
          assignable={caps.assignableTenantRoles} canDepartments={can('tenant.member.departments.update')} canRole={can('tenant.member.role.update')}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void refresh(); toast.success(t('tb.access_updated', 'Access updated.')); }} />
      )}
      {dialog?.kind === 'departments' && <DepartmentsDialog organizationId={organizationId} departments={departments} loading={departmentsQuery.isLoading} onChanged={() => refresh()} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'history' && <HistoryDialog organizationId={organizationId} onClose={() => setDialog(null)} />}
    </div>
  );
};

/* ------------------------------------------------------------------ */

const DialogHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => {
  const { t } = useLanguage();
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border pb-4">
      <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
      <Button type="button" variant="ghost" size="icon-md" onClick={onClose} aria-label={t('common.close', 'Close')}><X className="h-4 w-4" aria-hidden="true" /></Button>
    </CardHeader>
  );
};

const InviteDialog: React.FC<{
  organizationId: string; codeOnly?: boolean; departments: Department[]; assignable: TenantRole[]; roleLabel: (r: string) => string;
  onClose: () => void; onCreated: (result: { inviteUrl: string; delivery: 'sent' | 'not_sent'; inviteCode?: string; expiresAt?: string }) => void;
}> = ({ organizationId, codeOnly = false, departments, assignable, roleLabel, onClose, onCreated }) => {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRole>(assignable.includes('viewer') ? 'viewer' : assignable[0]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { email: useId(), role: useId() };
  const emailValid = codeOnly || /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email.trim());
  const deptValid = role === 'admin' ? true : departmentIds.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!emailValid || !deptValid) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await orgApi(orgPath(organizationId, codeOnly ? '/invite-codes' : '/invitations'), { method: 'POST', body: { ...(!codeOnly ? { email: email.trim() } : {}), tenantRole: role, departmentIds: role === 'admin' ? [] : departmentIds } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="max-w-xl">
      <DialogHeader title={codeOnly ? t('onboarding.generate_code', 'Generate invite code') : t('tb.invite_member', 'Invite member')} onClose={onClose} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 overflow-y-auto p-5">
        {!codeOnly && <Field>
          <FieldLabel htmlFor={ids.email} className={labelClass}>{t('tb.col_email', 'Email')}</FieldLabel>
          <Input id={ids.email} type="email" autoComplete="off" value={email} aria-invalid={email.length > 0 && !emailValid} aria-describedby={email.length > 0 && !emailValid ? `${ids.email}-error` : undefined} onChange={(e) => setEmail(e.target.value)} />
          {email.length > 0 && !emailValid && <p id={`${ids.email}-error`} className="mt-1.5 text-xs text-status-danger">{t('tb.invalid_email', 'Enter a valid email address.')}</p>}
        </Field>}
        <Field>
          <FieldLabel htmlFor={ids.role} className={labelClass}>{t('tb.col_role', 'Role')}</FieldLabel>
          <NativeSelect id={ids.role} value={role} onChange={(e) => setRole(e.target.value as TenantRole)}>
            {assignable.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </NativeSelect>
        </Field>
        {role !== 'admin' && (
          <div>
            <DepartmentPicker departments={departments} value={departmentIds} onChange={setDepartmentIds} legend={t('tb.col_departments', 'Departments')} aria-describedby={!deptValid ? `invite-dept-error` : undefined} />
            {!deptValid && <p id="invite-dept-error" className="mt-1.5 text-xs text-muted-foreground">{t('tb.department_required', 'Choose at least one department.')}</p>}
          </div>
        )}
        {error && <p role="alert" className="flex items-center gap-2 text-sm text-status-danger"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('tb.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !emailValid || !deptValid}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}{codeOnly ? t('onboarding.generate_code', 'Generate invite code') : t('tb.send_invitation', 'Send invitation')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const InviteLinkDialog: React.FC<{ url: string; code?: string; expiresAt?: string; onClose: () => void }> = ({ url, code, expiresAt, onClose }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <ModalFrame onClose={onClose} className="max-w-xl">
      <DialogHeader title={code ? t('onboarding.code_created', 'Invite code created') : t('tb.invitation_not_sent_title', 'Invitation created; email not sent')} onClose={onClose} />
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-foreground">{code ? t('onboarding.code_hint', 'Share this code with an approved account. It expires in 24 hours and can be used once.') : t('tb.invitation_not_sent', 'The invitation is saved, but no email was delivered. Share this link with the invited person yourself.')}</p>
        <label htmlFor={id} className={labelClass}>{code ? t('onboarding.invite_code', 'Invite code') : t('tb.invitation_link', 'Invitation link')}</label>
        <div className="flex items-center rounded-xl border border-border bg-card pr-1 focus-within:border-primary">
          <input id={id} readOnly className="min-h-10 min-w-0 flex-1 rounded-md bg-transparent px-3 py-2.5 font-mono text-xs text-foreground focus:outline-none" value={code || url} onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="ghost" className="shrink-0" aria-live="polite" onClick={async () => { await navigator.clipboard?.writeText(code || url).catch(() => {}); setCopied(true); }}>
            <Copy className="h-4 w-4" aria-hidden="true" />{copied ? t('tb.copied', 'Copied') : code ? t('onboarding.copy_code', 'Copy code') : t('tb.copy_link', 'Copy link')}
          </Button>
        </div>
        {expiresAt && <p className="text-sm text-muted-foreground">{t('tb.col_expires', 'Expires')}: {new Date(expiresAt).toLocaleString()}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>{t('tb.done', 'Done')}</Button>
        </div>
      </div>
    </ModalFrame>
  );
};

const EditMemberDialog: React.FC<{
  organizationId: string; member: Member; departments: Department[]; roleLabel: (r: string) => string; assignable: TenantRole[];
  canDepartments: boolean; canRole: boolean; onClose: () => void; onSaved: () => void;
}> = ({ organizationId, member, departments, roleLabel, assignable, canDepartments, canRole, onClose, onSaved }) => {
  const { t } = useLanguage();
  const [role, setRole] = useState<TenantRole>(member.tenantRole);
  const [departmentIds, setDepartmentIds] = useState<string[]>(member.departmentIds);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roleId = useId();
  const roles = Array.from(new Set([member.tenantRole, ...assignable]));
  const deptChanged = JSON.stringify([...departmentIds].sort()) !== JSON.stringify([...member.departmentIds].sort());
  const roleChanged = role !== member.tenantRole;
  const needsDepartments = role !== 'admin' && (roleChanged || deptChanged) && departmentIds.length === 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    if (roleChanged) body.tenantRole = role;
    if (canDepartments && role !== 'admin' && (deptChanged || (roleChanged && member.tenantRole === 'admin'))) body.departmentIds = departmentIds;
    if (!Object.keys(body).length) return onClose();
    setBusy(true);
    setError(null);
    try {
      await orgApi(orgPath(organizationId, `/members/${member.id}`), { method: 'PATCH', body });
      onSaved();
    } catch (err) {
      setError(err instanceof OrgApiError && err.code === 'LAST_ADMIN_REQUIRED' ? t('tb.last_admin', 'Every organization needs at least one active administrator.') : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="max-w-xl">
      <DialogHeader title={t('tb.edit_access_for', 'Edit access for {name}', { name: member.name || member.email })} onClose={onClose} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 overflow-y-auto p-5">
        <Field>
          <FieldLabel htmlFor={roleId} className={labelClass}>{t('tb.col_role', 'Role')}</FieldLabel>
          <NativeSelect id={roleId} value={role} disabled={!canRole} onChange={(e) => setRole(e.target.value as TenantRole)}>
            {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </NativeSelect>
          {role === 'admin' && member.tenantRole !== 'admin' && <p className="mt-1.5 text-xs text-muted-foreground">{t('tb.admin_drops_departments', 'Administrators cover the whole organization; department assignments are removed.')}</p>}
        </Field>
        {role !== 'admin' && (
          <div>
            <DepartmentPicker departments={departments} value={departmentIds} onChange={setDepartmentIds} disabled={!canDepartments} legend={t('tb.col_departments', 'Departments')} aria-describedby={needsDepartments ? `edit-dept-error` : undefined} />
            {needsDepartments && <p id="edit-dept-error" className="mt-1.5 text-xs text-status-danger">{t('tb.department_required', 'Choose at least one department.')}</p>}
          </div>
        )}
        {error && <p role="alert" className="flex items-center gap-2 text-sm text-status-danger"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('tb.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || needsDepartments}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{t('tb.save', 'Save')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const DepartmentsDialog: React.FC<{ organizationId: string; departments: Department[]; loading: boolean; onChanged: () => unknown; onClose: () => void }> = ({ organizationId, departments, loading, onChanged, onClose }) => {
  const { t } = useLanguage();
  const confirm = useConfirm();
  const { hasPermission } = usePermissions();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newId = useId();
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof OrgApiError && err.code === 'DEPARTMENT_IN_USE'
        ? t('tb.department_in_use', 'This department is still used by members, invitations or records.')
        : err instanceof OrgApiError && err.code === 'DEPARTMENT_EXISTS' ? t('tb.department_exists', 'A department with this name already exists.') : errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalFrame onClose={onClose} className="max-w-xl">
      <DialogHeader title={t('tb.departments', 'Departments')} onClose={onClose} />
      <div className="flex flex-col gap-4 overflow-y-auto p-5">
        {!hasPermission('department.create') && <p className="text-sm text-muted-foreground">{t('tb.departments_readonly', 'You can see your assigned departments. Only administrators can change them.')}</p>}
        {hasPermission('department.create') && (
          <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && (await act(() => orgApi(orgPath(organizationId, '/departments'), { method: 'POST', body: { name: name.trim() } })))) setName(''); }}>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={newId} className={labelClass}>{t('tb.new_department', 'New department')}</FieldLabel>
              <Input id={newId} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || !name.trim()}><Plus className="h-4 w-4" aria-hidden="true" />{t('tb.add', 'Add')}</Button>
          </form>
        )}
        {error && <p role="alert" className="flex items-center gap-2 text-sm text-status-danger"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</p>}
        {loading ? <Skeleton className="h-24 w-full" /> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {departments.map((d) => (
              <li key={d.id} className="flex min-h-12 items-center justify-between gap-2 px-3 py-1.5">
                {editing?.id === d.id ? (
                  <form className="flex flex-1 items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act(() => orgApi(orgPath(organizationId, `/departments/${d.id}`), { method: 'PATCH', body: { name: editing.name.trim() } }))) setEditing(null); }}>
                    <label className="sr-only" htmlFor={`rename-${d.id}`}>{t('tb.department_name', 'Department name')}</label>
                    <Input id={`rename-${d.id}`} autoFocus maxLength={100} value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} />
                    <Button type="submit" size="sm" disabled={busy || !editing.name.trim()}>{t('tb.save', 'Save')}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('tb.cancel', 'Cancel')}</Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm text-foreground">{d.name}</span>
                    <span className="flex gap-1">
                      {hasPermission('department.edit') && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={t('tb.rename_department', 'Rename {name}', { name: d.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>}
                      {hasPermission('department.delete') && (
                        <Button type="button" variant="ghost" size="sm" aria-label={t('tb.delete_department', 'Delete {name}', { name: d.name })}
                          onClick={async () => { if (await confirm({ description: t('tb.delete_department_confirm', 'Delete the department {name}?', { name: d.name }), tone: 'danger', confirmLabel: t('tb.delete', 'Delete') })) await act(() => orgApi(orgPath(organizationId, `/departments/${d.id}`), { method: 'DELETE' })); }}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
            {departments.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">{t('tb.no_departments', 'No departments yet.')}</li>}
          </ul>
        )}
      </div>
    </ModalFrame>
  );
};

const HistoryDialog: React.FC<{ organizationId: string; onClose: () => void }> = ({ organizationId, onClose }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const [dataset, setDataset] = useState<'admin' | 'activity'>('admin');
  const [page, setPage] = useState(0);
  const audit = useQuery<{ events: AuditEvent[]; total: number }>({
    queryKey: ['org-audit', identity?.id, organizationId, page],
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, `/audit?limit=25&offset=${page * 25}`), { signal }),
    enabled: dataset === 'admin',
  });
  const pages = Math.max(1, Math.ceil((audit.data?.total || 0) / 25));
  return (
    <ModalFrame onClose={onClose} className="max-w-5xl">
      <DialogHeader title={t('tb.history', 'History')} onClose={onClose} />
      <div className="overflow-y-auto p-5">
        <Tabs value={dataset} onValueChange={(v) => setDataset(v as 'admin' | 'activity')}>
          <TabsList aria-label={t('tb.history', 'History')}>
            <TabsTrigger value="admin">{t('tb.history_admin', 'Administrative changes')}</TabsTrigger>
            <TabsTrigger value="activity">{t('tb.history_activity', 'Operational activity')}</TabsTrigger>
          </TabsList>
          <TabsContent value="admin" className="pt-3">
            {audit.isError ? (
              <Alert status="error" role="alert"><AlertContent>{t('tb.history_load_error', 'History could not be loaded.')}</AlertContent></Alert>
            ) : audit.isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('tb.col_when', 'When')}</TableHead><TableHead>{t('tb.col_actor', 'By')}</TableHead>
                    <TableHead>{t('tb.col_action', 'Action')}</TableHead><TableHead>{t('tb.col_changes', 'Changed fields')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(audit.data?.events || []).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{e.actorName || '—'}{e.accessMode === 'platform' && <span className="ml-1 text-xs text-muted-foreground">({t('tb.platform_admin_short', 'platform')})</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{e.action}</TableCell>
                        <TableCell className="text-xs">{e.changedFields.join(', ') || '—'}</TableCell>
                      </TableRow>
                    ))}
                    {(audit.data?.events || []).length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">{t('tb.no_history', 'No administrative changes yet.')}</TableCell></TableRow>}
                  </TableBody>
                </Table>
                {pages > 1 && (
                  <div className="flex justify-end gap-2 pt-3">
                    <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('tb.previous', 'Previous')}</Button>
                    <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t('tb.next', 'Next')}</Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
          <TabsContent value="activity" className="pt-3">
            <Suspense fallback={<Skeleton className="h-32 w-full" />}><LazyActivityLogsView /></Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </ModalFrame>
  );
};
