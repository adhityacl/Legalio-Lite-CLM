import { ModalFrame } from '../ui/modal-frame';
import React, { useState, useEffect, useRef } from 'react';
import { PlatformProviderConfig, Tenant } from '@legalio/types';
import { useAuth } from '../../context/AuthContext';
import { StorageForm } from '../settings/StorageForm';
import { AiModelSettings } from '../settings/AiModelSettings';
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

const EMPTY_CONFIG: PlatformProviderConfig = {};

/**
 * System Admin configuration pages (PRD §6.6): deployment-wide file storage,
 * AI provider/model, SMTP relay, the
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
  const [config, setConfig] = useState<PlatformProviderConfig>(EMPTY_CONFIG);

  const loadConfig = async () => {
    const data = await api.get<Partial<PlatformProviderConfig>>('/platform-settings', { cache: 'no-store' }).catch(() => null);
    if (data) setConfig({ ...EMPTY_CONFIG, ...data });
  };
  useEffect(() => { void loadConfig(); }, []);

  /** Platform fields only; organization recipients/mappings are not part of this payload. */
  const onSaveConfig = async (
    extraConfig: Partial<PlatformProviderConfig> = {},
  ) => {
    const allowed = ['aiModel', 'geminiApiKey', 'smtpEnabled', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPassword', 'smtpFromEmail', 'smtpFromName'];
    const extras = Object.fromEntries(Object.entries(extraConfig).filter(([key, value]) => allowed.includes(key) && value !== undefined));
    try {
      await api.post('/platform-settings', extras);
    } catch (error) {
      throw new Error(errorMessage(error, t('app.gagal_menyimpan_konfigurasi', 'Gagal menyimpan konfigurasi.')));
    }
    await loadConfig();
  };

  // Organization projections refresh after platform provisioning changes.
  const refreshTenants = async () => { window.dispatchEvent(new CustomEvent('organization-updated')); };

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
  const [geminiApiKey, setGeminiApiKey] = useState<string>(config.geminiApiKey || '');
  // Remounting the CSV import clears zag's accepted files so the same file can be imported again.
  const [csvImportKey, setCsvImportKey] = useState(0);

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

  const [saving, setSaving] = useState(false);
  const [savingNotifEmails, setSavingNotifEmails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [resettingData, setResettingData] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState('');
  const [showUITextModal, setShowUITextModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyLink = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };



  // Track previous config to prevent overwriting user input during polling
  const prevConfigRef = useRef(config);

  // Sync internal states when config updates from server
  useEffect(() => {
    const prev = prevConfigRef.current;
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
      await onSaveConfig({
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
      await onSaveConfig({
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
            <section className="w-full space-y-g13" aria-label={t('storage.title', 'Storage')}>
              <StorageForm />
            </section>
          )}

          {/* GROUP 2: AI & SMART AUTOMATION */}
          {activeSection === 'ai' && <AiModelSettings />}

          {/* GROUP 3: NOTIFICATIONS & NOTICE PERIOD ALERTS */}
          {activeSection === 'notifications' && (
            <div className="space-y-g21">
              {/* CARD 1: SMTP RELAY CONFIGURATION */}
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-g13">
                  <div className="space-y-g3">
                    <CardTitle className="flex items-center gap-g13">
                      <span className="flex size-g34 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="size-g16" aria-hidden="true" /></span>
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
                <CardTitle className="flex items-center gap-g13">
                  <span className="flex size-g34 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Languages className="size-g16" aria-hidden="true" /></span>
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
                  <CardTitle className="flex items-center gap-g13">
                    <span className="flex size-g34 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldAlert className="size-g16" aria-hidden="true" /></span>
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

      {/* UI Text Manager Modal */}
      {showUITextModal && <UITextManagerModal isOpen={showUITextModal} onClose={() => setShowUITextModal(false)} />}
    </div>
  );
};
