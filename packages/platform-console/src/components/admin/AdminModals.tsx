import { ModalFrame } from '../ui/modal-frame';
import { LogoUploadField } from '../settings/LogoUploadField';
export { LogoUploadField } from '../settings/LogoUploadField';
import { AlphabeticalSelect } from '../ui/alphabetical-select';
import React, { useState, useEffect } from 'react';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { SUPPORTED_CURRENCIES, currencyLabel } from '@legalio/shared/currencyUtils';
import {
  X,
  UserPlus,
  Shield,
  KeyRound,
  Building2,
  Layers,
  Mail,
  Lock,
  Copy,
  Check,
  AlertTriangle,
  Pencil,
  Trash2,
  Key,
  Eye,
  EyeOff,
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Save,
} from 'lucide-react';
import {
  ConsoleUser,
  ConsoleOrganization,
  ConsoleTeam,
} from './types';
import { useLanguage } from '../../context/LanguageContext';
import { useDepartments } from '../../hooks/useDepartments';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { DialogHeader, DialogTitle, DialogCloseIcon } from '@legalio/ui-components/dialog';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Card } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
// Add user modal

interface AddUserModalProps {
  isOpen: boolean;
  teams?: ConsoleTeam[];
  organizations?: ConsoleOrganization[];
  activeOrgId?: string;
  allowedRoles?: string[];
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    email: string;
    role: string;
    password?: string;
    department?: string;
    organizationId?: string;
  }) => Promise<void>;
}

export const AddUserModal: React.FC<AddUserModalProps> = ({
  isOpen,
  teams,
  organizations = [],
  activeOrgId,
  allowedRoles = ['manager', 'editor', 'viewer'],
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const { departments: DEFAULT_DEPARTMENTS } = useDepartments();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(allowedRoles.includes('editor') ? 'editor' : allowedRoles[0] || 'viewer');
  const [department, setDepartment] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (isOpen) {
      setError('');
      if (!allowedRoles.includes(role)) {
        setRole(allowedRoles[0] || 'viewer');
      }
      // Default to active organization or first available
      if (activeOrgId && organizations?.some((org) => org.id === activeOrgId)) {
        setOrganizationId(activeOrgId);
      } else if (organizations && organizations.length > 0) {
        setOrganizationId(organizations[0].id);
      } else {
        setOrganizationId('');
      }
    }
  }, [isOpen, activeOrgId, organizations, allowedRoles, role]);

  const orgTeams = organizationId ? (teams || []).filter((tm) => tm.organizationId === organizationId) : [];

  // Departments belong to one organization each — re-pick a default (and drop
  // a stale one from a previously selected tenant) whenever the tenant changes.
  React.useEffect(() => {
    const stillValid = orgTeams.some((tm) => tm.name === department);
    if (!stillValid) {
      setDepartment(orgTeams.length > 0 ? orgTeams[0].name : (DEFAULT_DEPARTMENTS?.[0] || ''));
    }
  }, [organizationId, teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const deptOptions = Array.from(
    new Set([
      ...(orgTeams.length > 0 ? orgTeams.map((tm) => tm.name) : DEFAULT_DEPARTMENTS),
      ...(department ? [department] : []),
    ])
  ).filter(Boolean);

  const handleRoleChange = (newRole: string) => {
    setRole(newRole);
    if (newRole === 'superuser') {
      setOrganizationId('');
    } else if (!organizationId && organizations && organizations.length > 0) {
      setOrganizationId(activeOrgId || organizations[0].id);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError(t('admin.err_required', 'Nama Lengkap Pengguna dan Alamat Email wajib diisi.'));
      return;
    }
    // Roles below Superuser and Admin MUST be assigned to 1 tenant
    if (role !== 'superuser' && role !== 'admin' && !organizationId) {
      setError(t('admin.err_tenant_required', 'Peran di bawah Superuser dan Admin wajib masuk ke 1 organisasi/tenant.'));
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        password: password ? password : undefined,
        department: role === 'superuser' || role === 'admin' ? undefined : department.trim(),
        organizationId: role === 'superuser' ? undefined : (organizationId || undefined),
      });
      setName('');
      setEmail('');
      setPassword('');
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.err_add_user', 'Gagal menambahkan user'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-accent-foreground" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_add_user', 'Tambah Pengguna Sistem Baru')}
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="adminmodals-field-1">
              {t('admin.fullname_label', 'Nama Lengkap Pengguna *')}
            </FieldLabel>
            <Input id="adminmodals-field-1"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.contoh_rina_melati', 'Contoh: Rina Melati')}
              className="w-full"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-2">
              {t('admin.email_label', 'Alamat Email (Google / Corporate) *')}
            </FieldLabel>
            <Input id="adminmodals-field-2"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('admin.name_example_com', 'name@example.com')}
              className="w-full"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-3">
              {t('admin.role_label', 'Role Hak Akses Aplikasi *')}
            </FieldLabel>
            <AlphabeticalSelect id="adminmodals-field-3"
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full" controlProps={{ className: "w-full" }}
            >
              {allowedRoles.includes('superuser') && <option value="superuser">{t('admin.superuser', 'Superuser')}</option>}
              {allowedRoles.includes('admin') && <option value="admin">{t('admin.admin', 'Admin')}</option>}
              {allowedRoles.includes('manager') && <option value="manager">{t('admin.manager', 'Manager')}</option>}
              {allowedRoles.includes('editor') && <option value="editor">{t('admin.editor', 'Editor')}</option>}
              {allowedRoles.includes('viewer') && <option value="viewer">{t('admin.viewer', 'Viewer')}</option>}
            </AlphabeticalSelect>
          </Field>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="admin-organization-1" className="block text-xs font-medium text-foreground">
                {t('admin.select_tenant_label', 'Organisasi / Tenant')} {role !== 'superuser' && role !== 'admin' && <span className="text-status-danger">*</span>}
              </label>
              {role !== 'superuser' && role !== 'admin' && (
                <span className="text-xs text-status-warning font-medium">
                  {t('admin.must_one_tenant', '(Wajib Masuk ke 1 Tenant)')}
                </span>
              )}
            </div>
            <AlphabeticalSelect id="admin-organization-1"
              value={role === 'superuser' ? '' : organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              disabled={role === 'superuser'}
              required={role !== 'superuser' && role !== 'admin'}
              className="w-full disabled:opacity-60" controlProps={{ className: "w-full" }}
            >
              {role === 'superuser' ? (
                <option value="">{t('admin.all_tenants', 'Semua Tenant / Organisasi (Akses Global)')}</option>
              ) : role === 'admin' ? (
                <>
                  <option value="">{t('admin.all_tenants', 'Semua Tenant / Organisasi (Akses Global)')}</option>
                  {(organizations || []).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.metadata?.brandName && org.metadata?.brandName !== org.name ? `(${org.metadata.brandName})` : ''}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value="">-- {t('admin.select_tenant', 'Pilih Organisasi / Tenant')} --</option>
                  {(organizations || []).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.metadata?.brandName && org.metadata?.brandName !== org.name ? `(${org.metadata.brandName})` : ''}
                    </option>
                  ))}
                </>
              )}
            </AlphabeticalSelect>
          </div>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-4">
              {t('admin.tab_teams', 'Departemen')}
            </FieldLabel>
            <AlphabeticalSelect id="adminmodals-field-4"
              value={role === 'superuser' || role === 'admin' ? '' : department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={role === 'superuser' || role === 'admin'}
              className="w-full disabled:opacity-60" controlProps={{ className: "w-full" }}
            >
              {role === 'superuser' || role === 'admin' ? (
                <option value="">{t('admin.all_departments', 'Semua Departemen (Akses Global)')}</option>
              ) : (
                deptOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))
              )}
            </AlphabeticalSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-5">
              {t('admin.pwd_init_label', 'Kata Sandi Awal (Opsional)')}
            </FieldLabel>
            <Input id="adminmodals-field-5"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('admin.kosongkan_jika_menggunakan_google_login_sso', 'Kosongkan jika menggunakan Google Login SSO')}
              className="w-full"
            />
          </Field>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.saving', 'Menyimpan...') : t('admin.btn_save_user', 'Simpan Pengguna')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Edit user modal
