import React, { Suspense, lazy, useId, useMemo, useState } from 'react';
import { useRowsPerPage } from '../../lib/tablePreferences';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Copy, KeyRound, History, Layers, Loader2, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, UserMinus, UserCheck, UserX, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions, type TenantRole } from '../../lib/permissions';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { ModalFrame } from '../ui/modal-frame';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { TableEmptyState } from '../ui/table-empty-state';
import { TablePagination } from '../ui/TablePagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { OrgApiError, orgApi, orgPath } from './orgApi';

import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Card, CardHeader } from '@legalio/ui-components/card';
import { DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { Text } from '@legalio/ui-components/text';
import { Clipboard, ClipboardControl, ClipboardInput, ClipboardLabel, ClipboardTrigger } from '@legalio/ui-components/clipboard';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Spinner } from '@legalio/ui-components/spinner';
import { List, ListItem } from '@legalio/ui-components/list';
const LazyActivityLogsView = lazy(() => import('../ActivityLogsView').then((m) => ({ default: m.ActivityLogsView })));

interface Member { id: string; userId: string; name: string; email: string; tenantRole: TenantRole; status: 'active' | 'suspended'; departmentIds: string[]; createdAt: string }
interface Department { id: string; organizationId: string; name: string; createdAt: string }
interface Invitation { id: string; organizationId: string; email: string; tenantRole: TenantRole; departmentIds: string[]; status: 'pending' | 'accepted' | 'canceled' | 'expired'; expiresAt: string; createdAt: string }
interface AuditEvent { id: string; createdAt: string; actorId: string; actorName: string; action: string; targetType: string; targetId: string; outcome: string; changedFields: string[]; accessMode: string }

type Filter = 'active' | 'suspended' | 'pending';
const PAGE_SIZES = [5, 10, 20, 50];
const RANK: Record<TenantRole, number> = { admin: 4, manager: 3, editor: 2, viewer: 1 };


