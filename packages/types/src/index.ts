import type {
  ContractStatus,
  ApprovalStatus,
  DueDiligenceStatus,
  DocumentEvidenceStatus,
} from './domainStatus';
import type { TenantSettings } from './policy';
import type { ContractLifecycleFields } from './lifecycle';

export type { ContractStatus, ApprovalStatus, DocumentEvidenceStatus, TenantSettings };

/** @deprecated Legacy Indonesian legal-status flag; superseded by `Partner.country`. */
export type BadanHukum = 'BHI' | 'BHA';

export type PartnerJenis = 'Vendor' | 'Klien' | 'Reseller' | 'Media Partner' | 'Supplier' | string;

export type StatusDD = DueDiligenceStatus;

export type NoticeType = 'Termination' | 'Extension' | 'Both' | 'None';

export const PRICING_MODELS = ['CPM', 'CPC', 'CPA', 'Fixed', 'Retainer', 'Hourly', 'Milestone', 'Commission', 'Subscription'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number] | string;

export type ChargingType = 'Prepaid' | 'Postpaid' | 'Milestone-based';

export type UserRole =
  | 'Superuser'
  | 'Admin'
  | 'Manager'
  | 'Editor'
  | 'Viewer'
  | 'Legal'
  | 'Finance'
  | 'Staff'
  | string;

export interface DDFileItem {
  id: string;
  fileName: string;
  linkDrive: string;
  fileSize?: string;
  uploadedAt: string;
  year?: string;
  tanggalKadaluarsa?: string;
}

export interface DDDokumenItem {
  /** Stable requirement key from the policy pack (absent for ad-hoc items). */
  key?: string;
  nama: string;
  wajib: boolean;
  expires?: boolean;
  status: DocumentEvidenceStatus;
  nomorDokumen?: string;
  tanggalKadaluarsa?: string;
  linkDrive?: string;
  fileId?: string;
  fileSize?: string;
  uploadedAt?: string;
  files?: DDFileItem[];
}

/** A tax, registration or other identifier issued to a party (PRD §3.2.2). */
export interface PartyIdentifier {
  /** Scheme key from a country pack, e.g. `sg_uen`, or `other`. */
  scheme: string;
  value: string;
  /** ISO 3166-1 alpha-2 issuing country. */
  country: string;
}