interface EditUserModalProps {
  user: ConsoleUser | null;
  teams?: ConsoleTeam[];
  organizations?: ConsoleOrganization[];
  allowedRoles?: string[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (userId: string, newRole: string, newDepartment?: string, organizationId?: string, newName?: string, newEmail?: string) => Promise<void>;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({
  user,
  teams,
  organizations,
  allowedRoles = ['manager', 'editor', 'viewer'],
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const { departments: DEFAULT_DEPARTMENTS } = useDepartments();
  const [role, setRole] = useState(user?.role || 'editor');
  const [department, setDepartment] = useState(user?.department || '');
  const [organizationId, setOrganizationId] = useState(user?.organizationId || '');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (user) {
      setError('');
      setRole(user.role);
      setDepartment(user.department || '');
      setOrganizationId(user.organizationId || '');
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  // Departments belong to one organization each — when the selected tenant
  // changes, drop a department that belonged to the previous one instead of
  // silently keeping it selected against the new tenant's list.
  React.useEffect(() => {
    if (!organizationId || !department) return;
    const stillValid = (teams || []).some((tm) => tm.organizationId === organizationId && tm.name === department);
    if (!stillValid) setDepartment('');
  }, [organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const orgTeams = organizationId ? (teams || []).filter((tm) => tm.organizationId === organizationId) : [];
  const deptOptions = Array.from(
    new Set([
      ...(orgTeams.length > 0 ? orgTeams.map((tm) => tm.name) : DEFAULT_DEPARTMENTS),
      ...(department ? [department] : []),
    ])
  ).filter(Boolean);

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'superuser' && role !== 'admin' && !organizationId) {
      setError(t('admin.err_tenant_required', 'Peran di bawah Superuser dan Admin wajib masuk ke 1 organisasi/tenant.'));
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit(
        user.id,
        role,
        role === 'superuser' || role === 'admin' ? undefined : department,
        role === 'superuser' ? undefined : (organizationId || undefined),
        name,
        email
      );
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.gagal_mengubah_user', 'Gagal mengubah user'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-status-special" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_edit_user', 'Ubah Informasi & Hak Akses Pengguna')}
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          <Card className="p-3 space-y-3">
            <Field>
              <FieldLabel htmlFor="adminmodals-field-6">
                {t('admin.col_name', 'Nama Lengkap')}
              </FieldLabel>
              <Input id="adminmodals-field-6"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="adminmodals-field-7">
                {t('admin.col_email', 'Alamat Email')}
              </FieldLabel>
              <Input id="adminmodals-field-7"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full"
              />
            </Field>
          </Card>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-8">
              {t('admin.select_new_role', 'Pilih Peran Baru (Role)')}
            </FieldLabel>
            <AlphabeticalSelect id="adminmodals-field-8"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full" controlProps={{ className: "w-full" }}
            >
              {allowedRoles.includes('superuser') && <option value="superuser">{t('admin.superuser', 'Superuser')}</option>}
              {allowedRoles.includes('admin') && <option value="admin">{t('admin.admin', 'Admin')}</option>}
              {allowedRoles.includes('manager') && <option value="manager">{t('admin.manager', 'Manager')}</option>}
              {allowedRoles.includes('editor') && <option value="editor">{t('admin.editor', 'Editor')}</option>}
              {allowedRoles.includes('viewer') && <option value="viewer">{t('admin.viewer', 'Viewer')}</option>}
            </AlphabeticalSelect>
          </Field>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="admin-organization-2" className="block text-xs font-medium text-foreground">
                {t('admin.select_tenant_label', 'Organisasi / Tenant')} {role !== 'superuser' && role !== 'admin' && <span className="text-status-danger">*</span>}
              </label>
              {role !== 'superuser' && role !== 'admin' && (
                <span className="text-xs text-status-warning font-medium">
                  {t('admin.must_one_tenant', '(Wajib Masuk ke 1 Tenant)')}
                </span>
              )}
            </div>
            <AlphabeticalSelect id="admin-organization-2"
              value={role === 'superuser' ? '' : organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              disabled={role === 'superuser'}
              required={role !== 'superuser' && role !== 'admin'}
              className="w-full disabled:opacity-60" controlProps={{ className: "w-full" }}
            >
              {role === 'superuser' ? (
                <option value="">{t('admin.all_tenants', 'Semua Tenant / Organisasi (Akses Global)')}</option>
              ) : role === 'admin' ? (
                <>
                  <option value="">{t('admin.all_tenants', 'Semua Tenant / Organisasi (Akses Global)')}</option>
                  {(organizations || []).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.metadata?.brandName && org.metadata?.brandName !== org.name ? `(${org.metadata.brandName})` : ''}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value="">-- {t('admin.select_tenant', 'Pilih Tenant / Organisasi')} --</option>
                  {(organizations || []).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.metadata?.brandName && org.metadata?.brandName !== org.name ? `(${org.metadata.brandName})` : ''}
                    </option>
                  ))}
                </>
              )}
            </AlphabeticalSelect>
          </div>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-9">
              {t('admin.tab_teams', 'Departmens / Tim')}
            </FieldLabel>
            <AlphabeticalSelect id="adminmodals-field-9"
              value={role === 'superuser' || role === 'admin' ? '' : department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={role === 'superuser' || role === 'admin'}
              className="w-full disabled:opacity-60" controlProps={{ className: "w-full" }}
            >
              {role === 'superuser' || role === 'admin' ? (
                <option value="">{t('admin.all_departments', 'Semua Departemen (Akses Global)')}</option>
              ) : (
                deptOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))
              )}
            </AlphabeticalSelect>
          </Field>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.saving', 'Menyimpan...') : t('admin.btn_update_user', 'Perbarui Pengguna')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Reset password modal
interface ResetPasswordModalProps {
  user: ConsoleUser | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (userId: string, newPass: string) => Promise<void>;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  user,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError(t('admin.err_pwd_min', 'Kata sandi minimal 6 karakter.'));
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(user.id, password);
      setPassword('');
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.err_reset_pwd', 'Gagal mereset kata sandi'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-status-info" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_reset_pwd', 'Reset Kata Sandi Pengguna')}
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          <div>
            <div className="text-xs text-muted-foreground">{t('admin.target_user', 'Target Pengguna')}:</div>
            <div className="font-semibold text-sm text-foreground">{user.name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-10">
              {t('admin.new_pwd_label', 'Kata Sandi Baru')}
            </FieldLabel>
            <Input id="adminmodals-field-10"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('admin.minimal_6_karakter', 'Minimal 6 karakter')}
              className="w-full"
            />
          </Field>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.saving', 'Menyimpan...') : t('admin.btn_update_pwd', 'Perbarui Kata Sandi')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Create organization modal
interface CreateOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; slug: string; logo?: string; currency?: string; countryCode?: string; industry?: string }) => Promise<void>;
}

