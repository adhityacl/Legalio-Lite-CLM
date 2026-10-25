import { ModalFrame } from '../ui/modal-frame';
import React, { useState, useEffect, useRef } from 'react';
import { GoogleSheetsConfig, Tenant } from '@legalio/types';
import { useAuth } from '../../context/AuthContext';
import { GoogleCredentialsForm } from '../settings/GoogleCredentialsDialog';
import { CosStorageForm } from '../settings/CosStorageForm';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { api, errorMessage, isApiError } from '@legalio/shared/apiClient';
import { UITextManagerModal } from '../UITextManagerModal';
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
import { Badge, BadgeDot } from '@legalio/ui-components/badge';
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Separator } from '@legalio/ui-components/separator';
import { ResetWorkspaceDialog } from '../settings/ResetWorkspaceDialog';
import { clearSelection } from '../../lib/organizationSelection';

import { Input } from '@legalio/ui-components/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Heading } from '@legalio/ui-components/heading';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { DialogTitle, DialogHeader } from '@legalio/ui-components/dialog';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Empty, EmptyContent, EmptyDescription } from '@legalio/ui-components/empty';
import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemHiddenInput, RadioGroupItemText } from '@legalio/ui-components/radio-group';
import { FileUpload, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Switch, SwitchControl, SwitchHiddenInput, SwitchThumb } from '@legalio/ui-components/switch';
import { Spinner } from '@legalio/ui-components/spinner';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { Text } from '@legalio/ui-components/text';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { NumberInput, NumberInputControl, NumberInputDecrementTrigger, NumberInputIncrementTrigger, NumberInputInput } from '@legalio/ui-components/number-input';
import { CloseButton } from '@legalio/ui-components/close-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
export type PlatformConfigurationSection = 'storage' | 'ai' | 'notifications' | 'language' | 'security';

const EMPTY_CONFIG: GoogleSheetsConfig = { driveFolderId: '', spreadsheetId: '', isConnected: false, autoSync: false };

/**
 * System Admin configuration pages (PRD §6.6): deployment-wide Google
 * credentials and master resources, AI provider/model, SMTP relay, the
 * browser-local UI text tool and the application-wide
 * reset. Platform-only; secrets are write-only and never prefilled.
 * Organization-specific settings live in each organization's Settings.
 */