export interface Partner {
  partner_id: string;
  organizationId?: string;
  nama_partner: string;
  /** ISO 3166-1 alpha-2 country of incorporation ('' when unknown). */
  country?: string;
  /** Legal form as registered, e.g. "Private Limited (Pte. Ltd.)". */
  entity_type?: string;
  identifiers?: PartyIdentifier[];
  jenis_partner?: PartnerJenis;
  nama_pic?: string;
  email_pic?: string;
  telepon_pic?: string;
  alamat_pic?: string;
  kontak_pic?: string;
  pic_internal?: string;
  internal_pic?: string;
  codename?: string;
  partner_channel?: string;
  badan_hukum?: BadanHukum | string;
  status_dd: StatusDD;
  link_folder_dd?: string;
  daftar_dokumen_dd: DDDokumenItem[];
  tanggal_dd_diverifikasi?: string;
  catatan?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export type JenisDokumenContract = 'Master Agreement' | 'Agreement Addendum';

export interface Contract extends ContractLifecycleFields {
  contract_id: string;
  organizationId?: string;
  jenis_dokumen?: JenisDokumenContract;
  parent_contract_id?: string;
  parent_contract_nomor?: string;
  nomor_kontrak: string;
  judul_kontrak: string;
  partner_id: string;
  kategori_kerjasama: string[]; // Advertising, Content, Distribusi, Supplier, dll
  tanggal_mulai: string;
  tanggal_berakhir: string;
  tanggal_selesai?: string;
  currency?: string;
  nilai_kontrak: number;
  nilai_kontrak_usd?: number;
  auto_renewal: boolean;
  notice_period_hari: number;
  notice_type_required: NoticeType;
  status: ContractStatus;
  status_approval: ApprovalStatus;
  pic_internal: string;
  link_file_kontrak?: string;
  fileName?: string;
  internal_notes?: string;
  field_yang_berubah?: string[];
  ringkasan_perubahan?: string;
  sisa_hari?: number;
  redline_analysis?: RedlineAnalysisData;
  redline_analyzed_at?: string;
  // Legacy amendment helper properties
  addendum_id?: string;
  nomor_addendum?: string;
  parent_type?: string;
  parent_nomor?: string;
  parent_id?: string;
  tanggal_addendum?: string;
  link_file_addendum?: string;
  created_at: string;
  updated_at: string;
}

export interface InsertionOrder {
  io_id: string;
  organizationId?: string;
  contract_id?: string; // Boleh kosong jika IO berdiri sendiri
  contract_nomor?: string; // helper
  nomor_io: string;
  judul_io: string;
  partner_id: string;
  kanal_media: string;
  tanggal_mulai: string;
  tanggal_berakhir: string;
  tanggal_selesai?: string;
  pricing_model: PricingModel;
  model_pembayaran?: string;
  skema_pembayaran?: string;
  charging_type: ChargingType;
  currency?: string;
  mata_uang?: string;
  nilai_io: number;
  nilai_io_usd?: number;
  deliverables: string;
  notice_period_hari: number;
  notice_period_days?: number;
  notice_type_required: NoticeType;
  status: ContractStatus;
  internal_notes?: string;
  notes?: string;
  link_file_io?: string;
  fileName?: string;
  sisa_hari?: number;
  created_at: string;
  updated_at: string;
}
export interface NotificationLog {
  notif_id: string;
  organizationId?: string;
  parent_type: 'Contract' | 'IO';
  parent_id: string;
  parent_nomor?: string;
  parent_judul?: string;
  /** e.g. "Reminder 30d", "Manual", "Status Change" (legacy: "Reminder H-30"). */
  jenis_notifikasi: string;
  tanggal_terkirim: string;
  status_terkirim: boolean;
  penerima: string;
  pesan: string;
  /** Structured reminder data so the UI can localize `pesan` (absent on older rows). */
  pesan_params?: {
    kind: 'contract' | 'commercial';
    daysRemaining: number;
    noticeType?: string;
    noticeDays?: number;
  };
  is_read?: boolean;
}

export interface Department {
  id: string;
  organizationId?: string;
  name: string;
  code?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AllowedUser {
  id: string;
  organizationId?: string;
  email: string;
  name: string;
  role: UserRole;
  department?: string;
  status: 'Active' | 'Inactive';
  addedBy: string;
  addedByEmail?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface PartnerEvaluation {
  id: string;
  organizationId?: string;
  review_date: string;
  year?: string | number;
  partner_id?: string;
  supplier_name: string;
  type_of_work?: string;
  sla_score?: number;
  obligation_target: 'Sangat baik' | 'Baik' | 'Kurang baik' | 'Met' | 'Not met';
  incident_frequency: 'Never' | 'Rare' | 'Frequent';
  communication: 'Sangat baik' | 'Baik' | 'Kurang baik' | 'Good' | 'Poor/Needs Improvement';
  pricing: 'Cheap' | 'Moderate' | 'Expensive';
  final_evaluation: 'Recommended' | 'Recommended with notes' | 'Not recommended' | 'Not reviewed';
  recommendation_status?: string;
  notes: string;
  calculated_score?: number;
  total_score?: number;
  evaluator_email?: string;
  evaluator_name?: string;
  created_at: string;
  updated_at: string;
}

export interface SpendingMonthAllocation {
  month: string; // YYYY-MM; separate from the legacy reporting month dates.
  amount: number; // Amount in the invoice currency, not USD.
}

export interface PartnerSpending {
  id: string;
  organizationId?: string;
  vendor_id?: string;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string; // ISO 8601 date (legacy rows may be DDMMYYYY)
  invoice_month: string[]; // end-of-month ISO dates, e.g. ["2026-08-31"] (legacy: MMYYYY)
  invoice_title?: string;
  month_allocations?: SpendingMonthAllocation[]; // Authoritative monthly breakdown; absent on legacy invoices.
  invoice_description?: string;
  currency: string;
  total_amount: number;
  total_amount_usd?: number;
  payment_status?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_account_holder_name?: string;
  invoice_file_url?: string;
  invoice_file_name?: string;
  billing_file_url?: string;
  billing_file_name?: string;
  folder_link?: string;
  created_at: string;
  updated_at?: string;
}

export interface ActivityLog {
  id: string;
  organizationId?: string;
  timestamp: string;
  userEmail: string;
  userName: string;
  role: UserRole;
  actionType: 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'ADD_USER' | 'REMOVE_USER' | 'NOTIF_SENT' | 'DD_UPDATE' | 'UPLOAD_SUCCESS' | 'UPLOAD_FAILED' | 'SYSTEM_ERROR' | string;
  module: 'AUTH' | 'ADMIN' | 'CONTRACT' | 'IO' | 'PARTNER' | 'AMENDMENT' | 'SYSTEM' | string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Operational view of the signed-in person inside the selected organization.
 * `role`/`department*` come from the verified capability context; the
 * platform role is separate and never doubles as a tenant role.
 */
export interface UserSession {
  id?: string;
  email: string;
  name: string;
  role: UserRole;
  department: string;
  departmentIds?: string[];
  loginTime?: string;
  organizationId?: string;
  platformRole?: 'user' | 'superuser';
}

export interface GoogleSheetsConfig {
  spreadsheetId?: string;
  masterSpreadsheetId?: string;
  masterSpreadsheetUrl?: string;
  driveFolderId: string;
  isConnected: boolean;
  lastSyncTime?: string;
  autoSync: boolean;
  accessToken?: string;
  refreshToken?: string;
  isLocked?: boolean;
  notificationEmails?: string;
  legalNotificationEmail?: string;
  financeNotificationEmail?: string;
  aiModel?: string;
  geminiApiKey?: string;
  smtpEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
}

export interface TenantBranding {
  appName: string;
  logoUrl: string;
  primaryColor: string;
  footerText: string;
  loginHeadline: string;
}

export interface Tenant {
  id: string;
  name: string;
  /** Country, industry, locale, currency, lifecycle and module configuration. */
  settings?: TenantSettings;
  legalEntity?: string;
  brandName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  currency?: string;
  domainSlug?: string;
  isDefault?: boolean;
  driveFolderId?: string;
  driveFolderLink?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AnalyzedClause {
  clauseTitle: string;
  riskCategory: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  originalTextOrIssue: string;
  identifiedRisk: string;
  recommendedRedline: string;
  legalRationale: string;
}

export interface ComplianceItem {
  item: string;
  status: 'COMPLIANT' | 'NEEDS_REVIEW' | 'NON_COMPLIANT';
  notes: string;
}

export interface RedlineAnalysisData {
  overallRiskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  executiveSummary: string;
  keyFindings: string[];
  analyzedClauses: AnalyzedClause[];
  complianceChecklist: ComplianceItem[];
  analyzed_at?: string;
}