export const CreateOrganizationModal: React.FC<CreateOrgModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t, language } = useLanguage();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logo, setLogo] = useState('');
  const { countries, industries } = useTenantSettings();
  const [countryCode, setCountryCode] = useState('INTL');
  const [industry, setIndustry] = useState('general');
  const [currency, setCurrency] = useState('USD');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]/g, '-')) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 30)
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setError(t('admin.err_org_required', 'Nama dan slug organisasi wajib diisi.'));
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), slug: slug.trim().toLowerCase(), logo: logo.trim(), currency, countryCode, industry });
      setName('');
      setSlug('');
      setLogo('');
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.err_create_org', 'Gagal membuat organisasi'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-accent-foreground" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_create_org', 'Buat Organisasi Enterprise Baru')}
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="adminmodals-field-11">
              {t('admin.org_name_label', 'Nama Resmi Organisasi / Entitas PT')}
            </FieldLabel>
            <Input id="adminmodals-field-11"
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('admin.contoh_pt_fintek_digital_mandiri', 'Contoh: PT Fintek Digital Mandiri')}
              className="w-full"
            />
          </Field>

          {/* Logo Uploader */}
          <LogoUploadField
            logo={logo}
            name={name}
            onChange={setLogo}
          />

          <div>
            <label htmlFor="adminmodals-field-12" className="block text-xs font-medium text-foreground mb-1">
              {t('admin.org_slug_label', 'Identifier Slug (Unik)')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                @
              </span>
              <Input id="adminmodals-field-12"
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="fintek-mandiri"
                className="w-full pl-7 pr-3"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('admin.org_slug_hint', 'Digunakan untuk pemetaan folder root dan tenant routing')}: <code className="font-mono text-accent-foreground">{t('admin.vendors', '/{slug}/[vendors]', { slug })}</code>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="adminmodals-field-13">
                {t('admin.org_currency_label', 'Mata Uang Utama')}
              </FieldLabel>
              <AlphabeticalSelect id="adminmodals-field-13"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full" controlProps={{ className: "w-full" }}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>
                ))}
              </AlphabeticalSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="create-org-country">
                {t('settings.region.country', 'Country / jurisdiction pack')}
              </FieldLabel>
              <AlphabeticalSelect
                id="create-org-country"
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value);
                  const pack = countries.find((c) => c.code === e.target.value);
                  if (pack) setCurrency(pack.defaultCurrency);
                }}
                className="w-full" controlProps={{ className: "w-full" }}
              >
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </AlphabeticalSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="create-org-industry">
                {t('settings.region.industry', 'Industry pack')}
              </FieldLabel>
              <AlphabeticalSelect
                id="create-org-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full" controlProps={{ className: "w-full" }}
              >
                {industries.map((i) => <option key={i.key} value={i.key}>{i.name.en}</option>)}
              </AlphabeticalSelect>
            </Field>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.creating', 'Membuat...') : t('admin.btn_create_org', 'Buat Organisasi')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Edit organization modal
