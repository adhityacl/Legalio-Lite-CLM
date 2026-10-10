import React, { useId, useMemo, useState } from 'react';
import { Ban, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { ModalFrame } from '../ui/modal-frame';

import { Input } from '@legalio/ui-components/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell } from '@legalio/ui-components/table';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Card } from '@legalio/ui-components/card';
import { DialogHeader, DialogTitle, DialogCloseIcon } from '@legalio/ui-components/dialog';
import { Field, FieldLabel, FieldHelperText } from '@legalio/ui-components/field';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
/** Platform identity DTO from `GET /api/auth-console/users` (no tenant roles or memberships). */
export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  platformRole: 'user' | 'superuser';
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  sessionCount: number;
  primaryProvider: string | null;
  membershipCount: number;
}

const labelClass = 'mb-1.5 block text-sm font-medium text-foreground ';

/**
 * Global account directory (System Admin only, PRD §4.5.1). Account
 * lifecycle and platform role live here; organization membership is managed
 * through "Manage organization" → Members & Access, never from this table.
 */
export const PlatformUsersTab: React.FC<{
  users: PlatformUser[];
  onCreate: (input: { name: string; email: string; platformRole: 'user' | 'superuser'; password?: string }) => Promise<void>;
  onUpdate: (user: PlatformUser, input: { name: string; email: string; platformRole: 'user' | 'superuser' }) => Promise<void>;
  onResetPassword: (user: PlatformUser, password: string) => Promise<void>;
  onToggleBan: (user: PlatformUser) => Promise<void>;
  onDelete: (user: PlatformUser) => Promise<void>;
}> = ({ users, onCreate, onUpdate, onResetPassword, onToggleBan, onDelete }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<null | { kind: 'create' } | { kind: 'edit'; user: PlatformUser } | { kind: 'password'; user: PlatformUser }>(null);
  const searchId = useId();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, search]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="mobile-controls-bar flex flex-col items-stretch justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <InputGroup className="relative min-w-55 max-w-md flex-1">
          <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput
            id={searchId}
            type="search"
            aria-label={t('tb.search_accounts', 'Search accounts')}
            placeholder={t('tb.search_accounts', 'Search accounts...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <Button variant="ghost"
          type="button"
          onClick={() => setDialog({ kind: 'create' })}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('tb.create_account', 'Create account')}</span>
        </Button>
      </Card>
      <Card className="overflow-x-auto">
        <Table className="w-full text-left">
          <TableHeader><TableRow>
            <TableColumnHeader scope="col" className="text-left align-middle">{t('tb.col_name', 'Name')}</TableColumnHeader><TableColumnHeader scope="col" className="text-left align-middle">{t('tb.col_email', 'Email')}</TableColumnHeader>
            <TableColumnHeader scope="col" className="text-left align-middle">{t('tb.col_platform_role', 'Platform role')}</TableColumnHeader><TableColumnHeader scope="col" className="text-left align-middle">{t('tb.col_organizations', 'Organizations')}</TableColumnHeader>
            <TableColumnHeader scope="col" className="text-left align-middle">{t('tb.col_account_status', 'Account status')}</TableColumnHeader><TableColumnHeader scope="col" className="text-right align-middle">{t('tb.col_action', 'Action')}</TableColumnHeader>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((u) => {
              const self = u.id === identity?.id;
              return (
                <TableRow key={u.id}>
                  <TableCell className="text-left align-middle">{u.name}{self && <span className="ml-2 text-xs text-muted-foreground">({t('tb.you', 'you')})</span>}</TableCell>
                  <TableCell className="text-left align-middle">{u.email}</TableCell>
                  <TableCell className="text-left align-middle">{u.platformRole === 'superuser'
                    ? <Badge tone="special"><ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />{t('tb.platform_administrator', 'Platform administrator')}</Badge>
                    : <Badge tone="neutral">{t('tb.platform_user', 'User')}</Badge>}</TableCell>
                  <TableCell className="text-left align-middle">{u.membershipCount}</TableCell>
                  <TableCell className="text-left align-middle">{u.banned
                    ? <Badge tone="danger">{u.banReason === 'PENDING_APPROVAL' ? t('tb.pending_approval', 'Pending approval') : t('tb.disabled', 'Disabled')}</Badge>
                    : <Badge tone="success">{t('tb.status_active', 'Active')}</Badge>}</TableCell>
                  <TableCell className="text-right align-middle">
                    {!self && (
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon-md" onClick={() => setDialog({ kind: 'edit', user: u })} aria-label={t('tb.edit_account_for', 'Edit account of {name}', { name: u.name })}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                        <Button type="button" variant="ghost" size="icon-md" onClick={() => setDialog({ kind: 'password', user: u })} aria-label={t('tb.set_password_for', 'Set password for {name}', { name: u.name })}><KeyRound className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                        <Button type="button" variant="ghost" size="icon-md" className={u.banned && u.banReason === 'PENDING_APPROVAL' ? 'w-auto' : undefined} onClick={() => onToggleBan(u)} aria-label={u.banned && u.banReason === 'PENDING_APPROVAL' ? t('onboarding.approve_account_for', 'Approve account of {name}', { name: u.name }) : u.banned ? t('tb.enable_account_for', 'Enable account of {name}', { name: u.name }) : t('tb.disable_account_for', 'Disable account of {name}', { name: u.name })}>
                          {u.banned ? <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Ban className="h-3.5 w-3.5" aria-hidden="true" />}{u.banned && u.banReason === 'PENDING_APPROVAL' && t('onboarding.approve', 'Approve')}
                        </Button>
                        <Button type="button" variant="ghost" size="icon-md" onClick={() => onDelete(u)} aria-label={t('tb.delete_account_for', 'Delete account of {name}', { name: u.name })}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {dialog?.kind === 'create' && <AccountDialog title={t('tb.create_account', 'Create account')} withPassword onClose={() => setDialog(null)}
        onSubmit={async (v) => { await onCreate(v); setDialog(null); }} />}
      {dialog?.kind === 'edit' && <AccountDialog title={t('tb.edit_account_for', 'Edit account of {name}', { name: dialog.user.name })} initial={dialog.user}
        onClose={() => setDialog(null)} onSubmit={async (v) => { await onUpdate(dialog.user, v); setDialog(null); }} />}
      {dialog?.kind === 'password' && <PasswordDialog user={dialog.user} onClose={() => setDialog(null)}
        onSubmit={async (p) => { await onResetPassword(dialog.user, p); setDialog(null); }} />}
    </div>
  );
};

const DialogShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  const { t } = useLanguage();
  return (
    <ModalFrame onClose={onClose} className="max-w-lg">
      <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
        <DialogCloseIcon aria-label={t('common.close', 'Close')} />
      </DialogHeader>
      {children}
    </ModalFrame>
  );
};

const AccountDialog: React.FC<{
  title: string; initial?: PlatformUser; withPassword?: boolean; onClose: () => void;
  onSubmit: (v: { name: string; email: string; platformRole: 'user' | 'superuser'; password?: string }) => Promise<void>;
}> = ({ title, initial, withPassword, onClose, onSubmit }) => {
  const { t } = useLanguage();
  const [name, setName] = useState(initial?.name || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [platformRole, setRole] = useState<'user' | 'superuser'>(initial?.platformRole || 'user');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), email: useId(), role: useId(), password: useId() };
  const valid = name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (!password || password.length >= 8);
  return (
    <DialogShell title={title} onClose={onClose}>
      <form noValidate className="flex flex-col gap-4 p-5" onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        try { await onSubmit({ name: name.trim(), email: email.trim(), platformRole, ...(withPassword && password ? { password } : {}) }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <Field><FieldLabel htmlFor={ids.name} className={labelClass}>{t('tb.col_name', 'Name')}</FieldLabel><Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor={ids.email} className={labelClass}>{t('tb.col_email', 'Email')}</FieldLabel><Input id={ids.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field>
          <FieldLabel htmlFor={ids.role} className={labelClass}>{t('tb.col_platform_role', 'Platform role')}</FieldLabel>
          <NativeSelect id={ids.role} value={platformRole} onChange={(e) => setRole(e.target.value as 'user' | 'superuser')}>
            <option value="user">{t('tb.platform_user', 'User')}</option>
            <option value="superuser">{t('tb.platform_administrator', 'Platform administrator')}</option>
          </NativeSelect>
        </Field>
        {withPassword && (
          <Field>
            <FieldLabel htmlFor={ids.password} className={labelClass}>{t('tb.initial_password', 'Initial password (optional)')}</FieldLabel>
            <Input id={ids.password} type="password" autoComplete="new-password" value={password} aria-invalid={password.length > 0 && password.length < 8} aria-describedby={`${ids.password}-hint`} onChange={(e) => setPassword(e.target.value)} />
            <FieldHelperText id={`${ids.password}-hint`}>{t('tb.password_hint', 'At least 8 characters.')}</FieldHelperText>
          </Field>
        )}
        {error && <Alert status="error" role="alert"><AlertContent>{error}</AlertContent></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('tb.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={!valid || busy}>{t('tb.save', 'Save')}</Button>
        </div>
      </form>
    </DialogShell>
  );
};

const PasswordDialog: React.FC<{ user: PlatformUser; onClose: () => void; onSubmit: (password: string) => Promise<void> }> = ({ user, onClose, onSubmit }) => {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <DialogShell title={t('tb.set_password_for', 'Set password for {name}', { name: user.name })} onClose={onClose}>
      <form noValidate className="flex flex-col gap-4 p-5" onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < 8) return;
        try { await onSubmit(password); } catch (err) { setError((err as Error).message); }
      }}>
        <Field>
          <FieldLabel htmlFor={id} className={labelClass}>{t('tb.new_password', 'New password')}</FieldLabel>
          <Input id={id} type="password" autoComplete="new-password" value={password} aria-invalid={password.length > 0 && password.length < 8} aria-describedby={`${id}-hint`} onChange={(e) => setPassword(e.target.value)} />
          <FieldHelperText id={`${id}-hint`}>{t('tb.password_hint', 'At least 8 characters.')}</FieldHelperText>
        </Field>
        {error && <Alert status="error" role="alert"><AlertContent>{error}</AlertContent></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('tb.cancel', 'Cancel')}</Button>
          <Button type="submit" disabled={password.length < 8}>{t('tb.save', 'Save')}</Button>
        </div>
      </form>
    </DialogShell>
  );
};
