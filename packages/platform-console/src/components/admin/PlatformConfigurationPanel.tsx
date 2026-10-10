import { ModalFrame, ModalTitle } from '../ui/modal-frame';
import React, { useState, useEffect, useRef } from 'react';
import { GoogleSheetsConfig, Tenant } from '@legalio/types';
import { useAuth } from '../../context/AuthContext';
import { GoogleCredentialsDialog } from '../settings/GoogleCredentialsDialog';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { getAuthHeaders } from '../../lib/apiFetch';
import { UITextManagerModal } from '../UITextManagerModal';
import { SQLiteDatabaseCard } from '../SQLiteDatabaseCard';
import { AiIcon } from '../icons/AiIcon';
import {
  Globe2,
  FileSpreadsheet,
  Folder,
  Save,
  RefreshCw,
  CheckCircle2,
  Database,
  Search,
  ExternalLink,
  LogOut,
  Sparkles,
  AlertCircle,
  Lock,
  Unlock,
  ShieldCheck,
  RotateCcw,
  Download,
  Upload,
  Languages,
  FileText,
  Mail,
  Bell,
  Cpu,
  Zap,
  ShieldAlert,
  Check,
  Copy,
  X,
  Key,
  Eye,
  EyeOff,
  Trash2,
  Building2,
  FolderPlus,
  FolderSync,
  Layers,
  HardDrive,
} from 'lucide-react';
import {
  signInWithGoogle,
  logoutGoogle,
  createNewSpreadsheet,
  createNewDriveFolder,
  fetchUserSpreadsheets,
  fetchUserFolders,
  getSavedGoogleUser,
  onGoogleAuthStateChange,
  isGoogleTokenValid,
  invalidateGoogleToken,
  silentRefreshGoogleToken,
  DriveFileItem,
  getCachedAccessToken,
} from '../../lib/googleAuthService';
import { cn } from '@legalio/ui-components/utils';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Separator } from '@legalio/ui-components/separator';
import { ResetWorkspaceDialog } from '../settings/ResetWorkspaceDialog';
import { clearSelection } from '../../lib/organizationSelection';

export type PlatformConfigurationSection = 'google' | 'ai' | 'notifications' | 'language' | 'security';

const EMPTY_CONFIG: GoogleSheetsConfig = { driveFolderId: '', spreadsheetId: '', isConnected: false, autoSync: false };

/**
 * System Admin configuration pages (PRD §6.6): deployment-wide Google
 * credentials and master resources, AI provider/model, SMTP relay, the
 * browser-local UI text tool, SQLite maintenance and the application-wide
 * reset. Platform-only; secrets are write-only and never prefilled.
 * Organization-specific settings live in each organization's Settings.
 */