interface EditOrganizationModalProps {
  isOpen: boolean;
  org: ConsoleOrganization | null;
  onClose: () => void;
  onSubmit: (orgId: string, data: { name: string; slug: string; logo?: string }) => Promise<void>;
  onDelete?: (org: ConsoleOrganization) => void;
}

export const EditOrganizationModal: React.FC<EditOrganizationModalProps> = ({
  isOpen,
  org,
  onClose,
  onSubmit,
  onDelete,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logo, setLogo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (org) {
      setName(org.name || '');
      setSlug(org.slug || '');
      setLogo(org.logo && org.logo !== '/favicon.png' ? org.logo : '');
      setError(null);
    }
  }, [org]);

  if (!isOpen || !org) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('admin.org_err_name_required', 'Nama organisasi wajib diisi'));
      return;
    }
    if (!slug.trim()) {
      setError(t('admin.org_err_slug_required', 'Slug organisasi wajib diisi'));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(org.id, {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        logo: logo.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.error_update_org', 'Gagal memperbarui organisasi'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="theme-soft w-7 h-7 rounded-lg flex items-center justify-center">
              <Pencil className="w-3.5 h-3.5" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {t('admin.modal_edit_org_title', 'Edit Profil & Pengaturan Organisasi')}
              </DialogTitle>
            </div>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="adminmodals-field-15">
              {t('admin.org_name_label', 'Nama Resmi Organisasi / Entitas PT')} <span className="text-status-danger">*</span>
            </FieldLabel>
            <Input id="adminmodals-field-15"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.e_g_acme_holdings_pte_ltd', 'e.g. Acme Holdings Pte. Ltd.')}
              className="w-full"
            />
          </Field>

          {/* Logo Uploader */}
          <LogoUploadField
            logo={logo}
            name={name}
            onChange={setLogo}
          />

          <div>
            <label htmlFor="adminmodals-field-16" className="block text-xs font-medium text-foreground mb-1">
              {t('admin.org_slug_label', 'Identifier Slug (Unik)')} <span className="text-status-danger">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                @
              </span>
              <Input id="adminmodals-field-16"
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme"
                className="w-full pl-7 pr-3"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('admin.org_slug_hint', 'Pemetaan tenant routing')}: <code className="font-mono text-accent-foreground">/{slug || 'tenant'}{t('admin.vendors_2', '/[vendors]')}</code>
            </p>
          </div>


          <Card className="p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.id_organisasi', 'ID Organisasi:')}</span>
              <code className="font-mono text-foreground">{org.id}</code>
            </div>
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.folder_isolasi', 'Folder Isolasi:')}</span>
              <span className="font-mono text-accent-foreground">/{name || org.name}{t('admin.vendors_3', '/[Vendors]')}</span>
            </div>
          </Card>

          <div className="pt-2 flex items-center justify-between gap-2">
            {onDelete && !org.metadata?.isDefault ? (
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => {
                  onClose();
                  onDelete(org);
                }}
                className="text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('admin.btn_delete_org', 'Hapus Organisasi')}</span>
              </Button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <Button variant="ghost"
                type="button"
                onClick={onClose}
              >
                {t('admin.btn_cancel', 'Batal')}
              </Button>
              <Button variant="ghost"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('admin.saving', 'Menyimpan...') : t('admin.btn_save_changes', 'Simpan Perubahan')}
              </Button>
            </div>
          </div>
        </form>

    </ModalFrame>
  );
};