export const PlatformConfigurationPanel: React.FC<{ activeSection?: PlatformConfigurationSection }> = ({ activeSection = 'storage' }) => {
  const { user } = useAuth();
  // Mounted only inside System Admin for platform administrators; the server enforces it too.
  const isAdmin = true;
  const isSuperuser = true;
  const { language, t, exportToCSV, importFromCSV, resetCustomTranslations, translationsBusy, translationsError } = useLanguage();
  const confirmDialog = useConfirm();
  const [config, setConfig] = useState<GoogleSheetsConfig>(EMPTY_CONFIG);

  const loadConfig = async () => {
    const data = await api.get<Partial<GoogleSheetsConfig>>('/google-integration', { cache: 'no-store' }).catch(() => null);
    if (data) setConfig({ ...EMPTY_CONFIG, ...data });
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
    try {
      await api.post('/google-integration', { spreadsheetId: spreadsheetId || null, driveFolderId: driveFolderId || null, ...extras });
    } catch (error) {
      throw new Error(errorMessage(error, t('app.gagal_menyimpan_konfigurasi', 'Gagal menyimpan konfigurasi.')));
    }
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
  // Remounting the CSV import clears zag's accepted files so the same file can be imported again.
  const [csvImportKey, setCsvImportKey] = useState(0);
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

  const [backupState, setBackupState] = useState<{ running: boolean; message: string }>({ running: false, message: '' });
  const handleBackupNow = async () => {
    setBackupState({ running: true, message: '' });
    try {
      const data = await api.post<any>('/google-integration/backup').catch((error) => { throw new Error(errorMessage(error, 'Backup gagal.')); });
      if (data.skipped === 'not_connected') throw new Error('Akun Google belum terhubung. Hubungkan akun Google (OAuth) agar backup bisa berjalan.');
      if (data.skipped === 'no_root_folder') throw new Error('Root Folder Drive belum diatur.');
      if (data.busy) throw new Error('Backup sedang berjalan, coba lagi sebentar.');
      setBackupState({ running: false, message: `${data.backedUpCount} file baru dicadangkan${data.alreadyBackedUpCount ? `, ${data.alreadyBackedUpCount} sudah ada di Drive` : ''}${data.failedCount ? `, ${data.failedCount} gagal` : ''}.` });
    } catch (err: any) {
      setBackupState({ running: false, message: err?.message || 'Backup gagal.' });
    }
  };

  const handleCopyLink = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => undefined);
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
      const headers: Record<string, string> = {};
      if (accessToken) headers['x-google-access-token'] = accessToken;
      // Best effort, as before: a refused provisioning step is logged and the sync carries on.
      await api.post('/tenants/auto-provision-folders', undefined, { headers }).catch((e) => console.warn('Folder provision warning:', e));
      await api.post('/google-integration/provision-folders', undefined, { headers }).catch((e) => console.warn('Category provision warning:', e));
      window.dispatchEvent(new CustomEvent('organization-updated'));
      setSuccessMsg(t('settings.berhasil_menyinkronkan_seluruh_data_sheet_folder', 'Berhasil menyinkronkan seluruh data sheet, folder organisasi, dan file ke Master Root!'));
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (err: any) {
      setErrorMsg(err.message || t('settings.gagal_menyinkronkan_data_dan_folder', 'Gagal menyinkronkan data dan folder.'));
    } finally {
      setSyncing(false);
    }
  };



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
        const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('google_refresh_token') : null;
        await api.post('/google-integration/connect', { accessToken: token, refreshToken, googleUser: profile }, { headers: token ? { 'x-google-access-token': token } : {} });
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
        await api.post('/google-integration/disconnect');
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
        const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('google_refresh_token') : null;
        await api.post('/google-integration/connect', { accessToken: token, refreshToken, googleUser: profile }, { headers: token ? { 'x-google-access-token': token } : {} });
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
      const data = await api.post<any>('/google-integration/auto-provision-master', { accessToken: token }, { headers: token ? { 'x-google-access-token': token } : {} }).catch((error) => {
        if (!isApiError(error) || error.status === 0) throw error;
        if (error.status === 403) throw new Error(t('settings.akses_ditolak_hanya_admin_superuser_yang', 'Akses ditolak: Hanya Admin/Superuser yang berhak membuat Master Root.'));
        throw new Error(/^HTTP \d+$/.test(error.message)
          ? t('settings.gagal_memproses_permintaan_http', 'Gagal memproses permintaan (HTTP {status}): {value}', { status: error.status, value: 'Server error' })
          : error.message || t('settings.gagal_membuat_master_root_secara_otomatis', 'Gagal membuat Master Root secara otomatis.'));
      });
      if (!data.success) {
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
      const data = await api.post<any>('/smtp/test', {
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || (smtpSecure ? 465 : 587),
        smtpSecure,
        smtpUser: smtpUser.trim(),
        smtpPassword,
        smtpFromEmail: smtpFromEmail.trim(),
        smtpFromName: smtpFromName.trim(),
        testRecipient: recipient,
      }).catch((error) => { throw new Error(errorMessage(error, t('settings.gagal_terhubung_ke_smtp_relay', 'Gagal terhubung ke SMTP Relay.'))); });
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
      const data = await api.post<any>('/ai/test-key', { apiKey: keyToTest, model: aiModel || 'gemini-3.6-flash' })
        .catch((error) => { throw new Error(errorMessage(error, t('settings.gagal_terhubung_ke_google_gemini_api', 'Gagal terhubung ke Google Gemini API.'))); });
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
      const headers: Record<string, string> = {};
      if (token) headers['x-google-access-token'] = token;
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
        headers['x-session-token'] = sessionToken;
      }

      await api.post('/google-integration/provision-folders', undefined, { headers }).catch((error) => {
        throw new Error(isApiError(error) && error.status > 0 && !/^HTTP \d+$/.test(error.message)
          ? error.message
          : t('settings.gagal_sinkronisasi_folder_status', 'Gagal sinkronisasi folder (Status {status})', { status: isApiError(error) ? error.status : 0 }));
      });

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

  const handleQuickImportCSV = (file: File | undefined) => {
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
  };

  const filteredDriveItems = driveItems.filter((i) =>
    i.name.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  const sections: Array<{ id: PlatformConfigurationSection; label: string }> = [
    { id: 'storage', label: t('storage.title', 'Storage') },
    { id: 'ai', label: t('sys.nav_ai', 'AI Model') },
    { id: 'notifications', label: t('tb.config_smtp', 'SMTP relay') },
    { id: 'language', label: t('tb.config_texts_short', 'UI texts') },
    { id: 'security', label: t('sys.nav_reset', 'System reset') },
  ];
  const activeSectionLabel = sections.find((section) => section.id === activeSection)?.label || sections[0].label;

  return (
    <div className="space-y-g21 animate-in fade-in-50 duration-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{activeSectionLabel}</span>
          </Heading>
        </div>
      </div>

      {/* Global Alerts for Settings */}
      {successMsg && (
        <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{successMsg}</AlertDescription></AlertContent><AlertActions><CloseButton aria-label={t('common.close', 'Tutup')} onClick={() => setSuccessMsg(null)} /></AlertActions></Alert>
      )}

      {errorMsg && (
        <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{errorMsg}</AlertDescription></AlertContent><AlertActions><CloseButton aria-label={t('common.close', 'Tutup')} onClick={() => setErrorMsg(null)} /></AlertActions></Alert>
      )}

      {/* Full-width Content Layout */}
      <div className="w-full space-y-g21">
          {activeSection === 'storage' && isSuperuser && (
            <section className="max-w-6xl space-y-g13" aria-label={t('storage.title', 'Storage')}>
              <CosStorageForm />
            </section>
          )}

          {/* GROUP 2: AI & SMART AUTOMATION */}
          {activeSection === 'ai' && (
            <div className="space-y-g21">
              {/* CARD 1: GOOGLE GEMINI API KEY */}
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-g13">
                  <div className="space-y-g3">
                    <CardTitle className="flex items-center gap-g8">
                      <Key className="w-g21 h-g21 text-accent-foreground" />
                      <span>{t('settings.gemini_api_key_title', 'Google Gemini API Key')}</span>
                    </CardTitle>
                  </div>
                  <div>
                    {geminiApiKey ? (
                      <Badge tone="success" className="gap-g5">
                        <BadgeDot className="size-g8 text-status-success animate-pulse" />
                        <span>{t('settings.api_key_active', 'API Key Aktif')}</span>
                      </Badge>
                    ) : (
                      <Badge tone="warning" className="gap-g5">
                        <AlertCircle className="size-g13 text-status-warning" />
                        <span>{t('settings.api_key_empty', 'Belum Diatur')}</span>
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardBody className="space-y-g13">
                  <form onSubmit={(event) => void handleSaveApiKey(event)} className="space-y-g13">
                    <div className="space-y-g5">
                      <FieldLabel htmlFor="settingsview-field-3" className="w-full justify-between">
                        <span>{t('settings.gemini_api_key_label', 'Gemini API Key (AI Studio)')}</span>
                        <Button asChild variant="link"><a href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer"
                          
                        >
                          <span>{t('settings.get_api_key_link', 'Dapatkan API Key di Google AI Studio')}</span>
                          <ExternalLink className="size-g13" />
                        </a></Button>
                      </FieldLabel>
                      <div className="relative flex items-center">
                        <Input id="settingsview-field-3"
                          type={showApiKey ? 'text' : 'password'}
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder={t('settings.gemini_api_key_ph', 'Masukkan Google Gemini API Key (misal: AIzaSy...)')}
                          className="w-full pl-g13 pr-g34"
                        />
                        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-md"
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-g13"
                        >
                          {showApiKey ? <EyeOff className="size-g16" /> : <Eye className="size-g16" />}
                        </Button></TooltipTrigger><TooltipBody>{showApiKey ? t('settings.sembunyikan', 'Sembunyikan') : t('settings.tampilkan', 'Tampilkan')}</TooltipBody></Tooltip>
                      </div>
                    </div>

                    {/* Test Result Alert Box */}
                    {apiTestResult && (
                      <div
                        className={cn(
                          'p-g13 rounded-xl border text-xs flex items-center gap-g8 animate-in fade-in',
 apiTestResult.success
 ? 'bg-status-success-soft border-status-success-border text-status-success '
 : 'bg-status-danger-soft border-status-danger-border text-status-danger '
 )}
 >
 {apiTestResult.success ? (
 <CheckCircle2 className="size-g16 text-status-success shrink-0" />
                        ) : (
                          <AlertCircle className="size-g16 text-status-danger shrink-0" />
                        )}
                        <span>{apiTestResult.message}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-g8 pt-g3">
                      <Button
                        type="submit"
                        disabled={savingApiKey || !isAdmin}
                      >
                        <Save className="w-g13 h-g13" />
                        <span>{savingApiKey ? t('eval.btn_saving', 'Menyimpan...') : t('settings.save_api_key_btn', 'Simpan API Key')}</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleTestApiKey()}
                        disabled={testingApiKey || !geminiApiKey.trim()}
                      >
                        {testingApiKey ? <Spinner size="sm" decorative /> : <AiIcon aria-hidden="true" />}
 <span>{testingApiKey ? t('admin.test_connection_testing', 'Menguji Koneksi...') : t('settings.test_api_key_btn', 'Uji Koneksi API')}</span>
 </Button>
 </div>
 </form>
 </CardBody>
 </Card>

 {/* CARD 2: MODEL AI SELECTION */}
 <Card className="overflow-hidden">
                <CardHeader >
                  <CardTitle className="flex items-center gap-g8">
                    <AiIcon className="w-g21 h-g21 text-accent-foreground" />
                    <span>{t('settings.ai_config_title', 'Pilihan Model Google Gemini')}</span>
                  </CardTitle>
                </CardHeader>
                <CardBody className="space-y-g13">
                  <RadioGroup aria-label={t('settings.ai_config_title', 'Pilihan Model Google Gemini')} value={aiModel} onValueChange={details => { if (details.value) void handleSaveAiModel(details.value); }} className="grid w-full grid-cols-1 gap-g13 md:grid-cols-2">
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
                      <RadioGroupItem key={model.id} value={model.id} className="relative h-full w-full min-w-0 items-start justify-between gap-g13 rounded-lg border border-border p-g13 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
                        <span className="grid min-w-0 flex-1 gap-g3">
                          <span className="flex flex-wrap items-center gap-g8">
                            <RadioGroupItemText className="text-sm font-semibold">{model.title}</RadioGroupItemText>
                            <Badge>{model.badge}</Badge>
                          </span>
                          <Text as="span" size="xs" tone="muted">{model.desc}</Text>
                        </span>
                        <RadioGroupItemControl className="shrink-0" />
                        <RadioGroupItemHiddenInput />
                      </RadioGroupItem>
                    ))}
                  </RadioGroup>
                </CardBody>
              </Card>
            </div>
          )}

          {/* GROUP 3: NOTIFICATIONS & NOTICE PERIOD ALERTS */}
          {activeSection === 'notifications' && (
            <div className="space-y-g21">
              {/* CARD 1: SMTP RELAY CONFIGURATION */}
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-g13">
                  <div className="space-y-g3">
                    <CardTitle className="flex items-center gap-g8">
                      <Mail className="w-g21 h-g21 text-accent-foreground" />
                      <span>{t('settings.smtp_card_title', 'Konfigurasi SMTP Relay Server (Email Nyata)')}</span>
                    </CardTitle>
                  </div>
                  <div>
                    {smtpEnabled ? (
                      <Badge tone="success" className="gap-g5">
                        <BadgeDot className="size-g8 text-status-success animate-pulse" />
                        <span>{t('settings.smtp_aktif', 'SMTP Aktif')}</span>
                      </Badge>
                    ) : (
                      <Badge>
                        <span>{t('status.nonaktif', 'Nonaktif')}</span>
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardBody className="space-y-g13">
                  <form onSubmit={(event) => void handleSaveSmtp(event)} className="space-y-g13">
                    {/* Toggle Enable SMTP */}
                    <Card className="flex flex-row items-center justify-between gap-g13 p-g13">
                      <div className="min-w-0 flex-1 text-start">
                        <Text size="xs" weight="semibold">
                          {t('settings.smtp_enable_label', 'Aktifkan Pengiriman Email via SMTP Relay')}
                        </Text>
                        <Text size="xs" tone="muted" className="mt-g2">
                          {t('settings.jika_aktif_reminder_h_90_h', 'Jika aktif, reminder H-90, H-60, H-30, dan H-14 akan dikirimkan otomatis ke email nyata.')}
                        </Text>
                      </div>
                      <Switch className="relative shrink-0" checked={smtpEnabled} onCheckedChange={details => setSmtpEnabled(details.checked)} aria-label={t('settings.smtp_enable_label', 'Aktifkan Pengiriman Email via SMTP Relay')}>
                        <SwitchControl><SwitchThumb /></SwitchControl>
                        <SwitchHiddenInput />
                      </Switch>
                    </Card>

                    {/* SMTP Credentials Form */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                      <Field>
                        <FieldLabel htmlFor="settingsview-field-4">
                          {t('settings.smtp_host_label', 'SMTP Host / Server')}
                        </FieldLabel>
                        <Input id="settingsview-field-4"
                          type="text"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          placeholder={t('settings.misal_smtp_gmail_com_smtp_office365', 'misal: smtp.gmail.com / smtp.office365.com')}
                          className="w-full"
                        />
                      </Field>

                      <div className="grid grid-cols-2 gap-g8">
                        <Field>
                          <FieldLabel htmlFor="settingsview-field-5">
                            {t('settings.smtp_port_label', 'SMTP Port')}
                          </FieldLabel>
                          <NumberInput ids={{ input: "settingsview-field-5" }} value={String(smtpPort ?? '')} onValueChange={details => setSmtpPort(Number(details.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput placeholder="465 / 587" /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
                        </Field>
                        <div className="flex flex-col justify-end">
                          <Checkbox checked={smtpSecure} onCheckedChange={(details) => setSmtpSecure(details.checked === true)}><CheckboxControl /><CheckboxLabel><span className="text-xs truncate">{t('settings.ssl_tls', 'SSL/TLS')}</span></CheckboxLabel><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </div>

                      <Field>
                        <FieldLabel htmlFor="settingsview-field-6">
                          {t('settings.smtp_user_label', 'SMTP Username / Akun Email')}
                        </FieldLabel>
                        <Input id="settingsview-field-6"
                          type="text"
                          value={smtpUser}
                          onChange={(e) => setSmtpUser(e.target.value)}
                          placeholder={t('settings.misal_notif_perusahaan_com', 'misal: notif@perusahaan.com')}
                          className="w-full"
                        />
                      </Field>

                      <div>
                        <FieldLabel htmlFor="settingsview-field-7">
                          {t('settings.smtp_password_label', 'SMTP Password / Google App Password')}
                        </FieldLabel>
                        <div className="relative flex items-center">
                          <Input id="settingsview-field-7"
                            type={showSmtpPassword ? 'text' : 'password'}
                            value={smtpPassword}
                            onChange={(e) => setSmtpPassword(e.target.value)}
                            placeholder={t('settings.password_atau_16_digit_app_password', 'Password atau 16-digit App Password')}
                            className="w-full pl-g13 pr-g34"
                          />
                          <Button variant="ghost" size="icon-md"
                            type="button"
                          onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                            aria-label={showSmtpPassword ? t('settings.sembunyikan', 'Sembunyikan') : t('settings.tampilkan', 'Tampilkan')}
                            className="absolute right-g13"
                          >
                            {showSmtpPassword ? <EyeOff className="size-g16" /> : <Eye className="size-g16" />}
                          </Button>
                        </div>
                      </div>

                      <Field>
                        <FieldLabel htmlFor="settingsview-field-8">
                          {t('settings.smtp_from_email_label', 'Alamat Email Pengirim (From Email)')}
                        </FieldLabel>
                        <Input id="settingsview-field-8"
                          type="email"
                          value={smtpFromEmail}
                          onChange={(e) => setSmtpFromEmail(e.target.value)}
                          placeholder={t('settings.misal_noreply_perusahaan_com_opsional', 'misal: noreply@perusahaan.com (opsional)')}
                          className="w-full"
                        />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="settingsview-field-9">
                          {t('settings.smtp_from_name_label', 'Nama Pengirim (From Name)')}
                        </FieldLabel>
                        <Input id="settingsview-field-9"
                          type="text"
                          value={smtpFromName}
                          onChange={(e) => setSmtpFromName(e.target.value)}
                          placeholder={t('settings.misal_sistem_notifikasi_kontrak_io', 'misal: Sistem Notifikasi Kontrak & IO')}
                          className="w-full"
                        />
                      </Field>
                    </div>

                    {/* Test SMTP Connection Box */}
                    <Card className="p-g13 space-y-g13">
                      <Text size="xs" weight="bold" className="flex items-center gap-g8">
                        <Zap className="w-g16 h-g16 text-status-warning" />
                        <span>{t('settings.smtp_test_title', 'Uji Koneksi & Kirim Email Percobaan')}</span>
                      </Text>
                      <div className="flex flex-col sm:flex-row gap-g8">
                        <Input aria-label={user?.email || t('settings.smtp_test_recipient_ph', 'Masukkan email tujuan uji coba...')}
                          type="email"
                          value={testSmtpRecipient}
                          onChange={(e) => setTestSmtpRecipient(e.target.value)}
                          placeholder={user?.email || t('settings.smtp_test_recipient_ph', 'Masukkan email tujuan uji coba...')}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleTestSmtp()}
                          disabled={testingSmtp || !smtpHost || !smtpUser}
                          className="shrink-0"
                        >
                          {testingSmtp ? <Spinner size="sm" decorative /> : <Sparkles aria-hidden="true" />}
 <span>{testingSmtp ? t('settings.smtp_testing_btn', 'Mengirim Email Uji Coba...') : t('settings.smtp_test_btn', 'Uji Koneksi SMTP')}</span>
 </Button>
 </div>

 {smtpTestResult && (
 <div
 className={cn(
 'p-g13 rounded-xl border text-xs flex items-center gap-g8 animate-in fade-in',
 smtpTestResult.success
 ? 'bg-status-success-soft border-status-success-border text-status-success '
 : 'bg-status-danger-soft border-status-danger-border text-status-danger '
 )}
 >
 {smtpTestResult.success ? (
 <CheckCircle2 className="size-g16 text-status-success shrink-0" />
                          ) : (
                            <AlertCircle className="size-g16 text-status-danger shrink-0" />
                          )}
                          <span>{smtpTestResult.message}</span>
                        </div>
                      )}
                    </Card>

                    <div className="flex justify-end pt-g3">
                      <Button
                        type="submit"
                        disabled={savingSmtp || !isAdmin}
                      >
                        <Save className="w-g13 h-g13" />
                        <span>{savingSmtp ? t('settings.smtp_saving_btn', 'Menyimpan...') : t('settings.smtp_save_btn', 'Simpan Konfigurasi SMTP')}</span>
                      </Button>
                    </div>
                  </form>
                </CardBody>
              </Card>

            </div>
          )}

          {/* GROUP 4: LANGUAGE & UI TEXT LOCALIZATION */}
          {activeSection === 'language' && (
            <Card className="overflow-hidden">
              <CardHeader >
                <CardTitle className="flex items-center gap-g8">
                  <Languages className="w-g21 h-g21 text-accent-foreground" />
                  <span>{t('settings.ui_customization_title', 'Kustomisasi Teks UI & Kamus Antarmuka')}</span>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-g13">
                {translationsBusy && <p role="status">{t('tb.texts_syncing')}</p>}
                {translationsError && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{translationsError}</AlertDescription></AlertContent></Alert>}
                <Card className="p-g13 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-g13">
                  <div>
                    <Text size="sm" weight="semibold">{t('settings.ui_editor_card_title', 'Editor Teks Antarmuka Lengkap')}</Text>
                    <Text size="xs" tone="muted" className="mt-g2">
                      {t('settings.ui_editor_card_desc', 'Buka jendela dialog untuk mengubah setiap teks tombol, menu, tabel, atau pesan error.')}
                    </Text>
                  </div>
                  <Button
                    onClick={() => setShowUITextModal(true)}
                    className="shrink-0"
                  >
                    {t('settings.open_ui_editor_btn', 'Buka Editor Teks UI')}
                  </Button>
                </Card>

                <div className="flex items-center gap-g8 pt-g8 flex-wrap">
                  <div className="grid w-full grid-cols-2 gap-g8 sm:w-auto">
                    <Button
                      variant="outline"
                      onClick={() => void exportToCSV()}
                      disabled={translationsBusy}
                      className="w-full"
                    >
                      <Download className="w-g13 h-g13 text-muted-foreground" />
                      <span>{t('settings.export_csv_dict', 'Ekspor Kamus CSV')}</span>
                    </Button>

                    <FileUpload className="w-full" key={csvImportKey} accept=".csv" maxFiles={1} disabled={translationsBusy} onFileAccept={details => { handleQuickImportCSV(details.files[0]); setCsvImportKey(key => key + 1); }}>
                      <FileUploadTrigger asChild>
                        <Button variant="outline" disabled={translationsBusy} className="w-full">
                          <Upload aria-hidden="true" />{t('settings.import_csv_dict', 'Impor Kamus CSV')}
                        </Button>
                      </FileUploadTrigger>
                      <FileUploadHiddenInput />
                    </FileUpload>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => { void (async () => {
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
                    })(); }}
                    disabled={translationsBusy}
                    className="ml-auto"
                  >
                    <RotateCcw className="w-g13 h-g13" />
                    <span>{t('settings.reset_dict_btn', 'Reset ke Bawaan')}</span>
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* GROUP 5: SECURITY & DATABASE MAINTENANCE */}
          {activeSection === 'security' && (
            <div className="space-y-g21">
              {/* Danger Zone: Reset Database */}
              <Card className="overflow-hidden">
                <CardHeader >
                  <CardTitle className="flex items-center gap-g8">
                    <ShieldAlert className="w-g21 h-g21 text-status-danger" />
                    <span>{t('settings.danger_zone_title', 'Danger Zone: Reset Database Sistem')}</span>
                  </CardTitle>
                  <CardDescription >
                    {t('settings.danger_zone_desc', 'Mereset seluruh pengaturan sistem ke kondisi awal bawaan (Manage Admin Access, Organisasi, Departemen, AI, Notifikasi, Penyimpanan) serta menghapus seluruh data transaksi.')}
                  </CardDescription>
                </CardHeader>
                <CardBody >
                  <Card className="p-g13 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-g13">
                    <div>
                      <Text size="sm" weight="semibold">{t('settings.delete_all_transactions', 'Reset Seluruh Pengaturan & Data Transaksi')}</Text>
                    </div>

                    <Button
                      variant="destructive"
                      onClick={handleOpenResetModal}
                      disabled={resettingData || !isSuperuser}
                      className="shrink-0"
                    >
                      {resettingData ? t('settings.resetting_db', 'Mereset Database...') : t('settings.reset_db_btn', 'Reset Database Sistem')}
                    </Button>
                  </Card>
                </CardBody>
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
        <ModalFrame onClose={() => setShowEditConfirmModal(false)} className="max-w-g377 w-full overflow-hidden">

            <div className="p-g21 border-b border-border flex items-center gap-g13">
              <Avatar size="md" className="shrink-0 rounded-md border bg-status-warning-soft text-status-warning border border-status-warning-border"><AvatarFallback className="bg-transparent text-inherit"><AlertCircle className="w-g21 h-g21" /></AvatarFallback></Avatar>
              <div>
                <DialogTitle className="flex items-center gap-g8">
                  {t('settings.edit_confirm_title', 'Ubah Konfigurasi Database')}
                </DialogTitle>
              </div>
            </div>

            <div className="p-g21 text-xs text-muted-foreground leading-relaxed">
              {t(
                'settings.edit_confirm_desc',
                'Mengubah Spreadsheet ID atau Folder Storage akan mengalihkan sinkronisasi ke berkas baru. Pastikan ID sheet tujuan valid.'
              )}
            </div>

            <div className="p-g13 bg-muted border-t border-border flex items-center justify-end gap-g8">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEditConfirmModal(false)}
              >
                {t('settings.edit_confirm_cancel', 'Batal')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setShowEditConfirmModal(false);
                  setIsEditUnlocked(true);
                }}
              >
                {t('settings.edit_confirm_proceed', 'Lanjutkan Edit')}
              </Button>
            </div>

        </ModalFrame>
      )}

      {/* Google Drive Picker Modal */}
      {showPickerModal && (
        <ModalFrame onClose={() => setShowPickerModal(false)} className="max-w-g610 w-full flex flex-col overflow-hidden">

            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <div className="flex items-center gap-g8">
                {pickerType === 'spreadsheet' ? (
                  <FileSpreadsheet className="w-g21 h-g21 text-accent-foreground" />
                ) : (
                  <Folder className="w-g21 h-g21 text-accent-foreground" />
                )}
                <div>
                  <DialogTitle className="flex items-center gap-g8">
                    {pickerType === 'spreadsheet'
                      ? t('settings.pilih_spreadsheet_dari_google_drive', 'Pilih Spreadsheet dari Google Drive')
                      : t('settings.pilih_folder_storage_dari_google_drive', 'Pilih Folder Storage dari Google Drive')}
                  </DialogTitle>
                  <Text size="xs" tone="muted">{t('settings.akun', 'Akun: {email}', { email: googleUser?.email ?? '' })}</Text>
                </div>
              </div>
              <Button variant="secondary" size="icon-sm" aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setShowPickerModal(false)}
              >
                <X className="w-g21 h-g21" />
              </Button>
            </DialogHeader>

            <div className="p-g21 sm:p-g21 overflow-y-auto space-y-g13 text-xs flex-1">
              <InputGroup className="relative">
                <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput aria-label={t('settings.cari_nama', 'Cari nama {pickerType}...', { pickerType: pickerType === 'spreadsheet' ? t('settings.picker_spreadsheet', 'spreadsheet') : t('settings.picker_folder', 'folder') })}
                  type="text"
                  placeholder={t('settings.cari_nama', 'Cari nama {pickerType}...', { pickerType: pickerType === 'spreadsheet' ? t('settings.picker_spreadsheet', 'spreadsheet') : t('settings.picker_folder', 'folder') })}
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                />
              </InputGroup>

              <Card className="max-h-g233 overflow-y-auto divide-y divide-border">
                {loadingPickerItems ? (
                  <Text size="sm" tone="muted" role="status" className="flex items-center justify-center gap-g8 p-g21"><Spinner size="sm" decorative />{t('settings.memuat_item_dari_google_drive', 'Memuat item dari Google Drive...')}</Text>
                ) : filteredDriveItems.length === 0 ? (
                  <Empty className="border-0"><EmptyContent><EmptyDescription>{t('settings.tidak_ada_yang_ditemukan', 'Tidak ada {pickerType} yang ditemukan.', { pickerType: pickerType === 'spreadsheet' ? t('settings.picker_spreadsheet', 'spreadsheet') : t('settings.picker_folder', 'folder') })}</EmptyDescription></EmptyContent></Empty>
                ) : (
                  filteredDriveItems.map((item) => (
                    <Button variant="ghost"
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className="h-auto w-full justify-between rounded-none py-g13 text-start"
                    >
                      <div className="flex items-center gap-g8 min-w-0">
                        {pickerType === 'spreadsheet' ? (
                          <FileSpreadsheet className="w-g16 h-g16 text-accent-foreground shrink-0" />
                        ) : (
                          <Folder className="w-g16 h-g16 text-status-warning shrink-0" />
                        )}
                        <span className="truncate font-semibold text-foreground">{item.name}</span>
                      </div>
                      <Text as="span" size="xs" tone="muted" className="font-mono shrink-0 ml-g8">
                        {item.id.slice(0, 8)}...
                      </Text>
                    </Button>
                  ))
                )}
              </Card>
            </div>

            <div className="p-g13 sm:p-g21 bg-background border-t border-border flex justify-end shrink-0">
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setShowPickerModal(false)}
              >
                {t('eval.btn_cancel', 'Batal')}
              </Button>
            </div>

        </ModalFrame>
      )}

      {/* UI Text Manager Modal */}
      {showUITextModal && <UITextManagerModal isOpen={showUITextModal} onClose={() => setShowUITextModal(false)} />}
    </div>
  );
};