const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Department checkboxes limited to the departments this context can see. */
const DepartmentPicker: React.FC<{ departments: Department[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; legend: string; 'aria-describedby'?: string }> = ({ departments, value, onChange, disabled, legend, 'aria-describedby': ariaDescribedby }) => (
  <Fieldset disabled={disabled} aria-describedby={ariaDescribedby}>
    <FieldsetLegend className="pb-0 text-sm font-medium">{legend}</FieldsetLegend>
    <Card className="grid max-h-g233 gap-g3 overflow-y-auto p-g8 sm:grid-cols-2">
      {departments.map((d) => (
        <Checkbox checked={value.includes(d.id)} onCheckedChange={(details) => onChange(details.checked === true ? [...value, d.id] : value.filter((id) => id !== d.id))}><CheckboxControl /><CheckboxLabel>{d.name}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
      ))}
      {departments.length === 0 && <Text size="sm" tone="muted" className="p-g8">—</Text>}
    </Card>
  </Fieldset>
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useRowsPerPage('members', PAGE_SIZES[0]);
  const [dialog, setDialog] = useState<null | { kind: 'invite'; codeOnly?: boolean } | { kind: 'departments' } | { kind: 'history' } | { kind: 'edit'; member: Member } | { kind: 'link'; url: string; code?: string; expiresAt?: string }>(
    intent === 'departments' ? { kind: 'departments' } : intent === 'history' ? { kind: 'history' } : null,
  );
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

  const query = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
  const membersQuery = useQuery<{ members: Member[]; total: number }>({
    queryKey: key('members', filter, page, pageSize),
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, `/members?status=${filter}&${query}`), { signal }),
    enabled: filter !== 'pending',
  });
  const invitationsQuery = useQuery<{ invitations: Invitation[]; total: number }>({
    queryKey: key('invitations', page, pageSize),
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
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex min-w-0 flex-col gap-g13">
      <Card className="flex flex-col items-stretch justify-between gap-g13 p-g13 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-g13 sm:flex-row sm:flex-wrap sm:items-center">
          <SegmentGroup aria-label={t('tb.member_status_filter', 'Member status')} value={filter}
            onValueChange={details => { if (details.value) { setFilter(details.value as Filter); setPage(0); } }} className="shrink-0">
            <SegmentGroupIndicator />
            <SegmentGroupItems items={([['active', t('tb.filter_active', 'Active')], ['suspended', t('tb.filter_suspended', 'Suspended')], ...(can('tenant.invitation.read') ? [['pending', t('tb.filter_pending', 'Pending')]] : [])] as Array<[Filter, string]>).map(([value, label]) => ({ value, label }))} />
          </SegmentGroup>
        </div>
        <div className="flex shrink-0 flex-wrap gap-g8">
          {can('tenant.audit.read') && <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'history' })}><History className="h-g16 w-g16" aria-hidden="true" />{t('tb.history', 'History')}</Button>}
          {can('department.view') && <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'departments' })}><Layers className="h-g16 w-g16" aria-hidden="true" />{t('tb.departments', 'Departments')}</Button>}
          {(myRole === 'admin' || isPlatform) && <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'invite', codeOnly: true })}><KeyRound className="h-g16 w-g16" aria-hidden="true" />{t('onboarding.generate_code', 'Generate invite code')}</Button>}
          {can('tenant.member.invite') && <Button type="button" onClick={() => setDialog({ kind: 'invite' })}><Mail className="h-g16 w-g16" aria-hidden="true" />{t('tb.invite_member', 'Invite member')}</Button>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {failed ? (
          <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('tb.members_load_error', 'Members could not be loaded.')}</AlertDescription></AlertContent>
            <AlertActions><Button type="button" variant="outline" size="sm" onClick={() => refresh()}><RefreshCw aria-hidden="true" />{t('tb.retry', 'Retry')}</Button></AlertActions></Alert>
        ) : loading ? (
          <div className="space-y-g8 p-g13" aria-busy="true"><Skeleton className="h-g42 w-full" /><Skeleton className="h-g42 w-full" /><Skeleton className="h-g42 w-full" /></div>
        ) : filter === 'pending' ? (
          <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
            <Table>
              <TableHeader><TableRow>
                <TableColumnHeader>{t('tb.col_email', 'Email')}</TableColumnHeader><TableColumnHeader>{t('tb.col_role', 'Role')}</TableColumnHeader>
                <TableColumnHeader>{t('tb.col_departments', 'Departments')}</TableColumnHeader><TableColumnHeader>{t('tb.col_expires', 'Expires')}</TableColumnHeader>
                <TableColumnHeader className="text-right">{t('tb.col_action', 'Action')}</TableColumnHeader>
              </TableRow></TableHeader>
              <TableBody>
                {(invitationsQuery.data?.invitations || []).map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email || t('onboarding.invite_code', 'Invite code')}</TableCell>
                    <TableCell>{roleLabel(inv.tenantRole)}</TableCell>
                    <TableCell>{names(inv.departmentIds)}</TableCell>
                    <TableCell>{new Date(inv.expiresAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-g3">
                        {can('tenant.invitation.resend') && <Button type="button" variant="ghost" size="sm" onClick={() => resend(inv)}><RefreshCw className="h-g16 w-g16" aria-hidden="true" />{t('tb.resend', 'Resend')}</Button>}
                        {can('tenant.invitation.cancel') && <Button type="button" variant="ghost" size="sm" onClick={() => cancel(inv)}><X className="h-g16 w-g16" aria-hidden="true" />{t('tb.cancel_invitation', 'Cancel invitation')}</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(invitationsQuery.data?.invitations || []).length === 0 && (
                  <TableEmptyState colSpan={5} message={t('tb.no_invitations', 'No pending invitations.')} />
                )}
              </TableBody>
            </Table>
          </TableScrollArea>
        ) : (
          <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
            <Table>
              <TableHeader><TableRow>
                <TableColumnHeader>{t('tb.col_name', 'Name')}</TableColumnHeader><TableColumnHeader>{t('tb.col_email', 'Email')}</TableColumnHeader><TableColumnHeader>{t('tb.col_role', 'Role')}</TableColumnHeader>
                <TableColumnHeader>{t('tb.col_departments', 'Departments')}</TableColumnHeader><TableColumnHeader>{t('tb.col_status', 'Membership status')}</TableColumnHeader>
                <TableColumnHeader className="text-right">{t('tb.col_action', 'Action')}</TableColumnHeader>
              </TableRow></TableHeader>
              <TableBody>
                {(membersQuery.data?.members || []).map((m) => {
                  const manage = canManage(m);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{m.name || '—'}{m.userId === identity?.id && <Text as="span" size="xs" tone="muted" className="ml-g8">({t('tb.you', 'you')})</Text>}</TableCell>
                      <TableCell>{m.email}</TableCell>
                      <TableCell>{roleLabel(m.tenantRole)}</TableCell>
                      <TableCell>{m.tenantRole === 'admin' ? t('tb.all_departments', 'All departments') : names(m.departmentIds)}</TableCell>
                      <TableCell><Badge tone={m.status === 'active' ? 'success' : 'warning'}>{m.status === 'active' ? t('tb.status_active', 'Active') : t('tb.status_suspended', 'Suspended')}</Badge></TableCell>
                      <TableCell className="text-right">
                        {manage ? (
                          <div className="flex items-center justify-end gap-g3">
                            {(can('tenant.member.role.update') || can('tenant.member.departments.update')) && (
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDialog({ kind: 'edit', member: m })} aria-label={t('tb.edit_access_for', 'Edit access for {name}', { name: m.name || m.email })}><Pencil className="h-g13 w-g13" aria-hidden="true" /></Button>
                            )}
                            {can('tenant.member.status.update') && (m.status === 'active'
                              ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setStatus(m, 'suspended')} aria-label={t('tb.suspend_for', 'Suspend membership of {name}', { name: m.name || m.email })}><UserX className="h-g13 w-g13" aria-hidden="true" /></Button>
                              : <Button type="button" variant="ghost" size="icon-sm" onClick={() => setStatus(m, 'active')} aria-label={t('tb.reactivate_for', 'Reactivate membership of {name}', { name: m.name || m.email })}><UserCheck className="h-g13 w-g13" aria-hidden="true" /></Button>)}
                            {can('tenant.member.remove') && <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(m)} aria-label={t('tb.remove_for', 'Remove membership of {name}', { name: m.name || m.email })}><UserMinus className="h-g13 w-g13" aria-hidden="true" /></Button>}
                          </div>
                        ) : <MoreHorizontal className="ml-auto h-g16 w-g16 text-primary-foreground" aria-hidden="true" />}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(membersQuery.data?.members || []).length === 0 && (
                  <TableEmptyState colSpan={6} message={t('tb.no_members', 'No members match this view.')} />
                )}
              </TableBody>
            </Table>
          </TableScrollArea>
        )}
        {total > PAGE_SIZES[0] && <TablePagination currentPage={page + 1} totalPages={pages} rowsPerPage={pageSize} rowsPerPageOptions={PAGE_SIZES} onPageChange={next => setPage(next - 1)} onRowsPerPageChange={size => { setPageSize(size); setPage(0); }} />}
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
    <CardHeader className="flex flex-row items-center justify-between gap-g13 border-b border-border pb-g13">
      <DialogTitle className="flex items-center gap-g8">{title}</DialogTitle>
      <Button type="button" variant="ghost" size="icon-md" onClick={onClose} aria-label={t('common.close', 'Close')}><X className="h-g16 w-g16" aria-hidden="true" /></Button>
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
    <ModalFrame size="md" onClose={onClose} >
      <DialogHeader title={codeOnly ? t('onboarding.generate_code', 'Generate invite code') : t('tb.invite_member', 'Invite member')} onClose={onClose} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        {!codeOnly && <Field>
          <FieldLabel htmlFor={ids.email}>{t('tb.col_email', 'Email')}</FieldLabel>
          <Input id={ids.email} type="email" autoComplete="off" value={email} aria-invalid={email.length > 0 && !emailValid} aria-describedby={email.length > 0 && !emailValid ? `${ids.email}-error` : undefined} onChange={(e) => setEmail(e.target.value)} />
          {email.length > 0 && !emailValid && <Text size="xs" tone="destructive" className="mt-g5" id={`${ids.email}-error`}>{t('tb.invalid_email', 'Enter a valid email address.')}</Text>}
        </Field>}
        <Field>
          <FieldLabel htmlFor={ids.role}>{t('tb.col_role', 'Role')}</FieldLabel>
          <NativeSelect id={ids.role} value={role} onChange={(e) => setRole(e.target.value as TenantRole)}>
            {assignable.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </NativeSelect>
        </Field>
        {role !== 'admin' && (
          <div>
            <DepartmentPicker departments={departments} value={departmentIds} onChange={setDepartmentIds} legend={t('tb.col_departments', 'Departments')} aria-describedby={!deptValid ? `invite-dept-error` : undefined} />
            {!deptValid && <Text size="xs" tone="muted" className="mt-g5" id="invite-dept-error">{t('tb.department_required', 'Choose at least one department.')}</Text>}
          </div>
        )}
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('tb.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !emailValid || !deptValid}>{busy ? <Spinner size="sm" decorative /> : <Mail className="h-g16 w-g16" aria-hidden="true" />}{codeOnly ? t('onboarding.generate_code', 'Generate invite code') : t('tb.send_invitation', 'Send invitation')}</Button>
        </div>
      </form>
    </ModalFrame>
  );
};

const InviteLinkDialog: React.FC<{ url: string; code?: string; expiresAt?: string; onClose: () => void }> = ({ url, code, expiresAt, onClose }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copyLabel = copied ? t('tb.copied', 'Copied') : code ? t('onboarding.copy_code', 'Copy code') : t('tb.copy_link', 'Copy link');
  return (
    <ModalFrame size="md" onClose={onClose} >
      <DialogHeader title={code ? t('onboarding.code_created', 'Invite code created') : t('tb.invitation_not_sent_title', 'Invitation created; email not sent')} onClose={onClose} />
      <div className="flex flex-col gap-g13 p-g21">
        <Text size="sm">{code ? t('onboarding.code_hint', 'Share this code to create an account or join your organization. No superuser approval is needed. It expires in 24 hours and can be used once.') : t('tb.invitation_not_sent', 'The invitation is saved, but no email was delivered. Share this link with the invited person yourself.')}</Text>
        <Clipboard value={code || url} onStatusChange={details => setCopied(details.copied)}>
          <ClipboardLabel>{code ? t('onboarding.invite_code', 'Invite code') : t('tb.invitation_link', 'Invitation link')}</ClipboardLabel>
          <ClipboardControl>
            <ClipboardInput readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <ClipboardTrigger asChild>
              {/* zag labels the trigger "Copy to clipboard"; keep the accessible name equal to the visible text. */}
              <Button type="button" variant="outline" className="shrink-0" aria-label={copyLabel}>
                <Copy aria-hidden="true" />{copyLabel}
              </Button>
            </ClipboardTrigger>
          </ClipboardControl>
        </Clipboard>
        <span role="status" className="sr-only">{copied ? t('tb.copied', 'Copied') : ''}</span>
        {expiresAt && <Text size="sm" tone="muted">{t('tb.col_expires', 'Expires')}: {new Date(expiresAt).toLocaleString()}</Text>}
        <div className="flex justify-end gap-g8">
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
    <ModalFrame size="md" onClose={onClose} >
      <DialogHeader title={t('tb.edit_access_for', 'Edit access for {name}', { name: member.name || member.email })} onClose={onClose} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-g13 overflow-y-auto p-g21">
        <Field>
          <FieldLabel htmlFor={roleId}>{t('tb.col_role', 'Role')}</FieldLabel>
          <NativeSelect id={roleId} value={role} disabled={!canRole} onChange={(e) => setRole(e.target.value as TenantRole)}>
            {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </NativeSelect>
          {role === 'admin' && member.tenantRole !== 'admin' && <Text size="xs" tone="muted" className="mt-g5">{t('tb.admin_drops_departments', 'Administrators cover the whole organization; department assignments are removed.')}</Text>}
        </Field>
        {role !== 'admin' && (
          <div>
            <DepartmentPicker departments={departments} value={departmentIds} onChange={setDepartmentIds} disabled={!canDepartments} legend={t('tb.col_departments', 'Departments')} aria-describedby={needsDepartments ? `edit-dept-error` : undefined} />
            {needsDepartments && <Text size="xs" tone="destructive" className="mt-g5" id="edit-dept-error">{t('tb.department_required', 'Choose at least one department.')}</Text>}
          </div>
        )}
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        <div className="flex justify-end gap-g8">
          <Button type="button" variant="outline" onClick={onClose}>{t('tb.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || needsDepartments}>{busy && <Spinner size="sm" decorative />}{t('tb.save', 'Save')}</Button>
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
    <ModalFrame size="md" onClose={onClose} >
      <DialogHeader title={t('tb.departments', 'Departments')} onClose={onClose} />
      <div className="flex flex-col gap-g13 overflow-y-auto p-g21">
        {!hasPermission('department.create') && <Text size="sm" tone="muted">{t('tb.departments_readonly', 'You can see your assigned departments. Only administrators can change them.')}</Text>}
        {hasPermission('department.create') && (
          <form className="flex items-end gap-g8" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && (await act(() => orgApi(orgPath(organizationId, '/departments'), { method: 'POST', body: { name: name.trim() } })))) setName(''); }}>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={newId}>{t('tb.new_department', 'New department')}</FieldLabel>
              <Input id={newId} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || !name.trim()}><Plus className="h-g16 w-g16" aria-hidden="true" />{t('tb.add', 'Add')}</Button>
          </form>
        )}
        {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
        {loading ? <Skeleton className="h-g89 w-full" /> : (
          <List marker="none" className="divide-y divide-border rounded-xl border border-border">
            {departments.map((d) => (
              <ListItem key={d.id} className="flex min-h-g42 items-center justify-between gap-g8 px-g13 py-g5">
                {editing?.id === d.id ? (
                  <form className="flex flex-1 items-center gap-g8" onSubmit={async (e) => { e.preventDefault(); if (await act(() => orgApi(orgPath(organizationId, `/departments/${d.id}`), { method: 'PATCH', body: { name: editing.name.trim() } }))) setEditing(null); }}>
                    <Input aria-label={t('tb.department_name', 'Department name')} id={`rename-${d.id}`} autoFocus maxLength={100} value={editing.name} onChange={(e) => setEditing({ id: d.id, name: e.target.value })} />
                    <Button type="submit" size="sm" disabled={busy || !editing.name.trim()}>{t('tb.save', 'Save')}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('tb.cancel', 'Cancel')}</Button>
                  </form>
                ) : (
                  <>
                    <Text as="span" size="sm">{d.name}</Text>
                    <span className="flex gap-g3">
                      {hasPermission('department.edit') && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={t('tb.rename_department', 'Rename {name}', { name: d.name })}><Pencil className="h-g16 w-g16" aria-hidden="true" /></Button>}
                      {hasPermission('department.delete') && (
                        <Button type="button" variant="ghost" size="sm" aria-label={t('tb.delete_department', 'Delete {name}', { name: d.name })}
                          onClick={async () => { if (await confirm({ description: t('tb.delete_department_confirm', 'Delete the department {name}?', { name: d.name }), tone: 'danger', confirmLabel: t('tb.delete', 'Delete') })) await act(() => orgApi(orgPath(organizationId, `/departments/${d.id}`), { method: 'DELETE' })); }}>
                          <Trash2 className="h-g16 w-g16" aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  </>
                )}
              </ListItem>
            ))}
            {departments.length === 0 && <ListItem className="px-g13 py-g13 text-sm text-muted-foreground">{t('tb.no_departments', 'No departments yet.')}</ListItem>}
          </List>
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
  const [pageSize, setPageSize] = useRowsPerPage('org_audit', PAGE_SIZES[0]);
  const audit = useQuery<{ events: AuditEvent[]; total: number }>({
    queryKey: ['org-audit', identity?.id, organizationId, page, pageSize],
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, `/audit?limit=${pageSize}&offset=${page * pageSize}`), { signal }),
    enabled: dataset === 'admin',
  });
  const pages = Math.max(1, Math.ceil((audit.data?.total || 0) / pageSize));
  return (
    <ModalFrame size="xl" onClose={onClose} >
      <DialogHeader title={t('tb.history', 'History')} onClose={onClose} />
      <div className="overflow-y-auto p-g21">
        <Tabs value={dataset} onValueChange={details => setDataset(details.value as 'admin' | 'activity')}>
          <TabsList aria-label={t('tb.history', 'History')}>
            <TabsTrigger value="admin">{t('tb.history_admin', 'Administrative changes')}</TabsTrigger>
            <TabsTrigger value="activity">{t('tb.history_activity', 'Operational activity')}</TabsTrigger>
          </TabsList>
          <TabsContent value="admin" className="pt-g13">
            {audit.isError ? (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('tb.history_load_error', 'History could not be loaded.')}</AlertDescription></AlertContent></Alert>
            ) : audit.isLoading ? <Skeleton className="h-g144 w-full" /> : (
              <Card className="overflow-hidden">
                <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
                <Table>
                  <TableHeader><TableRow>
                    <TableColumnHeader>{t('tb.col_when', 'When')}</TableColumnHeader><TableColumnHeader>{t('tb.col_actor', 'By')}</TableColumnHeader>
                    <TableColumnHeader>{t('tb.col_action', 'Action')}</TableColumnHeader><TableColumnHeader>{t('tb.col_changes', 'Changed fields')}</TableColumnHeader>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(audit.data?.events || []).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{e.actorName || '—'}{e.accessMode === 'platform' && <Text as="span" size="xs" tone="muted" className="ml-g3">({t('tb.platform_admin_short', 'platform')})</Text>}</TableCell>
                        <TableCell className="font-mono">{e.action}</TableCell>
                        <TableCell>{e.changedFields.join(', ') || '—'}</TableCell>
                      </TableRow>
                    ))}
                    {(audit.data?.events || []).length === 0 && <TableEmptyState colSpan={4} message={t('tb.no_history', 'No administrative changes yet.')} />}
                  </TableBody>
                </Table>
                </TableScrollArea>
                {(audit.data?.total || 0) > PAGE_SIZES[0] && <TablePagination currentPage={page + 1} totalPages={pages} rowsPerPage={pageSize} rowsPerPageOptions={PAGE_SIZES} onPageChange={next => setPage(next - 1)} onRowsPerPageChange={size => { setPageSize(size); setPage(0); }} />}
                </Card>
            )}
          </TabsContent>
          <TabsContent value="activity" className="pt-g13">
            <Suspense fallback={<Skeleton className="h-g144 w-full" />}><LazyActivityLogsView /></Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </ModalFrame>
  );
};