// Delete organization modal
interface DeleteOrganizationModalProps {
  isOpen: boolean;
  org: ConsoleOrganization | null;
  isActive: boolean;
  onClose: () => void;
  onConfirm: (org: ConsoleOrganization) => Promise<void>;
}

export const DeleteOrganizationModal: React.FC<DeleteOrganizationModalProps> = ({
  isOpen,
  org,
  isActive,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !org) return null;

  const isDefault = Boolean(org.metadata?.isDefault);

  const handleDelete = async () => {
    if (isDefault || isActive) return;
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm(org);
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.toast.delete_org_failed', 'Gagal menghapus organisasi.'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-status-danger-soft flex items-center justify-center text-status-danger">
              <Trash2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {t('admin.delete_org_title', 'Hapus Organisasi')}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {org.name} (@{org.slug})
              </p>
            </div>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <div className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          {isDefault ? (
            <div className="p-3 rounded-lg bg-status-warning-soft border border-status-warning-border text-xs text-status-warning flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
              <div>
                <strong>{t('admin.cant_delete_default_org', 'Organisasi default sistem tidak dapat dihapus.')}</strong>
                <p className="mt-1 text-xs opacity-90">
                  {t('admin.organisasi_utama_ini_bertindak_sebagai_anchor', 'Organisasi utama ini bertindak sebagai anchor default untuk sistem dan tenant fallback.')}
                </p>
              </div>
            </div>
          ) : isActive ? (
            <div className="p-3 rounded-lg bg-status-warning-soft border border-status-warning-border text-xs text-status-warning flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
              <div>
                <strong>{t('admin.cant_delete_active_org', 'Beralih ke organisasi lain terlebih dahulu sebelum menghapus.')}</strong>
                <p className="mt-1 text-xs opacity-90">
                  {t('admin.organisasi_ini_sedang_digunakan_pada_sesi', 'Organisasi ini sedang digunakan pada sesi aktif saat ini. Beralihlah ke organisasi lain untuk dapat menghapusnya.')}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="p-3 rounded-lg bg-status-danger-soft border border-status-danger-border text-xs text-status-danger flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{t('admin.delete_org_confirm_msg', 'Apakah Anda yakin ingin menghapus organisasi ini secara permanen?')}</p>
                  <p className="mt-1 text-xs opacity-90">
                    {t('admin.delete_org_warning', 'Tindakan ini tidak dapat dibatalkan. Seluruh data tim, undangan, dan relasi pengguna dalam organisasi ini akan dihapus.')}
                  </p>
                </div>
              </div>

              <Card className="p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>{t('admin.nama_organisasi', 'Nama Organisasi:')}</span>
                  <span className="font-semibold text-foreground">{org.name}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>{t('admin.slug_tenant', 'Slug Tenant:')}</span>
                  <code className="font-mono text-accent-foreground">@{org.slug}</code>
                </div>
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>{t('admin.id', 'ID:')}</span>
                  <code className="font-mono text-muted-foreground">{org.id}</code>
                </div>
              </Card>
            </>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            {!isDefault && !isActive && (
              <Button variant="destructive"
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? t('admin.deleting', 'Menghapus...') : t('admin.btn_confirm_delete', 'Hapus Permanen')}</span>
              </Button>
            )}
          </div>
        </div>

    </ModalFrame>
  );
};

// Create team modal
interface CreateTeamModalProps {
  isOpen: boolean;
  activeOrg: ConsoleOrganization | null;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export const CreateTeamModal: React.FC<CreateTeamModalProps> = ({
  isOpen,
  activeOrg,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onSubmit(name.trim());
      setName('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || t('admin.gagal_menyimpan_tim_departemen', 'Gagal menyimpan tim / departemen'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-status-warning" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_create_team', 'Buat Tim / Divisi Baru')}
            </DialogTitle>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t('common.close', 'Tutup')} type="button" onClick={() => { setErrorMsg(null); onClose(); }}>
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <Alert status="error" role="alert">
              <AlertContent>{errorMsg}</AlertContent>
            </Alert>
          )}

          <div>
            <div className="text-xs text-muted-foreground">{t('admin.col_org', 'Organisasi')}:</div>
            <div className="font-semibold text-xs text-foreground">
              {activeOrg?.name || t('admin.active_org_fallback', 'Organisasi Aktif')}
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-19">
              {t('admin.team_name_label', 'Nama Tim / Divisi')}
            </FieldLabel>
            <Input id="adminmodals-field-19"
              type="text"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); setErrorMsg(null); }}
              placeholder={t('admin.contoh_procurement_vendor_sourcing', 'Contoh: Procurement & Vendor Sourcing')}
              className="w-full"
            />
          </Field>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={() => { setErrorMsg(null); onClose(); }}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.creating', 'Membuat...') : t('admin.btn_create_team', 'Buat Tim')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Edit department / team modal