export const PlatformConfigurationPanel: React.FC<{ activeSection?: PlatformConfigurationSection }> = ({ activeSection = 'google' }) => {
  const { user } = useAuth();
  // Mounted only inside System Admin for platform administrators; the server enforces it too.
  const isAdmin = true;
  const isSuperuser = true;
  const { language, t, exportToCSV, importFromCSV, resetCustomTranslations, translationsBusy, translationsError } = useLanguage();
  const confirmDialog = useConfirm();
  const [config, setConfig] = useState<GoogleSheetsConfig>(EMPTY_CONFIG);

  const loadConfig = async () => {
    const res = await fetch('/api/google-integration', { cache: 'no-store' });
    if (res.ok) setConfig({ ...EMPTY_CONFIG, ...(await res.json()) });
  };
  useEffect(() => { void loadConfig(); }, []);

  /** Platform fields only; organization recipients/mappings are not part of this payload. */
  const onSaveConfig = async (
    spreadsheetId: string,
    driveFolderId: string,
    _autoSync: boolean,
    _isLocked?: boolean,
    extraConfig: Partial<GoogleSheetsConfig> = {},
  ) => {
    const allowed = ['masterSpreadsheetId', 'aiModel', 'geminiApiKey', 'smtpEnabled', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPassword', 'smtpFromEmail', 'smtpFromName'];
    const extras = Object.fromEntries(Object.entries(extraConfig).filter(([key, value]) => allowed.includes(key) && value !== undefined));
    const res = await fetch('/api/google-integration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId: spreadsheetId || null, driveFolderId: driveFolderId || null, ...extras }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || data?.error || t('app.gagal_menyimpan_konfigurasi', 'Gagal menyimpan konfigurasi.'));
    await loadConfig();
  };

  // Organization projections refresh after platform provisioning changes.
  const refreshTenants = async () => { window.dispatchEvent(new CustomEvent('organization-updated')); };

  /** Google synchronization is a placeholder in this release (PRD §6.5). */
  const onSyncNow = async (_mode?: 'fetch' | 'push') => {
    throw new Error(t('tb.sync_unavailable_short', 'Google synchronization is not available in this release.'));
  };

  // Form State
  const [spreadsheetId, setSpreadsheetId] = useState(config.spreadsheetId || '');
  const [masterSpreadsheetId, setMasterSpreadsheetId] = useState(config.masterSpreadsheetId || '');
  const [driveFolderId, setDriveFolderId] = useState(config.driveFolderId || '');
  const [autoSync, setAutoSync] = useState(config.autoSync ?? true);
  const [isLocked, setIsLocked] = useState<boolean>(config.isLocked ?? true);
  const [notificationEmails, setNotificationEmails] = useState(
    config.notificationEmails || ''
  );
  const [legalNotificationEmail, setLegalNotificationEmail] = useState(
    config.legalNotificationEmail || ''
  );
  const [financeNotificationEmail, setFinanceNotificationEmail] = useState(
    config.financeNotificationEmail || ''
  );
  const [aiModel, setAiModel] = useState<string>(config.aiModel || 'gemini-3.8-flash');
  const [savingAiModel, setSavingAiModel] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>(config.geminiApiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [testingApiKey, setTestingApiKey] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // SMTP Relay State
  const [smtpEnabled, setSmtpEnabled] = useState<boolean>(config.smtpEnabled ?? false);
  const [smtpHost, setSmtpHost] = useState<string>(config.smtpHost || '');
  const [smtpPort, setSmtpPort] = useState<number>(config.smtpPort || 465);
  const [smtpSecure, setSmtpSecure] = useState<boolean>(config.smtpSecure ?? true);
  const [smtpUser, setSmtpUser] = useState<string>(config.smtpUser || '');
  const [smtpPassword, setSmtpPassword] = useState<string>(config.smtpPassword || '');
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [smtpFromEmail, setSmtpFromEmail] = useState<string>(config.smtpFromEmail || '');
  const [smtpFromName, setSmtpFromName] = useState<string>(config.smtpFromName || 'Sistem Notifikasi Kontrak & IO');
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testSmtpRecipient, setTestSmtpRecipient] = useState<string>('');
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Google Option Mode State
  const [selectedOptionTab, setSelectedOptionTab] = useState<'auto' | 'picker' | 'manual'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('google_connection_mode');
      if (saved === 'auto' || saved === 'picker' || saved === 'manual') {
        return saved as 'auto' | 'picker' | 'manual';
      }
    }
    return 'manual';
  });

  const [saving, setSaving] = useState(false);
  const [savingNotifEmails, setSavingNotifEmails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [resettingData, setResettingData] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState('');
  const [showEditConfirmModal, setShowEditConfirmModal] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [isOrgEditUnlocked, setIsOrgEditUnlocked] = useState(false);
  const [showUITextModal, setShowUITextModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyLink = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const handleComprehensiveSyncAll = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      // Platform service authority: every organization's folder, then partner category folders.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers['x-google-access-token'] = accessToken;
      await fetch('/api/tenants/auto-provision-folders', { method: 'POST', headers, credentials: 'include' });
      await fetch('/api/google-integration/provision-folders', { method: 'POST', headers }).catch((e) => console.warn('Category provision warning:', e));
      window.dispatchEvent(new CustomEvent('organization-updated'));
      setSuccessMsg(t('settings.berhasil_menyinkronkan_seluruh_data_sheet_folder', 'Berhasil menyinkronkan seluruh data sheet, folder organisasi, dan file ke Master Root!'));
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyinkronkan_data_dan_folder', 'Gagal menyinkronkan data dan folder.'));
    } finally {
      setSyncing(false);
    }
  };

  const textFileInputRef = useRef<HTMLInputElement>(null);


  // Track previous config to prevent overwriting user input during polling
  const prevConfigRef = useRef(config);

  // Sync internal states when config updates from server
  useEffect(() => {
    const prev = prevConfigRef.current;
    if (config.spreadsheetId !== prev.spreadsheetId && config.spreadsheetId !== undefined) setSpreadsheetId(config.spreadsheetId);
    if (config.masterSpreadsheetId !== prev.masterSpreadsheetId && config.masterSpreadsheetId !== undefined) setMasterSpreadsheetId(config.masterSpreadsheetId);
    if (config.driveFolderId !== prev.driveFolderId && config.driveFolderId !== undefined) setDriveFolderId(config.driveFolderId);
    if (config.autoSync !== prev.autoSync && config.autoSync !== undefined) setAutoSync(config.autoSync);
    if (config.isLocked !== prev.isLocked && config.isLocked !== undefined) setIsLocked(config.isLocked);
    if (config.notificationEmails !== prev.notificationEmails && config.notificationEmails !== undefined) setNotificationEmails(config.notificationEmails);
    if (config.legalNotificationEmail !== prev.legalNotificationEmail && config.legalNotificationEmail !== undefined) setLegalNotificationEmail(config.legalNotificationEmail);
    if (config.financeNotificationEmail !== prev.financeNotificationEmail && config.financeNotificationEmail !== undefined) setFinanceNotificationEmail(config.financeNotificationEmail);
    if (config.aiModel !== prev.aiModel && config.aiModel !== undefined) setAiModel(config.aiModel);
    if (config.geminiApiKey !== prev.geminiApiKey && config.geminiApiKey !== undefined) setGeminiApiKey(config.geminiApiKey);
    if (config.smtpEnabled !== prev.smtpEnabled && config.smtpEnabled !== undefined) setSmtpEnabled(config.smtpEnabled);
    if (config.smtpHost !== prev.smtpHost && config.smtpHost !== undefined) setSmtpHost(config.smtpHost);
    if (config.smtpPort !== prev.smtpPort && config.smtpPort !== undefined) setSmtpPort(config.smtpPort);
    if (config.smtpSecure !== prev.smtpSecure && config.smtpSecure !== undefined) setSmtpSecure(config.smtpSecure);
    if (config.smtpUser !== prev.smtpUser && config.smtpUser !== undefined) setSmtpUser(config.smtpUser);
    if (config.smtpPassword !== prev.smtpPassword && config.smtpPassword !== undefined) setSmtpPassword(config.smtpPassword);
    if (config.smtpFromEmail !== prev.smtpFromEmail && config.smtpFromEmail !== undefined) setSmtpFromEmail(config.smtpFromEmail);
    if (config.smtpFromName !== prev.smtpFromName && config.smtpFromName !== undefined) setSmtpFromName(config.smtpFromName);

    prevConfigRef.current = config;
  }, [config]);

  // Google OAuth & Auto Connect State
  const [googleUser, setGoogleUser] = useState<{ email: string; name: string; photoURL?: string } | null>(
    getSavedGoogleUser()
  );
  const [accessToken, setAccessToken] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('google_access_token') : null
  );
  const [connectingAuth, setConnectingAuth] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);

  // Auto-restore Google Login Session
  useEffect(() => {
    const unsubscribe = onGoogleAuthStateChange((profile, token) => {
      if (profile) setGoogleUser(profile);
      if (token) setAccessToken(token);
    });
    return () => unsubscribe();
  }, []);

  // Drive Picker Modal State
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerType, setPickerType] = useState<'spreadsheet' | 'folder'>('spreadsheet');
  const [driveItems, setDriveItems] = useState<DriveFileItem[]>([]);
  const [loadingPickerItems, setLoadingPickerItems] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const isTokenActive =
    Boolean(googleUser) && Boolean(accessToken) && isGoogleTokenValid();

  const handleGoogleConnect = async () => {
    setConnectingAuth(true);
    setErrorMsg(null);
    try {
      const { profile, accessToken: token } = await signInWithGoogle();
      setGoogleUser(profile);
      setAccessToken(token);

      // Sinkronisasi otomatis status isConnected dan token ke konfigurasi server
      try {
        const headers = getAuthHeaders();
        if (token) headers['x-google-access-token'] = token;
        const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('google_refresh_token') : null;
        await fetch('/api/google-integration/connect', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            accessToken: token,
            refreshToken,
            googleUser: profile,
          }),
        });
      } catch (syncErr) {
        console.warn('[Google Connect] Gagal menyinkronkan token ke server:', syncErr);
      }

      setSuccessMsg(t('settings.berhasil_terhubung_secara_otomatis_dengan_akun', 'Berhasil terhubung secara otomatis dengan akun Google: {email}', { email: profile.email }));
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menghubungkan_akun_google', 'Gagal menghubungkan akun Google.'));
    } finally {
      setConnectingAuth(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      // Pemutusan akun yang bersih: update server database
      try {
        const headers = getAuthHeaders();
        await fetch('/api/google-integration/disconnect', {
          method: 'POST',
          headers,
          credentials: 'include',
        });
      } catch (discErr) {
        console.warn('[Google Disconnect] Gagal mengirim permintaan disconnect ke server:', discErr);
      }

      await logoutGoogle();
      invalidateGoogleToken();
      setGoogleUser(null);
      setAccessToken(null);
      setSuccessMsg(t('settings.akun_google_berhasil_diputuskan', 'Akun Google berhasil diputuskan.'));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_memutuskan_akun_google', 'Gagal memutuskan akun Google.'));
    }
  };

  const handleGoogleRefresh = async () => {
    setConnectingAuth(true);
    setErrorMsg(null);
    try {
      const { profile, accessToken: token } = await silentRefreshGoogleToken();
      setGoogleUser(profile);
      setAccessToken(token);

      // Sinkronisasi otomatis token hasil refresh ke server
      try {
        const headers = getAuthHeaders();
        if (token) headers['x-google-access-token'] = token;
        const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('google_refresh_token') : null;
        await fetch('/api/google-integration/connect', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            accessToken: token,
            refreshToken,
            googleUser: profile,
          }),
        });
      } catch (syncErr) {
        console.warn('[Google Refresh] Gagal menyinkronkan token ke server:', syncErr);
      }

      setSuccessMsg(t('settings.sesi_google_berhasil_diperbarui_untuk', 'Sesi Google berhasil diperbarui untuk {email}', { email: profile.email }));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_memperbarui_sesi_google', 'Gagal memperbarui sesi Google.'));
    } finally {
      setConnectingAuth(false);
    }
  };

  const handleAutoProvisionMaster = async () => {
    if (!isAdmin) return;
    const token = getCachedAccessToken();
    if (!token && !isGoogleTokenValid()) {
      setErrorMsg(t('settings.sesi_google_belum_aktif_hubungkan_akun', 'Sesi Google belum aktif. Hubungkan akun Google terlebih dahulu.'));
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const headers = getAuthHeaders();
      if (token) headers['x-google-access-token'] = token;

      const res = await fetch('/api/google-integration/auto-provision-master', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ accessToken: token }),
      });

      let data: any = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) {
          throw new Error(
            res.status === 403
              ? t('settings.akses_ditolak_hanya_admin_superuser_yang', 'Akses ditolak: Hanya Admin/Superuser yang berhak membuat Master Root.')
              : t('settings.gagal_memproses_permintaan_http', 'Gagal memproses permintaan (HTTP {status}): {value}', { status: res.status, value: text.slice(0, 150) || 'Server error' })
          );
        }
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || t('settings.gagal_membuat_master_root_secara_otomatis', 'Gagal membuat Master Root secara otomatis.'));
      }

      setDriveFolderId(data.driveFolderId);
      setSpreadsheetId(data.spreadsheetId);
      if (data.masterSpreadsheetId) setMasterSpreadsheetId(data.masterSpreadsheetId);
      setIsEditUnlocked(false);
      setSuccessMsg(data.message || t('settings.master_root_berhasil_dibuat', 'Master Root berhasil dibuat!'));

      // Trigger parent update
      await onSaveConfig(data.spreadsheetId, data.driveFolderId, autoSync, isLocked, {});

    } catch (err: any) {
      setErrorMsg(err.message || t('settings.terjadi_kesalahan_saat_memproses_pembuatan_maste', 'Terjadi kesalahan saat memproses pembuatan Master Root.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOption2Picker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_pengguna_dengan_role_admin_yang', 'Hanya pengguna dengan role Admin yang berhak menyimpan konfigurasi.'));
      return;
    }
    const targetFolderId = driveFolderId || config.driveFolderId || '';
    const targetMasterSheetId = masterSpreadsheetId || config.masterSpreadsheetId || '';
    const targetSheetId = spreadsheetId || config.spreadsheetId || '';
    if (!targetFolderId) {
      setErrorMsg(t('settings.silakan_pilih_folder_storage_dari_google', 'Silakan pilih Folder Storage dari Google Drive terlebih dahulu.'));
      return;
    }
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await onSaveConfig(targetSheetId, targetFolderId, autoSync, isLocked, {
        notificationEmails,
        legalNotificationEmail,
        financeNotificationEmail,
        aiModel,
        forceNewOrgResources: true,
        masterSpreadsheetId: targetMasterSheetId,
      } as any);
      setSelectedOptionTab('picker');
      if (typeof window !== 'undefined') {
        localStorage.setItem('google_connection_mode', 'picker');
      }
      setIsEditUnlocked(false);
      await refreshTenants();
      setSuccessMsg(t('settings.save_config_success_provisioned', 'Konfigurasi Master Root tersimpan, Folder Organisasi & Spreadsheet Database berhasil dibuat di Google Drive!'));
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyimpan_konfigurasi', 'Gagal menyimpan konfigurasi.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOption3Manual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_pengguna_dengan_role_admin_yang', 'Hanya pengguna dengan role Admin yang berhak menyimpan konfigurasi.'));
      return;
    }
    const targetFolderId = driveFolderId || config.driveFolderId || '';
    const targetSheetId = spreadsheetId || config.spreadsheetId || '';
    if (!targetFolderId) {
      setErrorMsg(t('settings.silakan_isi_id_folder_storage_google', 'Silakan isi ID Folder Storage Google Drive.'));
      return;
    }
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await onSaveConfig(targetSheetId, targetFolderId, autoSync, isLocked, {
        notificationEmails,
        legalNotificationEmail,
        financeNotificationEmail,
        aiModel,
        forceNewOrgResources: true,
      } as any);
      setSelectedOptionTab('manual');
      if (typeof window !== 'undefined') {
        localStorage.setItem('google_connection_mode', 'manual');
      }
      setIsEditUnlocked(false);
      await refreshTenants();
      setSuccessMsg(t('settings.save_config_success_provisioned', 'Konfigurasi Master Root tersimpan, Folder Organisasi & Spreadsheet Database berhasil dibuat di Google Drive!'));
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyimpan_konfigurasi', 'Gagal menyimpan konfigurasi.'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDrivePicker = async (type: 'spreadsheet' | 'folder') => {
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_admin_yang_berhak_memilih_file', 'Hanya Admin yang berhak memilih file/folder dari Google Drive.'));
      return;
    }
    if (!accessToken || !isGoogleTokenValid()) {
      setErrorMsg(
        t('settings.sesi_akun_google_belum_terhubung_atau', 'Sesi akun Google belum terhubung atau telah kadaluarsa. Silakan hubungkan akun Google terlebih dahulu.')
      );
      return;
    }

    setPickerType(type);
    setShowPickerModal(true);
    setLoadingPickerItems(true);
    setErrorMsg(null);

    try {
      if (type === 'spreadsheet') {
        const sheets = await fetchUserSpreadsheets(accessToken);
        setDriveItems(sheets);
      } else {
        const folders = await fetchUserFolders(accessToken);
        setDriveItems(folders);
      }
    } catch (err: any) {
      const msg = err.message || 'Gagal memuat item dari Google Drive.';
      setErrorMsg(msg);
      setShowPickerModal(false);
      if (err.status === 401 || err.status === 403 || msg.includes('401')) {
        setAccessToken(null);
      }
    } finally {
      setLoadingPickerItems(false);
    }
  };

  const handleSelectItem = (item: DriveFileItem) => {
    if (pickerType === 'spreadsheet') {
      setMasterSpreadsheetId(item.id);
      setSuccessMsg(t('settings.spreadsheet_dipilih', 'Spreadsheet \'{name}\' dipilih.', { name: item.name }));
    } else {
      setDriveFolderId(item.id);
      setSuccessMsg(t('settings.folder_dipilih', 'Folder \'{name}\' dipilih.', { name: item.name }));
    }
    setShowPickerModal(false);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleSaveNotificationEmails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_pengguna_dengan_role_admin_yang_2', 'Hanya pengguna dengan role Admin yang berhak mengubah email penerima notifikasi.'));
      return;
    }
    setSavingNotifEmails(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await onSaveConfig(spreadsheetId, driveFolderId, autoSync, isLocked, {
        notificationEmails,
        legalNotificationEmail,
        financeNotificationEmail,
        aiModel,
      });
      setSuccessMsg(t('settings.email_penerima_alert_notice_period_berhasil', 'Email penerima alert notice period berhasil disimpan!'));
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyimpan_email_notifikasi', 'Gagal menyimpan email notifikasi.'));
    } finally {
      setSavingNotifEmails(false);
    }
  };

  const handleSaveSmtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_admin_yang_berhak_mengubah_konfigurasi', 'Hanya Admin yang berhak mengubah konfigurasi SMTP Relay.'));
      return;
    }
    setSavingSmtp(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await onSaveConfig(spreadsheetId, driveFolderId, autoSync, isLocked, {
        notificationEmails,
        legalNotificationEmail,
        financeNotificationEmail,
        aiModel,
        geminiApiKey,
        smtpEnabled,
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || (smtpSecure ? 465 : 587),
        smtpSecure,
        smtpUser: smtpUser.trim(),
        smtpPassword,
        smtpFromEmail: smtpFromEmail.trim(),
        smtpFromName: smtpFromName.trim(),
      });
      setSuccessMsg(t('settings.konfigurasi_smtp_relay_berhasil_disimpan', 'Konfigurasi SMTP Relay berhasil disimpan!'));
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyimpan_konfigurasi_smtp_relay', 'Gagal menyimpan konfigurasi SMTP Relay.'));
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    const recipient = testSmtpRecipient.trim() || user?.email || '';
    if (!recipient) {
      setErrorMsg(t('settings.masukkan_email_penerima_uji_coba_terlebih', 'Masukkan email penerima uji coba terlebih dahulu.'));
      return;
    }
    if (!smtpHost.trim() || !smtpUser.trim()) {
      setErrorMsg(t('settings.harap_isi_smtp_host_dan_username', 'Harap isi SMTP Host dan Username sebelum melakukan pengujian.'));
      return;
    }
    setTestingSmtp(true);
    setSmtpTestResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/smtp/test', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          smtpHost: smtpHost.trim(),
          smtpPort: Number(smtpPort) || (smtpSecure ? 465 : 587),
          smtpSecure,
          smtpUser: smtpUser.trim(),
          smtpPassword,
          smtpFromEmail: smtpFromEmail.trim(),
          smtpFromName: smtpFromName.trim(),
          testRecipient: recipient,
        }),
      });
      let data: any = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) {
        throw new Error(data.error || t('settings.gagal_terhubung_ke_smtp_relay', 'Gagal terhubung ke SMTP Relay.'));
      }
      setSmtpTestResult({ success: true, message: data.message || t('settings.email_uji_coba_berhasil_dikirim', 'Email uji coba berhasil dikirim!') });
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message || t('settings.gagal_menguji_koneksi_smtp_relay', 'Gagal menguji koneksi SMTP Relay.') });
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleSaveAiModel = async (newModel: string) => {
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_admin_yang_berhak_mengubah_model', 'Hanya Admin yang berhak mengubah model AI default.'));
      return;
    }
    setSavingAiModel(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      setAiModel(newModel);
      await onSaveConfig(spreadsheetId, driveFolderId, autoSync, isLocked, {
        notificationEmails,
        legalNotificationEmail,
        financeNotificationEmail,
        aiModel: newModel,
      });
      setSuccessMsg(t('settings.model_ai_sistem_berhasil_diperbarui_ke', 'Model AI sistem berhasil diperbarui ke \'{newModel}\'!', { newModel }));
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyimpan_model_ai', 'Gagal menyimpan model AI.'));
    } finally {
      setSavingAiModel(false);
    }
  };

  const handleSaveApiKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_admin_yang_berhak_mengubah_gemini', 'Hanya Admin yang berhak mengubah Gemini API Key.'));
      return;
    }
    const cleanKey = geminiApiKey.trim();
    setSavingApiKey(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setApiTestResult(null);
    try {
      await onSaveConfig(spreadsheetId, driveFolderId, autoSync, isLocked, {
        notificationEmails,
        legalNotificationEmail,
        financeNotificationEmail,
        aiModel,
        geminiApiKey: cleanKey,
      });
      setSuccessMsg(t('settings.google_gemini_api_key_berhasil_disimpan', 'Google Gemini API Key berhasil disimpan dan diaktifkan!'));
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyimpan_gemini_api_key', 'Gagal menyimpan Gemini API Key.'));
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleTestApiKey = async () => {
    const keyToTest = geminiApiKey.trim();
    if (!keyToTest) {
      setErrorMsg(t('settings.masukkan_google_gemini_api_key_terlebih', 'Masukkan Google Gemini API Key terlebih dahulu untuk melakukan pengujian koneksi.'));
      return;
    }
    setTestingApiKey(true);
    setApiTestResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/ai/test-key', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey: keyToTest, model: aiModel || 'gemini-3.6-flash' }),
      });
      let data: any = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) {
        throw new Error(data.error || t('settings.gagal_terhubung_ke_google_gemini_api', 'Gagal terhubung ke Google Gemini API.'));
      }
      setApiTestResult({ success: true, message: data.message || t('settings.koneksi_ke_google_gemini_api_berhasil', 'Koneksi ke Google Gemini API berhasil!') });
    } catch (err: any) {
      setApiTestResult({ success: false, message: err.message || t('settings.gagal_terhubung_ke_google_gemini_api', 'Gagal terhubung ke Google Gemini API.') });
    } finally {
      setTestingApiKey(false);
    }
  };

  const handleProvisionFolders = async () => {
    if (!isAdmin) {
      setErrorMsg(t('settings.hanya_admin_yang_berhak_menjalankan_sinkronisasi', 'Hanya Admin yang berhak menjalankan sinkronisasi folder kategori.'));
      return;
    }
    setProvisioning(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const token = getCachedAccessToken();
      const sessionToken = typeof window !== 'undefined' ? localStorage.getItem('auth_session_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['x-google-access-token'] = token;
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
        headers['x-session-token'] = sessionToken;
      }

      const res = await fetch('/api/google-integration/provision-folders', {
        method: 'POST',
        headers,
      });
      let data: any = {};
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(data.error || t('settings.gagal_sinkronisasi_folder_status', 'Gagal sinkronisasi folder (Status {status})', { status: res.status }));

      setSuccessMsg(
        t('settings.4_subfolder_kategori_contract_invoice_billing', '4 Subfolder Kategori (Contract, Invoice/Billing, IO, DD) berhasil dibuat/diperbarui untuk seluruh Partner!')
      );
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_membuat_folder_kategori', 'Gagal membuat folder kategori.'));
    } finally {
      setProvisioning(false);
    }
  };

  const handleSync = async (mode: 'fetch' | 'push' = 'fetch') => {
    setSyncing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await onSyncNow(mode);
      setSuccessMsg(
        mode === 'push'
          ? t('settings.sync_push_success', 'Berhasil menyimpan data ke Google Sheet!')
          : t('settings.sync_fetch_success', 'Berhasil menarik data dari Google Sheet!')
      );
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_sinkronisasi_dengan_google_sheet', 'Gagal sinkronisasi dengan Google Sheet.'));
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenResetModal = () => {
    if (!isSuperuser) {
      setErrorMsg(t('settings.reset_superuser_only', 'Only a superuser can reset the workspace.'));
      return;
    }
    setResetConfirmationText('');
    setShowResetModal(true);
  };

  const handleQuickImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        const result = await importFromCSV(content);
        if (result.success) {
          setSuccessMsg(t('settings.berhasil_mengimpor_memperbarui_teks_ui_dari', 'Berhasil mengimpor & memperbarui {updatedCount} teks UI dari file CSV!', { updatedCount: result.updatedCount }));
          setTimeout(() => setSuccessMsg(null), 5000);
        } else {
          setErrorMsg(result.error || t('settings.gagal_mengimpor_file_csv', 'Gagal mengimpor file CSV.'));
        }
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const filteredDriveItems = driveItems.filter((i) =>
    i.name.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  const sections: Array<{ id: PlatformConfigurationSection; label: string }> = [
    { id: 'google', label: t('tb.config_google', 'Google & storage') },
    { id: 'ai', label: t('settings.nav_ai', 'AI Model & Parser') },
    { id: 'notifications', label: t('tb.config_smtp', 'SMTP relay') },
    { id: 'language', label: t('tb.config_texts_short', 'UI texts') },
    { id: 'security', label: t('tb.config_maintenance', 'Database & reset') },
  ];
  const activeSectionLabel = sections.find((section) => section.id === activeSection)?.label || sections[0].label;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      {/* Header */}
      <div className="ds-page-bar">
        <div>
          <h2 className="ds-page-heading">
            <span>{activeSectionLabel}</span>
          </h2>
        </div>
      </div>

      {/* Global Alerts for Settings */}
      {successMsg && (
        <div className="p-3 bg-status-success/10 border border-status-success-border/20 text-status-success rounded-2xl text-xs font-medium flex items-center justify-between animate-in fade-in-50">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="inline-flex items-center justify-center size-8 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl text-xs font-medium flex items-center justify-between animate-in fade-in-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="inline-flex items-center justify-center size-8 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Full-width Content Layout */}
      <div className="w-full space-y-6">
        {/* GROUP 1: GOOGLE INTEGRATION & DATABASE */}

          {activeSection === 'google' && (
            <div className="space-y-6">
              {/* Google OAuth Account Card */}
              <Card className="overflow-hidden">
                <CardHeader className="">
                  <CardTitle className="flex items-center justify-between">
                    <span>{t('settings.google_auth_title', 'Autentikasi Akun Google Workspace')}</span>
                    {isTokenActive ? (
                      <Badge className="text-xs bg-accent-soft text-accent-text border-transparent hover:bg-accent-soft">
                        {t('settings.oauth_active', 'OAuth Aktif')}
                      </Badge>
                    ) : (
                      <Badge className="text-xs bg-surface-2 text-ink hover:bg-surface-2">
                        {t('settings.oauth_inactive', 'Belum Terhubung')}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="ds-panel flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/10 text-accent-text flex items-center justify-center font-bold text-sm shrink-0">
                        {googleUser?.name?.charAt(0) || 'G'}
                      </div>
                      <div>
                        <p className="font-semibold text-ink">
                          {googleUser ? googleUser.name : t('settings.no_google_connected', 'Belum Ada Akun Google Terhubung')}
                        </p>
                        {googleUser?.email && (
                          <p className="text-ink-soft font-mono text-xs">
                            {googleUser.email}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isTokenActive ? (
                        <>
                          <Button
                            variant="outline"
                            size="lg"
                            onClick={handleGoogleRefresh}
                            disabled={connectingAuth}
                            className="cursor-pointer"
                          >
                            <RefreshCw className={cn('w-3.5 h-3.5', connectingAuth && 'animate-spin')} />
                            <span>{t('settings.refresh_session', 'Refresh Sesi')}</span>
                          </Button>
                          <Button
                            variant="destructive-outline"
                            size="lg"
                            onClick={handleGoogleDisconnect}
                            className="cursor-pointer"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>{t('settings.disconnect', 'Putuskan')}</span>
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="lg"
                          onClick={handleGoogleConnect}
                          disabled={connectingAuth}
                          className="cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>{t('settings.connect_google_btn', 'Hubungkan Akun Google')}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>



              {/* Master Google Drive Storage Card (File Attachment Storage) */}
              {isAdmin && (
                <Card id="card-master-drive-org-database" className="overflow-hidden">
                  <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <Folder className="w-5 h-5 text-accent-text" />
                        <span>{t('settings.penyimpanan_file_dokumen_google_drive', 'Penyimpanan File Dokumen (Google Drive)')}</span>
                      </CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {driveFolderId ? (
                        <Badge variant="success" className="bg-status-success-soft text-status-success dark:bg-status-success-soft/40 border border-status-success-border text-xs font-semibold py-1 px-2.5 flex items-center gap-1.5 shadow-2xs">
                          <span className="size-2 rounded-full bg-accent animate-pulse" />
                          <span>{t('settings.folder_drive_terhubung', 'Folder Drive Terhubung')}</span>
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="bg-status-warning-soft text-status-warning dark:bg-status-warning-soft/40 border border-status-warning-border text-xs font-semibold py-1 px-2.5 flex items-center gap-1.5 shadow-2xs">
                          <AlertCircle className="size-3 text-status-warning" />
                          <span>{t('settings.not_configured', 'Belum Dikonfigurasi')}</span>
                        </Badge>
                      )}
                      {isAdmin && !isEditUnlocked && (
                        <Button
                          id="btn-edit-master-root"
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowEditConfirmModal(true)}
                          className="text-xs cursor-pointer shrink-0"
                        >
                          <Lock className="w-3 h-3 text-accent-text" />
                          <span>{t('settings.edit_config_btn', 'Ubah Konfigurasi')}</span>
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-3">
                      <div
                        id="master-storage-root-card"
                        className="ds-panel p-4 transition-all space-y-3"
                      >
                        {/* Master Storage Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-hairline dark:border-hairline/60">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="size-10 rounded-md flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs bg-accent-strong">
                              <Folder className="w-4 h-4 text-white" />
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-sm text-ink truncate">
                                  {t('settings.root_folder_title', 'Root Folder')}
                                </h4>
                                <Badge className="text-xs font-semibold py-0.5 px-2 bg-surface-2 border border-hairline text-ink-soft">
                                  {t('settings.root_drive', 'Root Drive')}
                                </Badge>
                              </div>
                              <p className="text-xs text-ink-soft truncate">
                                {t('settings.id', 'ID:')} <code className="font-mono text-xs text-ink-soft">{driveFolderId || '-'}</code>
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Read-Only or Edit Mode */}
                        {!isEditUnlocked ? (
                          <div className="ds-panel p-3 flex items-center justify-between gap-2.5">
                            <div className="min-w-0 flex-1 space-y-1">
                              <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                                <Folder className="w-3.5 h-3.5 text-accent-text shrink-0" />
                                <span className="truncate">{t('settings.master_root_id_label', 'Master Google Drive Storage Root Folder ID')}</span>
                              </span>
                              <p className="font-mono text-xs text-ink-soft truncate select-all">
                                {driveFolderId || '-'}
                              </p>
                            </div>
                            {driveFolderId && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleCopyLink(`https://drive.google.com/drive/folders/${driveFolderId}`, 'master-root')}
                                  title={t('common.copy_link', 'Salin Link')}
                                  className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft hover:text-ink dark:hover:text-ink hover:bg-surface-2/70 dark:hover:bg-surface-2 transition-colors cursor-pointer"
                                >
                                  {copiedKey === 'master-root' ? <Check className="w-3.5 h-3.5 text-accent-text" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                                <a href={`https://drive.google.com/drive/folders/${driveFolderId}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg text-ink-soft hover:text-ink dark:hover:text-ink hover:bg-surface-2/70 dark:hover:bg-surface-2 transition-colors inline-flex items-center">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Edit Mode View */
                          <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                            <div className="ds-panel inline-flex items-center p-1 text-xs font-medium">
                              <button
                                type="button"
                                onClick={() => setSelectedOptionTab('picker')}
                                className={cn(
                                  'px-3 min-h-8 rounded-md transition-all cursor-pointer font-semibold text-xs flex items-center gap-2',
                                  selectedOptionTab === 'picker'
                                    ? 'bg-surface text-ink dark:text-white shadow-xs font-semibold'
                                    : 'text-ink-soft hover:text-ink dark:hover:text-white'
                                )}
                              >
                                <Folder className="w-3.5 h-3.5 text-accent-text" />
                                <span>{t('settings.picker_tab', 'Pilih dari Google Drive')}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedOptionTab('manual')}
                                className={cn(
                                  'px-3 min-h-8 rounded-md transition-all cursor-pointer font-semibold text-xs flex items-center gap-2',
                                  selectedOptionTab === 'manual'
                                    ? 'bg-surface text-ink dark:text-white shadow-xs font-semibold'
                                    : 'text-ink-soft hover:text-ink dark:hover:text-white'
                                )}
                              >
                                <Folder className="w-3.5 h-3.5 text-accent-text" />
                                <span>{t('settings.manual_tab', 'Input Manual ID')}</span>
                              </button>
                            </div>

                            {selectedOptionTab === 'picker' && (
                              <form onSubmit={handleSaveOption2Picker} className="space-y-4">
                                <div className="ds-panel p-3.5 space-y-2">
                                  <label htmlFor="settingsview-field-1" className="block font-semibold text-ink">
                                    {t('settings.folder_google_drive_id', 'Folder Google Drive ID')}
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <input id="settingsview-field-1"
                                      type="text"
                                      readOnly
                                      value={driveFolderId || t('settings.no_folder_selected', 'Belum dipilih')}
                                      placeholder={t('settings.id_folder_drive', 'ID Folder Drive...')}
                                      className="ds-input flex-1"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="lg"
                                      onClick={() => handleOpenDrivePicker('folder')}
                                      disabled={!isTokenActive}
                                      className="text-xs cursor-pointer shrink-0"
                                    >
                                      {t('settings.pick_folder_btn', 'Pilih Folder')}
                                    </Button>
                                  </div>
                                </div>

                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="lg"
                                    onClick={() => {
                                      setDriveFolderId(config.driveFolderId || '');
                                      setIsEditUnlocked(false);
                                    }}
                                    className="text-xs cursor-pointer"
                                  >
                                    {t('settings.cancel_edit_btn', 'Batal')}
                                  </Button>
                                  <Button
                                    type="submit"
                                    size="lg"
                                    disabled={saving || !driveFolderId}
                                    className="cursor-pointer"
                                  >
                                    <Save className="w-3.5 h-3.5" />
                                    <span>{saving ? t('settings.saving_and_provisioning', 'Menyimpan...') : t('settings.save_config_btn', 'Simpan Konfigurasi')}</span>
                                  </Button>
                                </div>
                              </form>
                            )}

                            {selectedOptionTab === 'manual' && (
                              <form onSubmit={handleSaveOption3Manual} className="space-y-4">
                                <div>
                                  <label htmlFor="settingsview-field-2" className="block text-ink-soft font-semibold mb-1">
                                    {t('settings.master_root_id_label', 'Folder ID Google Drive')}
                                  </label>
                                  <input id="settingsview-field-2"
                                    type="text"
                                    value={driveFolderId}
                                    onChange={(e) => setDriveFolderId(e.target.value)}
                                    placeholder={t('settings.contoh_1xifivgwddtyezl7ioqvd9d_nas7xcfyp', 'Contoh: 1xiFIvgWdDtYEzL7IoqVD9d-NaS7XcfYp')}
                                    className="ds-input w-full"
                                    required
                                  />
                                </div>

                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="lg"
                                    onClick={() => {
                                      setDriveFolderId(config.driveFolderId || '');
                                      setIsEditUnlocked(false);
                                    }}
                                    className="text-xs cursor-pointer"
                                  >
                                    {t('settings.cancel_edit_btn', 'Batal')}
                                  </Button>
                                  <Button
                                    type="submit"
                                    size="lg"
                                    disabled={saving}
                                    className="cursor-pointer"
                                  >
                                    <Save className="w-3.5 h-3.5" />
                                    <span>{saving ? t('settings.saving_and_provisioning', 'Menyimpan...') : t('settings.save_config_btn', 'Simpan Konfigurasi')}</span>
                                  </Button>
                                </div>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                  </CardContent>
                </Card>
              )}

              {/* SQLite Database Status & Browser Card */}
              {isAdmin && <SQLiteDatabaseCard />}

              {/* Google Cloud Credentials */}
              {isSuperuser && (
                <div className="ds-panel flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                  <div>
                    <h4 className="text-sm font-bold text-ink">
                      {t('google_setup.settings_title', 'Kredensial Google Cloud')}
                    </h4>
                    <p className="text-xs text-ink-soft mt-0.5">
                      {t(
                        'google_setup.settings_desc',
                        'Unggah file JSON Service Account dan OAuth Client dari Google Cloud Console. Menggantikan variabel GOOGLE_* di .env.',
                      )}
                    </p>
                  </div>
                  <GoogleCredentialsDialog
                    trigger={
                      <Button type="button" size="lg" className="shrink-0">
                        {t('google_setup.manage', 'Kelola file kredensial')}
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          )}

          {/* GROUP 2: AI & SMART AUTOMATION */}
          {activeSection === 'ai' && (
            <div className="space-y-6">
              {/* CARD 1: GOOGLE GEMINI API KEY */}
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Key className="w-5 h-5 text-accent-text" />
                      <span>{t('settings.gemini_api_key_title', 'Google Gemini API Key')}</span>
                    </CardTitle>
                  </div>
                  <div>
                    {geminiApiKey ? (
                      <Badge variant="success" className="bg-status-success-soft text-status-success dark:bg-status-success-soft/40 border border-status-success-border text-xs font-semibold py-1 px-2.5 flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-status-success animate-pulse" />
                        <span>{t('settings.api_key_active', 'API Key Aktif')}</span>
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="bg-status-warning-soft text-status-warning dark:bg-status-warning-soft/40 border border-status-warning-border text-xs font-semibold py-1 px-2.5 flex items-center gap-1.5">
                        <AlertCircle className="size-3 text-status-warning" />
                        <span>{t('settings.api_key_empty', 'Belum Diatur')}</span>
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleSaveApiKey} className="space-y-3">
                    <div className="space-y-1.5">
                      <label htmlFor="settingsview-field-3" className="font-semibold text-ink flex items-center justify-between">
                        <span>{t('settings.gemini_api_key_label', 'Gemini API Key (AI Studio)')}</span>
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="min-h-6 text-xs text-accent-dark hover:underline flex items-center gap-1 font-normal"
                        >
                          <span>{t('settings.get_api_key_link', 'Dapatkan API Key di Google AI Studio')}</span>
                          <ExternalLink className="size-3" />
                        </a>
                      </label>
                      <div className="relative flex items-center">
                        <input id="settingsview-field-3"
                          type={showApiKey ? 'text' : 'password'}
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder={t('settings.gemini_api_key_ph', 'Masukkan Google Gemini API Key (misal: AIzaSy...)')}
                          className="ds-input w-full pl-4 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-3 text-ink-soft hover:text-ink-soft dark:hover:text-ink cursor-pointer"
                          title={showApiKey ? t('settings.sembunyikan', 'Sembunyikan') : t('settings.tampilkan', 'Tampilkan')}
                        >
                          {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Test Result Alert Box */}
                    {apiTestResult && (
                      <div
                        className={cn(
                          'p-3 rounded-xl border text-xs flex items-center gap-2 animate-in fade-in',
                          apiTestResult.success
                            ? 'bg-status-success-soft dark:bg-status-success-soft/30 border-status-success-border text-status-success '
                            : 'bg-status-danger-soft dark:bg-status-danger-soft/30 border-status-danger-border text-status-danger '
                        )}
                      >
                        {apiTestResult.success ? (
                          <CheckCircle2 className="size-4 text-status-success shrink-0" />
                        ) : (
                          <AlertCircle className="size-4 text-status-danger shrink-0" />
                        )}
                        <span>{apiTestResult.message}</span>
                      </div>
                    )}

                    <div className="mobile-page-actions flex flex-wrap items-center gap-2.5 pt-1">
                      <Button size="lg"
                        type="submit"
                        disabled={savingApiKey || !isAdmin}
                        className="cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingApiKey ? t('eval.btn_saving', 'Menyimpan...') : t('settings.save_api_key_btn', 'Simpan API Key')}</span>
                      </Button>

                      <Button size="lg"
                        type="button"
                        variant="outline"
                        onClick={handleTestApiKey}
                        disabled={testingApiKey || !geminiApiKey.trim()}
                        className="cursor-pointer"
                      >
                        <AiIcon className={cn('w-3.5 h-3.5 text-status-warning', testingApiKey && 'animate-spin')} />
                        <span>{testingApiKey ? t('admin.test_connection_testing', 'Menguji Koneksi...') : t('settings.test_api_key_btn', 'Uji Koneksi API')}</span>
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {/* CARD 2: MODEL AI SELECTION */}
              <Card className="overflow-hidden">
                <CardHeader className="">
                  <CardTitle className="flex items-center gap-2">
                    <AiIcon className="w-5 h-5 text-accent-text" />
                    <span>{t('settings.ai_config_title', 'Pilihan Model Google Gemini')}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    {[
                      {
                        id: 'gemini-3.8-flash',
                        title: t('settings.gemini_3_8_flash_default_rekomendasi', 'Gemini 3.8 Flash (Default Rekomendasi)'),
                        desc: t('settings.ekstraksi_dokumen_berkecepatan_tinggi_akurasi_ti', 'Ekstraksi dokumen berkecepatan tinggi, akurasi tinggi untuk tabel dan klausul legal.'),
                        badge: t('settings.tercepat_paling_akurat', 'Tercepat & Paling Akurat'),
                      },
                      {
                        id: 'gemini-3.7-flash',
                        title: t('settings.gemini_3_7_flash', 'Gemini 3.7 Flash'),
                        desc: t('settings.generasi_terbaru_multimodal_untuk_analisis_klaus', 'Generasi terbaru multimodal untuk analisis klausul legal berlembar-lembar.'),
                        badge: t('settings.generasi_terbaru', 'Generasi Terbaru'),
                      },
                      {
                        id: 'gemini-3.6-flash',
                        title: t('settings.gemini_3_6_flash', 'Gemini 3.6 Flash'),
                        desc: t('settings.performa_ekstraksi_stabil_dan_seimbang_untuk', 'Performa ekstraksi stabil dan seimbang untuk parsing kontrak standar.'),
                        badge: t('settings.stabil_efisien', 'Stabil & Efisien'),
                      },
                      {
                        id: 'gemini-3.5-flash',
                        title: t('settings.gemini_3_5_flash', 'Gemini 3.5 Flash'),
                        desc: t('settings.model_cepat_dan_hemat_token_untuk', 'Model cepat dan hemat token untuk pemrosesan volume dokumen tinggi.'),
                        badge: t('settings.cepat_hemat_kuota', 'Cepat & Hemat Kuota'),
                      },
                      {
                        id: 'gemini-3.1-flash-lite',
                        title: t('settings.gemini_3_1_flash_lite', 'Gemini 3.1 Flash Lite'),
                        desc: t('settings.model_ultra_ringan_dengan_latensi_pemrosesan', 'Model ultra-ringan dengan latensi pemrosesan instan dan hemat kuota.'),
                        badge: t('settings.ringan_instan', 'Ringan & Instan'),
                      },
                    ].map((model) => (
                      <div
                        key={model.id}
                        onClick={() => handleSaveAiModel(model.id)}
                        className={cn(
                          'ds-panel p-3.5 transition-all cursor-pointer flex items-start justify-between gap-3',
                          aiModel === model.id
                            ? 'bg-accent/5'
                            : 'bg-card'
                        )}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-ink text-xs">{model.title}</span>
                            <Badge className="text-xs border border-hairline text-ink-soft bg-transparent hover:bg-surface-2 dark:bg-surface-2/50">
                              {model.badge}
                            </Badge>
                          </div>
                          <p className="text-ink-soft text-xs leading-relaxed">
                            {model.desc}
                          </p>
                        </div>

                        <div className="pt-0.5">
                          <div
                            className={cn(
                              'size-4 rounded-full border flex items-center justify-center transition-all',
                              aiModel === model.id
                                ? 'border-accent-strong bg-accent-strong text-white'
                                : 'border-muted-foreground/40'
                            )}
                          >
                            {aiModel === model.id && <Check className="size-2.5 stroke-3" />}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* GROUP 3: NOTIFICATIONS & NOTICE PERIOD ALERTS */}
          {activeSection === 'notifications' && (
            <div className="space-y-6">
              {/* CARD 1: SMTP RELAY CONFIGURATION */}
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Mail className="w-5 h-5 text-accent-text" />
                      <span>{t('settings.smtp_card_title', 'Konfigurasi SMTP Relay Server (Email Nyata)')}</span>
                    </CardTitle>
                  </div>
                  <div>
                    {smtpEnabled ? (
                      <Badge variant="success" className="bg-status-success-soft text-status-success dark:bg-status-success-soft/40 border border-status-success-border text-xs font-semibold py-1 px-2.5 flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-status-success animate-pulse" />
                        <span>{t('settings.smtp_aktif', 'SMTP Aktif')}</span>
                      </Badge>
                    ) : (
                      <Badge className="bg-surface-2 text-ink-soft border border-hairline text-xs font-semibold py-1 px-2.5">
                        <span>{t('status.nonaktif', 'Nonaktif')}</span>
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleSaveSmtp} className="space-y-4">
                    {/* Toggle Enable SMTP */}
                    <div className="ds-panel p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink text-xs">
                          {t('settings.smtp_enable_label', 'Aktifkan Pengiriman Email via SMTP Relay')}
                        </p>
                        <p className="text-xs text-ink-soft mt-0.5">
                          {t('settings.jika_aktif_reminder_h_90_h', 'Jika aktif, reminder H-90, H-60, H-30, dan H-14 akan dikirimkan otomatis ke email nyata.')}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={smtpEnabled}
                        aria-label={t('settings.smtp_enable_label', 'Aktifkan Pengiriman Email via SMTP Relay')}
                        onClick={() => setSmtpEnabled(!smtpEnabled)}
                        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md"
                      >
                        <span aria-hidden="true" className={`relative block h-6 w-10 rounded-full ${smtpEnabled ? 'bg-accent-dark' : 'bg-surface-2 '}`}>
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-xs transition-transform ${smtpEnabled ? 'translate-x-5' : ''}`} />
                        </span>
                      </button>
                    </div>

                    {/* SMTP Credentials Form */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ds-grid">
                      <div>
                        <label htmlFor="settingsview-field-4" className="block text-ink font-semibold mb-1">
                          {t('settings.smtp_host_label', 'SMTP Host / Server')}
                        </label>
                        <input id="settingsview-field-4"
                          type="text"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          placeholder={t('settings.misal_smtp_gmail_com_smtp_office365', 'misal: smtp.gmail.com / smtp.office365.com')}
                          className="ds-input w-full"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 ds-grid">
                        <div>
                          <label htmlFor="settingsview-field-5" className="block text-ink font-semibold mb-1">
                            {t('settings.smtp_port_label', 'SMTP Port')}
                          </label>
                          <input id="settingsview-field-5"
                            type="number"
                            value={smtpPort}
                            onChange={(e) => setSmtpPort(Number(e.target.value))}
                            placeholder="465 / 587"
                            className="ds-input w-full"
                          />
                        </div>
                        <div className="flex flex-col justify-end">
                          <label className="flex items-center gap-2 p-2.5 bg-surface-2 dark:bg-surface-2/50 border border-hairline rounded-xl cursor-pointer text-ink font-medium">
                            <input
                              type="checkbox"
                              checked={smtpSecure}
                              onChange={(e) => setSmtpSecure(e.target.checked)}
                              className="rounded-sm text-accent-text focus:ring-accent"
                            />
                            <span className="text-xs truncate">{t('settings.ssl_tls', 'SSL/TLS')}</span>
                          </label>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="settingsview-field-6" className="block text-ink font-semibold mb-1">
                          {t('settings.smtp_user_label', 'SMTP Username / Akun Email')}
                        </label>
                        <input id="settingsview-field-6"
                          type="text"
                          value={smtpUser}
                          onChange={(e) => setSmtpUser(e.target.value)}
                          placeholder={t('settings.misal_notif_perusahaan_com', 'misal: notif@perusahaan.com')}
                          className="ds-input w-full"
                        />
                      </div>

                      <div>
                        <label htmlFor="settingsview-field-7" className="block text-ink font-semibold mb-1">
                          {t('settings.smtp_password_label', 'SMTP Password / Google App Password')}
                        </label>
                        <div className="relative flex items-center">
                          <input id="settingsview-field-7"
                            type={showSmtpPassword ? 'text' : 'password'}
                            value={smtpPassword}
                            onChange={(e) => setSmtpPassword(e.target.value)}
                            placeholder={t('settings.password_atau_16_digit_app_password', 'Password atau 16-digit App Password')}
                            className="ds-input w-full pl-4 pr-10"
                          />
                          <button
                            type="button"
                          onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                            aria-label={showSmtpPassword ? t('settings.sembunyikan', 'Sembunyikan') : t('settings.tampilkan', 'Tampilkan')}
                            className="absolute right-3 text-ink-soft hover:text-ink-soft dark:hover:text-ink cursor-pointer"
                          >
                            {showSmtpPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="settingsview-field-8" className="block text-ink font-semibold mb-1">
                          {t('settings.smtp_from_email_label', 'Alamat Email Pengirim (From Email)')}
                        </label>
                        <input id="settingsview-field-8"
                          type="email"
                          value={smtpFromEmail}
                          onChange={(e) => setSmtpFromEmail(e.target.value)}
                          placeholder={t('settings.misal_noreply_perusahaan_com_opsional', 'misal: noreply@perusahaan.com (opsional)')}
                          className="ds-input w-full"
                        />
                      </div>

                      <div>
                        <label htmlFor="settingsview-field-9" className="block text-ink font-semibold mb-1">
                          {t('settings.smtp_from_name_label', 'Nama Pengirim (From Name)')}
                        </label>
                        <input id="settingsview-field-9"
                          type="text"
                          value={smtpFromName}
                          onChange={(e) => setSmtpFromName(e.target.value)}
                          placeholder={t('settings.misal_sistem_notifikasi_kontrak_io', 'misal: Sistem Notifikasi Kontrak & IO')}
                          className="ds-input w-full"
                        />
                      </div>
                    </div>

                    {/* Test SMTP Connection Box */}
                    <div className="ds-panel p-4 space-y-3">
                      <p className="font-bold text-ink text-xs flex items-center gap-2">
                        <Zap className="w-4 h-4 text-status-warning" />
                        <span>{t('settings.smtp_test_title', 'Uji Koneksi & Kirim Email Percobaan')}</span>
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input aria-label={user?.email || t('settings.smtp_test_recipient_ph', 'Masukkan email tujuan uji coba...')}
                          type="email"
                          value={testSmtpRecipient}
                          onChange={(e) => setTestSmtpRecipient(e.target.value)}
                          placeholder={user?.email || t('settings.smtp_test_recipient_ph', 'Masukkan email tujuan uji coba...')}
                          className="ds-input flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleTestSmtp}
                          disabled={testingSmtp || !smtpHost || !smtpUser}
                          size="lg"
                          className="cursor-pointer shrink-0"
                        >
                          <Sparkles className={cn('w-3.5 h-3.5 text-status-warning', testingSmtp && 'animate-spin')} />
                          <span>{testingSmtp ? t('settings.smtp_testing_btn', 'Mengirim Email Uji Coba...') : t('settings.smtp_test_btn', 'Uji Koneksi SMTP')}</span>
                        </Button>
                      </div>

                      {smtpTestResult && (
                        <div
                          className={cn(
                            'p-3 rounded-xl border text-xs flex items-center gap-2 animate-in fade-in',
                            smtpTestResult.success
                              ? 'bg-status-success-soft dark:bg-status-success-soft/30 border-status-success-border text-status-success '
                              : 'bg-status-danger-soft dark:bg-status-danger-soft/30 border-status-danger-border text-status-danger '
                          )}
                        >
                          {smtpTestResult.success ? (
                            <CheckCircle2 className="size-4 text-status-success shrink-0" />
                          ) : (
                            <AlertCircle className="size-4 text-status-danger shrink-0" />
                          )}
                          <span>{smtpTestResult.message}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end pt-1">
                      <Button size="lg"
                        type="submit"
                        disabled={savingSmtp || !isAdmin}
                        className="cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingSmtp ? t('settings.smtp_saving_btn', 'Menyimpan...') : t('settings.smtp_save_btn', 'Simpan Konfigurasi SMTP')}</span>
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

            </div>
          )}

          {/* GROUP 4: LANGUAGE & UI TEXT LOCALIZATION */}
          {activeSection === 'language' && (
            <Card className="overflow-hidden">
              <CardHeader className="">
                <CardTitle className="flex items-center gap-2">
                  <Languages className="w-5 h-5 text-accent-text" />
                  <span>{t('settings.ui_customization_title', 'Kustomisasi Teks UI & Kamus Antarmuka')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p role="note" className="rounded-xl border border-status-warning-border bg-status-warning-soft p-3 text-sm text-status-warning dark:bg-status-warning-soft/40">
                  {t('tb.texts_shared_note')}
                </p>
                {translationsBusy && <p role="status">{t('tb.texts_syncing')}</p>}
                {translationsError && <p role="alert" className="text-destructive">{translationsError}</p>}
                <div className="ds-panel p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{t('settings.ui_editor_card_title', 'Editor Teks Antarmuka Lengkap')}</p>
                    <p className="text-ink-soft text-xs mt-0.5">
                      {t('settings.ui_editor_card_desc', 'Buka jendela dialog untuk mengubah setiap teks tombol, menu, tabel, atau pesan error.')}
                    </p>
                  </div>
                  <Button
                    size="lg"
                    onClick={() => setShowUITextModal(true)}
                    className="text-xs cursor-pointer shrink-0"
                  >
                    {t('settings.open_ui_editor_btn', 'Buka Editor Teks UI')}
                  </Button>
                </div>

                <div className="mobile-page-actions flex items-center gap-2 pt-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={exportToCSV}
                    disabled={translationsBusy}
                    className="cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-ink-soft" />
                    <span>{t('settings.export_csv_dict', 'Ekspor Kamus CSV')}</span>
                  </Button>

                  <input
                    type="file"
                    ref={textFileInputRef}
                    onChange={handleQuickImportCSV}
                    accept=".csv"
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => textFileInputRef.current?.click()}
                    disabled={translationsBusy}
                    className="text-xs cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-ink-soft" />
                    <span>{t('settings.import_csv_dict', 'Impor Kamus CSV')}</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="lg"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        description: t('settings.reset_seluruh_kamus_teks_ke_bahasa', 'Reset seluruh kamus teks ke bahasa bawaan sistem?'),
                        tone: 'danger',
                        confirmLabel: t('hierarchy.reset', 'Reset'),
                      });
                      if (ok) {
                        try {
                          await resetCustomTranslations();
                          setSuccessMsg(t('settings.kamus_teks_ui_dikembalikan_ke_pengaturan', 'Kamus teks UI dikembalikan ke pengaturan awal.'));
                        } catch (error) {
                          setErrorMsg(error instanceof Error ? error.message : t('tb.texts_save_failed'));
                        }
                      }
                    }}
                    disabled={translationsBusy}
                    className="text-xs cursor-pointer ml-auto"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('settings.reset_dict_btn', 'Reset ke Bawaan')}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* GROUP 5: SECURITY & DATABASE MAINTENANCE */}
          {activeSection === 'security' && (
            <div className="space-y-6">
              {/* Danger Zone: Reset Database */}
              <Card className="overflow-hidden">
                <CardHeader className="">
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-status-danger" />
                    <span>{t('settings.danger_zone_title', 'Danger Zone: Reset Database Sistem')}</span>
                  </CardTitle>
                  <CardDescription className="">
                    {t('settings.danger_zone_desc', 'Mereset seluruh pengaturan sistem ke kondisi awal bawaan (Manage Admin Access, Organisasi, Departemen, AI, Notifikasi, Penyimpanan) serta menghapus seluruh data transaksi.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="">
                  <div className="ds-panel p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{t('settings.delete_all_transactions', 'Reset Seluruh Pengaturan & Data Transaksi')}</p>
                    </div>

                    <Button
                      variant="destructive"
                      size="lg"
                      onClick={handleOpenResetModal}
                      disabled={resettingData || !isSuperuser}
                      className="cursor-pointer shrink-0"
                    >
                      {resettingData ? t('settings.resetting_db', 'Mereset Database...') : t('settings.reset_db_btn', 'Reset Database Sistem')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

      {/* Confirmation Modal for Reset Database */}
      <ResetWorkspaceDialog
        open={showResetModal}
        onOpenChange={setShowResetModal}
        onDone={(message) => {
          setShowResetModal(false);
          // Organizations were recreated: this tab's selection no longer points anywhere.
          clearSelection();
          setSuccessMsg(message || t('settings.reset_success', 'The workspace was reset.'));
          setTimeout(() => window.location.reload(), 1200);
        }}
      />

      {/* Confirmation Modal for Editing Database Configuration */}
      {showEditConfirmModal && (
        <ModalFrame onClose={() => setShowEditConfirmModal(false)} className="max-w-sm w-full overflow-hidden">

            <div className="p-5 border-b border-hairline flex items-center gap-3">
              <div className="ds-icon-tile ds-icon-tile-sm bg-status-warning-soft dark:bg-status-warning-soft/40 text-status-warning border border-status-warning-border">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <ModalTitle className="ds-modal-title flex items-center gap-2">
                  {t('settings.edit_confirm_title', 'Ubah Konfigurasi Database')}
                </ModalTitle>
              </div>
            </div>

            <div className="p-5 text-xs text-ink-soft leading-relaxed">
              {t(
                'settings.edit_confirm_desc',
                'Mengubah Spreadsheet ID atau Folder Storage akan mengalihkan sinkronisasi ke berkas baru. Pastikan ID sheet tujuan valid.'
              )}
            </div>

            <div className="p-4 bg-surface-2 dark:bg-surface-2/40 border-t border-hairline flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setShowEditConfirmModal(false)}
                className="text-xs cursor-pointer"
              >
                {t('settings.edit_confirm_cancel', 'Batal')}
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  setShowEditConfirmModal(false);
                  setIsEditUnlocked(true);
                }}
                className="text-xs cursor-pointer"
              >
                {t('settings.edit_confirm_proceed', 'Lanjutkan Edit')}
              </Button>
            </div>

        </ModalFrame>
      )}

      {/* Google Drive Picker Modal */}
      {showPickerModal && (
        <ModalFrame onClose={() => setShowPickerModal(false)} className="max-w-2xl w-full max-h-[92dvh] flex flex-col overflow-hidden">

            <div className="ds-section-header">
              <div className="flex items-center gap-2">
                {pickerType === 'spreadsheet' ? (
                  <FileSpreadsheet className="w-5 h-5 text-accent-text" />
                ) : (
                  <Folder className="w-5 h-5 text-accent-text" />
                )}
                <div>
                  <ModalTitle className="ds-modal-title flex items-center gap-2">
                    {pickerType === 'spreadsheet'
                      ? t('settings.pilih_spreadsheet_dari_google_drive', 'Pilih Spreadsheet dari Google Drive')
                      : t('settings.pilih_folder_storage_dari_google_drive', 'Pilih Folder Storage dari Google Drive')}
                  </ModalTitle>
                  <p className="text-xs text-ink-soft">{t('settings.akun', 'Akun: {email}', { email: googleUser?.email ?? '' })}</p>
                </div>
              </div>
              <button aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setShowPickerModal(false)}
                className="inline-flex items-center justify-center text-ink-soft hover:text-ink size-8 rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
              <div className="relative">
                <Search className="w-4 h-4 text-ink-soft absolute left-3 top-3" />
                <input aria-label={t('settings.cari_nama', 'Cari nama {pickerType}...', { pickerType: pickerType === 'spreadsheet' ? t('settings.picker_spreadsheet', 'spreadsheet') : t('settings.picker_folder', 'folder') })}
                  type="text"
                  placeholder={t('settings.cari_nama', 'Cari nama {pickerType}...', { pickerType: pickerType === 'spreadsheet' ? t('settings.picker_spreadsheet', 'spreadsheet') : t('settings.picker_folder', 'folder') })}
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="ds-input w-full pl-9 pr-3.5"
                />
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-hairline border border-hairline rounded-xl bg-surface">
                {loadingPickerItems ? (
                  <div className="p-6 text-center text-xs text-ink-soft">
                    {t('settings.memuat_item_dari_google_drive', 'Memuat item dari Google Drive...')}
                  </div>
                ) : filteredDriveItems.length === 0 ? (
                  <div className="p-6 text-center text-xs text-ink-soft">
                    {t('settings.tidak_ada_yang_ditemukan', 'Tidak ada {pickerType} yang ditemukan.', { pickerType: pickerType === 'spreadsheet' ? t('settings.picker_spreadsheet', 'spreadsheet') : t('settings.picker_folder', 'folder') })}
                  </div>
                ) : (
                  filteredDriveItems.map((item) => (
                    <button type="button"
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className="p-3 hover:bg-accent-soft/50 cursor-pointer flex items-center justify-between text-xs transition-colors w-full text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {pickerType === 'spreadsheet' ? (
                          <FileSpreadsheet className="w-4 h-4 text-accent-text shrink-0" />
                        ) : (
                          <Folder className="w-4 h-4 text-status-warning shrink-0" />
                        )}
                        <span className="truncate font-semibold text-ink">{item.name}</span>
                      </div>
                      <span className="font-mono text-xs text-ink-soft shrink-0 ml-2">
                        {item.id.slice(0, 8)}...
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-canvas border-t border-hairline flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowPickerModal(false)}
                className="inline-flex items-center px-4 min-h-8 bg-surface-2 hover:bg-surface-2 text-ink font-semibold rounded-md text-xs transition-colors cursor-pointer"
              >
                {t('eval.btn_cancel', 'Batal')}
              </button>
            </div>

        </ModalFrame>
      )}

      {/* UI Text Manager Modal */}
      {showUITextModal && <UITextManagerModal isOpen={showUITextModal} onClose={() => setShowUITextModal(false)} />}
    </div>
  );
};