interface EditDepartmentModalProps {
  isOpen: boolean;
  team: ConsoleTeam | null;
  onClose: () => void;
  onSubmit: (teamId: string, name: string) => Promise<void>;
  onDelete?: (team: ConsoleTeam) => void;
}

export const EditDepartmentModal: React.FC<EditDepartmentModalProps> = ({
  isOpen,
  team,
  onClose,
  onSubmit,
  onDelete,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name || '');
      setErrorMsg(null);
    }
  }, [team]);

  if (!isOpen || !team) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onSubmit(team.id, name.trim());
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || t('admin.gagal_menyimpan_perubahan_departemen', 'Gagal menyimpan perubahan departemen'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-status-warning-soft border border-status-warning-border flex items-center justify-center text-status-warning">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {t('admin.edit_department_title', 'Edit Tim / Departemen')}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {team.name}
              </p>
            </div>
          </div>
          <Button variant="secondary" size="icon-sm" aria-label={t('common.close', 'Tutup')}
            type="button"
            onClick={() => { setErrorMsg(null); onClose(); }}
          >
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <Alert status="error" role="alert">
              <AlertContent>{errorMsg}</AlertContent>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="adminmodals-field-20">
              {t('admin.team_name_label', 'Nama Tim / Divisi')}
            </FieldLabel>
            <Input id="adminmodals-field-20"
              type="text"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); setErrorMsg(null); }}
              className="w-full"
            />
          </Field>

          <Card className="p-3 text-xs space-y-1">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.col_members', 'Jumlah Anggota')}:</span>
              <span className="font-semibold text-foreground">{team.members.length}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.id_tim', 'ID Tim:')}</span>
              <code className="font-mono text-muted-foreground">{team.id}</code>
            </div>
          </Card>

          <div className="pt-2 flex items-center justify-between gap-2">
            {onDelete ? (
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => {
                  onClose();
                  onDelete(team);
                }}
                className="text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('admin.btn_delete', 'Hapus')}</span>
              </Button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <Button variant="ghost"
                type="button"
                onClick={() => { setErrorMsg(null); onClose(); }}
              >
                {t('admin.btn_cancel', 'Batal')}
              </Button>
              <Button variant="ghost"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('admin.saving', 'Menyimpan...') : t('admin.btn_save_changes', 'Simpan Perubahan')}
              </Button>
            </div>
          </div>
        </form>

    </ModalFrame>
  );
};

// Delete department / team modal
interface DeleteDepartmentModalProps {
  isOpen: boolean;
  team: ConsoleTeam | null;
  onClose: () => void;
  onConfirm: (team: ConsoleTeam) => Promise<void>;
}

export const DeleteDepartmentModal: React.FC<DeleteDepartmentModalProps> = ({
  isOpen,
  team,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !team) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm(team);
      onClose();
    } catch (err: any) {
      setError(err.message || t('admin.toast.delete_department_failed', 'Gagal menghapus departemen.'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-status-danger-soft flex items-center justify-center text-status-danger">
              <Trash2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {t('admin.delete_department_title', 'Hapus Departemen / Tim')}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {team.name}
              </p>
            </div>
          </div>
          <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
        </DialogHeader>

        <div className="p-5 space-y-4">
          {error && (
            <Alert status="error" role="alert">
              <AlertContent>{error}</AlertContent>
            </Alert>
          )}

          <div className="p-3 rounded-lg bg-status-danger-soft border border-status-danger-border text-xs text-status-danger flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{t('admin.delete_department_confirm_msg', 'Apakah Anda yakin ingin menghapus departemen ini secara permanen?')}</p>
              <p className="mt-1 text-xs opacity-90">
                {t('admin.delete_department_warning', 'Tindakan ini tidak dapat dibatalkan. Seluruh anggota dalam departemen ini akan dilepaskan dari penugasan tim.')}
              </p>
            </div>
          </div>

          <Card className="p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.team_name_label', 'Nama Departemen')}:</span>
              <span className="font-semibold text-foreground">{team.name}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.department_members_count', 'Jumlah Anggota')}:</span>
              <span className="font-medium text-foreground">
                {team.members?.length || 0} {t('admin.team_members', 'Anggota')}
              </span>
            </div>
            {team.organizationName && (
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>{t('admin.col_org', 'Organisasi')}:</span>
                <span className="text-foreground">{team.organizationName}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('admin.id', 'ID:')}</span>
              <code className="font-mono text-muted-foreground">{team.id}</code>
            </div>
          </Card>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="destructive"
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isDeleting ? t('admin.deleting', 'Menghapus...') : t('admin.btn_confirm_delete_department', 'Hapus Departemen')}</span>
            </Button>
          </div>
        </div>

    </ModalFrame>
  );
};

// Add team member modal
interface AddTeamMemberModalProps {
  team: ConsoleTeam | null;
  users: ConsoleUser[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (teamId: string, userId: string) => Promise<void>;
}

export const AddTeamMemberModal: React.FC<AddTeamMemberModalProps> = ({
  team,
  users,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !team) return null;

  // Filter out users already in team
  const availableUsers = users.filter(
    (u) => !team.members.some((m) => m.userId === u.id)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setIsSubmitting(true);
    try {
      await onSubmit(team.id, selectedUserId);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent-foreground" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_add_team_member', 'Tambah Anggota ke Tim')}
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <div className="text-xs text-muted-foreground">{t('admin.target_team', 'Tim Tujuan')}:</div>
            <div className="font-semibold text-sm text-foreground">{team.name}</div>
          </div>

          <div>
            <label htmlFor="adminmodals-field-21" className="block text-xs font-medium text-foreground mb-1">
              {t('admin.select_user', 'Pilih Pengguna')}
            </label>
            {availableUsers.length === 0 ? (
              <div className="text-xs text-muted-foreground p-3 bg-card rounded-lg">
                {t('admin.all_users_in_team', 'Semua pengguna yang terdaftar sudah tergabung dalam tim ini.')}
              </div>
            ) : (
              <AlphabeticalSelect id="adminmodals-field-21"
                required
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full" controlProps={{ className: "w-full" }}
              >
                <option value="">{t('admin.select_user_ph', 'Pilih pengguna...')}</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email}) - {u.role.toUpperCase()}
                  </option>
                ))}
              </AlphabeticalSelect>
            )}
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting || !selectedUserId}
            >
              {isSubmitting ? t('admin.adding', 'Menambahkan...') : t('admin.btn_add', 'Tambahkan')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Invite member modal
interface InviteMemberModalProps {
  isOpen: boolean;
  activeOrg: ConsoleOrganization | null;
  teams: ConsoleTeam[];
  onClose: () => void;
  onSubmit: (data: { email: string; role: string; teamId?: string }) => Promise<void>;
}

export const InviteMemberModal: React.FC<InviteMemberModalProps> = ({
  isOpen,
  activeOrg,
  teams,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [teamId, setTeamId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    try {
      await onSubmit({ email: email.trim().toLowerCase(), role, teamId: teamId || undefined });
      setEmail('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-accent-foreground" />
            <DialogTitle className="flex items-center gap-2">
              {t('admin.modal_create_inv', 'Undang Anggota Organisasi')}
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('redline.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <Card className="p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-accent-foreground" />
              <span>{t('admin.pengiriman_via_email_smtp_relay', 'Pengiriman via Email (SMTP Relay)')}</span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('admin.undangan_akan_dikirimkan_langsung_ke_inbox', 'Undangan akan dikirimkan langsung ke inbox email calon anggota menggunakan server SMTP yang terkonfigurasi.')}
            </p>
          </Card>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-22">
              {t('admin.col_user_email', 'Email Rekan Kerja')}
            </FieldLabel>
            <Input id="adminmodals-field-22"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('admin.colleague_example_com', 'colleague@example.com')}
              className="w-full"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-23">
              {t('admin.inv_col_role', 'Peran Diminta')}
            </FieldLabel>
            <AlphabeticalSelect id="adminmodals-field-23"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full" controlProps={{ className: "w-full" }}
            >
              <option value="superuser">{t('admin.superuser_system_level', 'Superuser (System Level)')}</option>
              <option value="admin">{t('admin.admin_global_level', 'Admin (Global Level)')}</option>
              <option value="manager">{t('admin.manager_group_approval', 'Manager (Group Approval)')}</option>
              <option value="editor">{t('admin.editor_group_draft_upload', 'Editor (Group Draft & Upload)')}</option>
              <option value="viewer">{t('admin.viewer_read_only_final', 'Viewer (Read-Only Final)')}</option>
            </AlphabeticalSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor="adminmodals-field-24">
              {t('admin.team_optional_label', 'Divisi / Tim (Opsional)')}
            </FieldLabel>
            <AlphabeticalSelect id="adminmodals-field-24"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full" controlProps={{ className: "w-full" }}
            >
              <option value="">{t('admin.no_specific_team', 'Tanpa tim khusus')}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </AlphabeticalSelect>
          </Field>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="ghost"
              type="button"
              onClick={onClose}
            >
              {t('admin.btn_cancel', 'Batal')}
            </Button>
            <Button variant="ghost"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('admin.sending', 'Mengirim...') : t('admin.btn_send_inv', 'Kirim Undangan')}
            </Button>
          </div>
        </form>

    </ModalFrame>
  );
};

// Generate API key modal
interface GenerateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; scopes: string[] }) => Promise<{ secret: string }>;
}

export const GenerateApiKeyModal: React.FC<GenerateApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'contract:read',
    'partner:read',
  ]);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const availableScopes = [
    { id: 'contract:read', label: t('admin.scope_contract_read', 'Baca Data Kontrak') },
    { id: 'contract:write', label: t('admin.scope_contract_write', 'Buat & Edit Kontrak') },
    { id: 'partner:read', label: t('admin.scope_partner_read', 'Baca Direktori Mitra/Vendor') },
    { id: 'partner:write', label: t('admin.scope_partner_write', 'Kelola Profil & DD Vendor') },
    { id: 'report:read', label: t('admin.scope_report_read', 'Ekspor Laporan Keuangan') },
  ];

  const handleToggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError('');
    try {
      const res = await onSubmit({ name: name.trim(), scopes: selectedScopes });
      setGeneratedSecret(res.secret);
    } catch (err: any) {
      setError(err?.message || t('admin.toast.generate_key_failed', 'Gagal membuat API Key'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (generatedSecret) {
      try {
        await navigator.clipboard.writeText(generatedSecret);
        setError('');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError(t('admin.copy_failed', 'API Secret tidak dapat disalin.'));
      }
    }
  };

  const handleFinish = () => {
    setGeneratedSecret(null);
    setName('');
    setError('');
    onClose();
  };

  return (
    <ModalFrame onClose={handleFinish} className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 max-h-[92dvh] overflow-y-auto">

        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-status-info" />
            <DialogTitle className="flex items-center gap-2">
              {generatedSecret
                ? t('admin.key_generated_success', 'API Key Berhasil Dibuat')
                : t('admin.modal_gen_key', 'Generate API Key Baru')}
            </DialogTitle>
          </div>
          <Button variant="ghost" size="icon-sm" type="button" onClick={handleFinish} aria-label={t('redline.close', 'Tutup')}>
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>

        {error && (
          <Alert status="error" role="alert">
            <AlertContent>{error}</AlertContent>
          </Alert>
        )}

        {generatedSecret ? (
          <div className="p-5 space-y-4">
            <div className="p-3 rounded-lg bg-status-warning-soft border border-status-warning-border text-xs text-status-warning flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>{t('admin.key_save_now', 'Simpan kunci ini sekarang!')}</strong> {t('admin.key_copy_warn', 'Kunci rahasia ini hanya ditampilkan sekali demi keamanan.')}
              </div>
            </div>

            <div>
              <label htmlFor="adminmodals-field-25" className="block text-xs font-medium text-foreground mb-1">
                {t('admin.api_secret_label', 'API Secret Key')}
              </label>
              <div className="flex items-center gap-2">
                <Input id="adminmodals-field-25"
                  type="text"
                  readOnly
                  value={generatedSecret}
                  className="w-full"
                />
                <Button variant="ghost"
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? t('admin.copied', 'Tersalin') : t('admin.copy', 'Salin')}
                </Button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button variant="ghost"
                type="button"
                onClick={handleFinish}
              >
                {t('admin.done', 'Selesai')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <Field>
              <FieldLabel htmlFor="adminmodals-field-26">
                {t('admin.api_name_label', 'Nama Kunci / Sistem Pengguna')}
              </FieldLabel>
              <Input id="adminmodals-field-26"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('admin.contoh_erp_sap_integration_bot_webhook', 'Contoh: ERP SAP Integration / Bot Webhook')}
                className="w-full"
              />
            </Field>

            <div>
              <label className="block text-xs font-medium text-foreground mb-2">
                {t('admin.api_col_scopes', 'Cakupan Izin (Permission Scopes)')}
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {availableScopes.map((scope) => (
                  <Checkbox checked={selectedScopes.includes(scope.id)} onCheckedChange={() => handleToggleScope(scope.id)}><CheckboxControl /><CheckboxLabel><div>
                      <div className="font-medium text-foreground font-mono text-xs">
                        {scope.id}
                      </div>
                      <div className="text-xs text-muted-foreground">{scope.label}</div>
                    </div></CheckboxLabel><CheckboxHiddenInput /></Checkbox>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button variant="ghost"
                type="button"
                onClick={handleFinish}
              >
                {t('admin.btn_cancel', 'Batal')}
              </Button>
              <Button variant="ghost"
                type="submit"
                disabled={isSubmitting || selectedScopes.length === 0}
              >
                {isSubmitting ? t('admin.creating', 'Membuat...') : t('admin.api_generate_btn', 'Generate Kunci')}
              </Button>
            </div>
          </form>
        )}

    </ModalFrame>
  );
};
