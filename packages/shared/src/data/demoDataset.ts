/**
 * Deterministic demo dataset used on first run and by "Reset → load demo data".
 * One organization (jurisdiction pack: Indonesia, industry pack: Banking & Investment).
 * Every company, person, address, e-mail domain and identifier is fictional; names are
 * deliberate twists on real Indonesian institutions.
 */
import { resolveTenantSettings } from '../policy/index';

type Row = Record<string, any>;

export interface DemoDataset {
  tenants: Row[];
  departments: Row[];
  allowedUsers: Row[];
  partners: Row[];
  contracts: Row[];
  ios: Row[];
  spendings: Row[];
  evaluations: Row[];
  notifications: Row[];
  activityLogs: Row[];
}

const ORG = 'org-demo-bmd';

function tenant(): Row {
  const settings = resolveTenantSettings({ settings: { countryCode: 'ID', industry: 'banking_investment' } });
  return {
    id: ORG,
    name: 'Bank Mindiri',
    legalEntity: 'PT Bank Mindiri (Persero) Tbk',
    brandName: 'Bank Mindiri',
    tagline: 'Contract Lifecycle Management',
    logoUrl: '/favicon.png',
    primaryColor: '#0090FF',
    currency: settings.defaultCurrency,
    settings,
    domainSlug: 'bank-mindiri',
    isDefault: true,
    spreadsheetId: '',
    driveFolderId: '',
  };
}

export const DEMO_TENANTS: Row[] = [tenant()];

const ts = (isoDate: string) => `${isoDate}T09:00:00.000Z`;
const PPN = 1.11; // Indonesian VAT 11%
const withPpn = (base: number) => Math.round(base * PPN);
const monthEnd = (isoDate: string) => {
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const idr = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const num = (n: number) => n.toLocaleString('id-ID');

interface PartnerSeed {
  id: string;
  name: string;
  jenis: string;
  category: string;
  pic: string;
  email: string;
  phone: string;
  address: string;
  picInternal: string;
  npwp: string;
  nib: string;
  notes: string;
  bank: { name: string; account: string };
  createdAt: string;
}

const PARTNERS: PartnerSeed[] = [
  {
    id: 'PRT-BMD-001',
    name: 'PT Telkomsagma Infrastruktur Digital',
    jenis: 'Vendor',
    category: 'Cloud Provider',
    pic: 'Rina Kusumawardani',
    email: 'rina.kusumawardani@telkomsagma.example.com',
    phone: '+62 21 5550 4412',
    address: 'Menara Sentra Digital Lt. 14, Jl. Jend. Sudirman Kav. 45, Jakarta Selatan 12930',
    picInternal: 'Information Technology',
    npwp: '02.418.907.3-017.000',
    nib: '8120004419027',
    notes: 'Penyedia colocation Tier-III (Cikarang) dan DR site (Surabaya). Sertifikasi ISO 27001 dan Uptime Tier III valid sampai 2027.',
    bank: { name: 'Bank Sentra Asia', account: '0663 8821 40' },
    createdAt: '2025-09-12',
  },
  {
    id: 'PRT-BMD-002',
    name: 'PT Pefindi Biro Kredit Indonesia',
    jenis: 'Vendor',
    category: 'Credit Bureau',
    pic: 'Hendra Wijayakusuma',
    email: 'hendra.wijayakusuma@pefindi-kredit.example.com',
    phone: '+62 21 5550 7731',
    address: 'Gedung Graha Informasi Lt. 9, Jl. Kuningan Barat Raya No. 18, Jakarta Selatan 12710',
    picInternal: 'Credit Risk Management',
    npwp: '01.874.236.9-052.000',
    nib: '9120008836114',
    notes: 'Layanan inquiry skor kredit dan laporan debitur untuk proses underwriting kredit ritel dan UMKM. Terhubung via API host-to-host.',
    bank: { name: 'Bank Negara Nusa', account: '1220 0987 5513' },
    createdAt: '2026-01-14',
  },
  {
    id: 'PRT-BMD-003',
    name: 'PT Vidia Verifikasi Digital',
    jenis: 'Vendor',
    category: 'KYC Provider',
    pic: 'Maya Anggraini Putri',
    email: 'maya.putri@vidia-verifikasi.example.com',
    phone: '+62 21 5550 2096',
    address: 'Gedung Kreasi Teknologi Lt. 6, Jl. TB Simatupang Kav. 22, Jakarta Selatan 12430',
    picInternal: 'Digital Banking',
    npwp: '03.552.118.4-063.000',
    nib: '9120012205873',
    notes: 'Penyedia e-KYC biometrik (face recognition, liveness detection, verifikasi NIK ke Dukcapil) untuk onboarding rekening digital.',
    bank: { name: 'Bank Permata Raya', account: '4021 7783 06' },
    createdAt: '2025-09-02',
  },
  {
    id: 'PRT-BMD-004',
    name: 'PT AntaVoya Mitra Wisata',
    jenis: 'Vendor',
    category: 'Travel Management',
    pic: 'Sari Puspitasari Wibowo',
    email: 'sari.wibowo@antavoya-wisata.example.com',
    phone: '+62 21 5550 9358',
    address: 'Gedung Wisata Niaga Lt. 8, Jl. Gatot Subroto Kav. 36-38, Jakarta Selatan 12930',
    picInternal: 'Human Capital & General Affairs',
    npwp: '01.309.774.5-014.000',
    nib: '8120001963308',
    notes: 'Travel management company untuk perjalanan dinas, akomodasi, dan penyelenggaraan rapat kerja (MICE). Anggota IATA dan ASITA, tersedia layanan darurat perjalanan 24 jam.',
    bank: { name: 'Bank Cimba Niaga', account: '8006 4471 2290' },
    createdAt: '2025-06-16',
  },
  {
    id: 'PRT-BMD-005',
    name: 'PT GroupN Media Indonesia',
    jenis: 'Vendor',
    category: 'Advertising Agency',
    pic: 'Dimas Aryo Pratama',
    email: 'dimas.pratama@groupn-media.example.com',
    phone: '+62 21 5550 5184',
    address: 'Gedung Kreatif Nusantara Lt. 17, Jl. Jend. Sudirman Kav. 52-53, Jakarta Selatan 12190',
    picInternal: 'Marketing & Corporate Communications',
    npwp: '01.126.540.2-073.000',
    nib: '8120007741560',
    notes: 'Media agency untuk perencanaan dan pembelian media digital, televisi, dan out-of-home. Agency fee 15% dari nilai media neto; laporan post-campaign dikirim maksimal 14 hari setelah kampanye berakhir.',
    bank: { name: 'Bank Mahkota Indonesia', account: '2077 9051 3342' },
    createdAt: '2025-03-18',
  },
];

function partnerRow(p: PartnerSeed): Row {
  return {
    partner_id: p.id,
    organizationId: ORG,
    partner_name: p.name,
    country: 'ID',
    entity_type: 'PT (Perseroan Terbatas)',
    partner_type: p.jenis,
    codename: '',
    pic_name: p.pic,
    pic_email: p.email,
    pic_phone: p.phone,
    pic_contact: `${p.email} / ${p.phone}`,
    pic_address: p.address,
    internal_pic: p.picInternal,
    notes: p.notes,
    tags: [p.category],
    identifiers: [
      { scheme: 'id_npwp', value: p.npwp, country: 'ID' },
      { scheme: 'id_nib', value: p.nib, country: 'ID' },
    ],
    dd_documents: [],
    dd_folder_link: '',
    created_at: ts(p.createdAt),
    updated_at: ts('2026-09-30'),
  };
}

const CONTRACTS: Row[] = [
  {
    contract_id: 'CTR-BMD-001', partner_id: 'PRT-BMD-001',
    contract_number: 'TSID/BMD/DC-0214/XI/2025',
    contract_title: 'Perjanjian Layanan Colocation Data Center dan Disaster Recovery',
    cooperation_categories: ['Cloud Provider'],
    start_date: '2025-11-01', end_date: '2028-10-31',
    contract_value: 23_760_000_000, auto_renewal: false, notice_period_days: 90,
    internal_pic: 'Information Technology',
    internal_notes: 'Mencakup 24 rack di Cikarang (primary) dan 8 rack di Surabaya (DR). SLA uptime 99,982%, denda 2% dari biaya bulanan per 0,1% di bawah SLA. Kenaikan harga tahunan dibatasi maks. 4%.',
  },
  {
    contract_id: 'CTR-BMD-002', partner_id: 'PRT-BMD-002',
    contract_number: 'PBKI/SLIK-ACC/0097/II/2026',
    contract_title: 'Perjanjian Layanan Informasi Skor Kredit dan Laporan Debitur',
    cooperation_categories: ['Credit Bureau'],
    start_date: '2026-02-01', end_date: '2027-01-31',
    contract_value: 4_200_000_000, auto_renewal: true, notice_period_days: 45,
    internal_pic: 'Credit Risk Management',
    internal_notes: 'Tarif per inquiry berjenjang: Rp 8.500 hingga 100.000 inquiry/bulan, Rp 7.900 di atas itu. Data hanya boleh dipakai untuk analisis kredit sesuai persetujuan debitur (UU PDP).',
  },
  {
    contract_id: 'CTR-BMD-003', partner_id: 'PRT-BMD-003',
    contract_number: 'VVD/BMD/EKYC/0318/IX/2025',
    contract_title: 'Perjanjian Penyediaan Layanan e-KYC Biometrik untuk Onboarding Digital',
    cooperation_categories: ['KYC Provider'],
    start_date: '2025-09-15', end_date: '2026-12-15',
    contract_value: 2_400_000_000, auto_renewal: false, notice_period_days: 60,
    internal_pic: 'Digital Banking',
    internal_notes: 'Perpanjangan perlu diputuskan sebelum 16 Oktober 2026 (batas notice 60 hari). Evaluasi tingkat false rejection 3,1% masih di atas target 2,5%; bahan negosiasi ulang tarif.',
  },
  {
    contract_id: 'CTR-BMD-004', partner_id: 'PRT-BMD-004',
    contract_number: 'AVMW/BMD/TMC/0045/VII/2025',
    contract_title: 'Perjanjian Layanan Manajemen Perjalanan Dinas dan Penyelenggaraan Rapat Kerja (MICE)',
    cooperation_categories: ['Travel Management'],
    start_date: '2025-07-01', end_date: '2027-06-30',
    contract_value: 14_400_000_000, auto_renewal: true, notice_period_days: 90,
    internal_pic: 'Human Capital & General Affairs',
    internal_notes: 'Service fee 3% dari nilai tiket domestik, Rp 150.000 per tiket internasional, tanpa markup hotel (harga korporat). Pemesanan darurat dilayani maksimal 2 jam. Laporan konsolidasi perjalanan per departemen dikirim setiap tanggal 5.',
  },
  {
    contract_id: 'CTR-BMD-005', partner_id: 'PRT-BMD-005',
    contract_number: 'GRPN/BMD/MEDIA/0126/IV/2025',
    contract_title: 'Perjanjian Jasa Perencanaan dan Pembelian Media (Media Agency)',
    cooperation_categories: ['Advertising Agency'],
    start_date: '2025-04-01', end_date: '2027-03-31',
    contract_value: 36_000_000_000, auto_renewal: false, notice_period_days: 90,
    internal_pic: 'Marketing & Corporate Communications',
    internal_notes: 'Agency fee 15% dari nilai media neto. Rebate volume dari media owner wajib dilaporkan dan dikembalikan 100% kepada bank. Hak audit atas invoice media owner tersedia selama 24 bulan.',
  },
];

function contractRow(c: Row): Row {
  const partner = PARTNERS.find((p) => p.id === c.partner_id)!;
  return {
    organizationId: ORG,
    document_type: 'Master Agreement',
    currency: 'IDR',
    notice_type_required: 'Termination',
    status: 'Active',
    status_approval: 'Signed',
    contract_file_link: '',
    created_at: ts(c.start_date),
    updated_at: ts('2026-09-30'),
    ...c,
  };
}

const IOS: Row[] = [
  {
    io_id: 'IO-BMD-001', contract_id: 'CTR-BMD-001',
    io_number: 'BMD/IO/DC-2026/0031',
    io_title: 'Order Layanan Colocation 24 Rack Cikarang dan 8 Rack DR Surabaya Tahun 2026',
    media_channel: 'Colocation & Disaster Recovery',
    pricing_model: 'Fixed', charging_type: 'Postpaid',
    start_date: '2026-01-01', end_date: '2026-12-31',
    io_value: 7_920_000_000, notice_period_days: 60,
    deliverables: 'Rack, daya 6 kVA per rack, konektivitas cross-connect redundan, remote hands 24x7, uji failover DR semester I dan II.',
    internal_notes: 'Biaya bulanan tetap Rp 660.000.000 sebelum PPN. Tambahan rack dikenakan Rp 22.000.000 per rack per bulan.',
  },
  {
    io_id: 'IO-BMD-002', contract_id: 'CTR-BMD-002',
    io_number: 'BMD/IO/CRD-2026/0012',
    io_title: 'Order Inquiry Skor Kredit dan Laporan Debitur Segmen Ritel dan UMKM',
    media_channel: 'Credit Scoring API',
    pricing_model: 'CPA', charging_type: 'Postpaid',
    start_date: '2026-02-01', end_date: '2027-01-31',
    io_value: 3_000_000_000, notice_period_days: 30,
    deliverables: 'Akses API skor kredit, laporan debitur lengkap, notifikasi perubahan kolektibilitas, rekonsiliasi volume inquiry bulanan.',
    internal_notes: 'Estimasi 350.000 inquiry per tahun. Volume aktual dilaporkan vendor paling lambat tanggal 5 bulan berikutnya.',
  },
  {
    io_id: 'IO-BMD-003', contract_id: 'CTR-BMD-003',
    io_number: 'BMD/IO/KYC-2026/0007',
    io_title: 'Order Paket Verifikasi e-KYC Biometrik Aplikasi Mindiri Nova',
    media_channel: 'Biometric e-KYC',
    pricing_model: 'CPA', charging_type: 'Prepaid',
    start_date: '2026-03-01', end_date: '2026-12-15',
    io_value: 1_620_000_000, notice_period_days: 30,
    deliverables: 'Verifikasi NIK ke Dukcapil, face matching, liveness detection, dashboard monitoring dan laporan penolakan bulanan.',
    internal_notes: 'Skema top-up kuota. Sisa kuota tidak hangus selama kontrak induk berlaku. Harga per verifikasi turun di setiap top-up berikutnya.',
  },
  {
    io_id: 'IO-BMD-004', contract_id: 'CTR-BMD-004',
    io_number: 'BMD/IO/TRV-2026/0014',
    io_title: 'Order Perjalanan Dinas, Akomodasi, dan Rapat Kerja Nasional Tahun 2026',
    media_channel: 'Corporate Travel & MICE',
    pricing_model: 'Commission', charging_type: 'Postpaid',
    start_date: '2026-01-01', end_date: '2026-12-31',
    io_value: 6_000_000_000, notice_period_days: 30,
    deliverables: 'Pemesanan tiket dan hotel perjalanan dinas, Rapat Kerja Nasional Bali (180 peserta), trip insentif top performer, laporan perjalanan bulanan.',
    internal_notes: 'Estimasi 400 tiket domestik per bulan. Perjalanan di atas Rp 25.000.000 per orang memerlukan persetujuan Head of Human Capital.',
  },
  {
    io_id: 'IO-BMD-005', contract_id: 'CTR-BMD-005',
    io_number: 'BMD/IO/ADS-2026/0009',
    io_title: 'Order Kampanye Tabungan Mindiri Nova Periode April-Desember 2026',
    media_channel: 'Digital, TV & OOH Media Buying',
    pricing_model: 'CPM', charging_type: 'Postpaid',
    start_date: '2026-04-01', end_date: '2026-12-31',
    io_value: 9_600_000_000, notice_period_days: 30,
    deliverables: 'Media plan, pembelian media digital, spot TV prime time, videotron dan billboard Jabodetabek, laporan post-campaign dan verifikasi tayang.',
    internal_notes: 'Harga digital dihitung per 1.000 impresi (CPM) sesuai rate card yang disetujui. Perubahan media plan di atas 10% dari anggaran memerlukan persetujuan tertulis Marketing.',
  },
];

function ioRow(io: Row): Row {
  const contract = CONTRACTS.find((c) => c.contract_id === io.contract_id)!;
  return {
    organizationId: ORG,
    contract_number: contract.contract_number,
    partner_id: contract.partner_id,
    currency: 'IDR',
    notice_type_required: 'Termination',
    status: 'Active',
    created_at: ts(io.start_date),
    updated_at: ts('2026-09-30'),
    ...io,
  };
}

interface InvoiceSeed {
  id: string;
  partnerId: string;
  number: string;
  date: string;
  /** Month(s) the invoice covers, as YYYY-MM-DD in that month. */
  months: string[];
  title: string;
  /** Pre-VAT amount. */
  base: number;
  detail: string;
  paid: boolean;
}

const INVOICES: InvoiceSeed[] = [
  // PT Telkomsagma Infrastruktur Digital: fixed monthly colocation, plus extra racks in August.
  { id: 'SP-BMD-0001', partnerId: 'PRT-BMD-001', number: 'TSID/INV/2026/06/00418', date: '2026-07-03', months: ['2026-06-01'], title: 'Colocation Juni 2026', base: 660_000_000, detail: 'Paket colocation 24 rack Cikarang + 8 rack DR Surabaya periode Juni 2026', paid: true },
  { id: 'SP-BMD-0002', partnerId: 'PRT-BMD-001', number: 'TSID/INV/2026/07/00452', date: '2026-08-04', months: ['2026-07-01'], title: 'Colocation Juli 2026', base: 660_000_000, detail: 'Paket colocation 24 rack Cikarang + 8 rack DR Surabaya periode Juli 2026', paid: true },
  { id: 'SP-BMD-0003', partnerId: 'PRT-BMD-001', number: 'TSID/INV/2026/08/00497', date: '2026-09-03', months: ['2026-08-01'], title: 'Colocation Agustus 2026 + 4 Rack Tambahan', base: 660_000_000 + 4 * 22_000_000, detail: 'Paket colocation periode Agustus 2026 ditambah 4 rack tambahan Cikarang (4 × Rp 22.000.000) untuk migrasi data warehouse', paid: true },
  { id: 'SP-BMD-0004', partnerId: 'PRT-BMD-001', number: 'TSID/INV/2026/09/00531', date: '2026-10-02', months: ['2026-09-01'], title: 'Colocation September 2026 + 4 Rack Tambahan', base: 660_000_000 + 4 * 22_000_000, detail: 'Paket colocation periode September 2026 ditambah 4 rack tambahan Cikarang', paid: false },

  // PT Pefindi Biro Kredit Indonesia: per-inquiry billing that tracks monthly volume.
  { id: 'SP-BMD-0005', partnerId: 'PRT-BMD-002', number: 'PBKI-INV-26-04-0713', date: '2026-05-06', months: ['2026-04-01'], title: 'Inquiry SLIK April 2026', base: 61_240 * 8_500, detail: `${num(61_240)} inquiry × ${idr(8_500)} periode April 2026`, paid: true },
  { id: 'SP-BMD-0006', partnerId: 'PRT-BMD-002', number: 'PBKI-INV-26-05-0788', date: '2026-06-05', months: ['2026-05-01'], title: 'Inquiry SLIK Mei 2026', base: 58_905 * 8_500, detail: `${num(58_905)} inquiry × ${idr(8_500)} periode Mei 2026`, paid: true },
  { id: 'SP-BMD-0007', partnerId: 'PRT-BMD-002', number: 'PBKI-INV-26-06-0841', date: '2026-07-06', months: ['2026-06-01'], title: 'Inquiry SLIK Juni 2026', base: 72_318 * 8_500, detail: `${num(72_318)} inquiry × ${idr(8_500)} periode Juni 2026 (kampanye KUR UMKM)`, paid: true },
  { id: 'SP-BMD-0008', partnerId: 'PRT-BMD-002', number: 'PBKI-INV-26-08-0967', date: '2026-09-07', months: ['2026-08-01'], title: 'Inquiry SLIK Agustus 2026', base: 104_562 * 7_900, detail: `${num(104_562)} inquiry × ${idr(7_900)} (tarif berjenjang di atas 100.000 inquiry) periode Agustus 2026`, paid: false },

  // PT Vidia Verifikasi Digital: prepaid quota top-ups with falling unit price.
  { id: 'SP-BMD-0009', partnerId: 'PRT-BMD-003', number: 'VVD/2026/03/TOPUP-0114', date: '2026-03-04', months: ['2026-03-01'], title: 'Top-up Kuota e-KYC Tahap 1', base: 100_000 * 4_200, detail: `Top-up ${num(100_000)} verifikasi biometrik × ${idr(4_200)}`, paid: true },
  { id: 'SP-BMD-0010', partnerId: 'PRT-BMD-003', number: 'VVD/2026/06/TOPUP-0262', date: '2026-06-09', months: ['2026-06-01'], title: 'Top-up Kuota e-KYC Tahap 2', base: 150_000 * 4_000, detail: `Top-up ${num(150_000)} verifikasi biometrik × ${idr(4_000)}`, paid: true },
  { id: 'SP-BMD-0011', partnerId: 'PRT-BMD-003', number: 'VVD/2026/09/TOPUP-0397', date: '2026-09-15', months: ['2026-09-01'], title: 'Top-up Kuota e-KYC Tahap 3', base: 100_000 * 3_900, detail: `Top-up ${num(100_000)} verifikasi biometrik × ${idr(3_900)}`, paid: false },

  // PT AntaVoya Mitra Wisata: monthly business travel (tickets + 3% service fee), a national meeting, and an incentive trip.
  { id: 'SP-BMD-0012', partnerId: 'PRT-BMD-004', number: 'AVMW/INV/2026/03/1186', date: '2026-04-06', months: ['2026-03-01'], title: 'Perjalanan Dinas Maret 2026', base: Math.round(436 * 1_720_000 * 1.03), detail: `${num(436)} tiket domestik × rata-rata ${idr(1_720_000)} ditambah service fee 3%`, paid: true },
  { id: 'SP-BMD-0013', partnerId: 'PRT-BMD-004', number: 'AVMW/INV/2026/05/1342-MICE', date: '2026-05-29', months: ['2026-05-01'], title: 'Rapat Kerja Nasional 2026, Bali', base: 180 * 3 * 1_450_000 + 180 * 2 * 485_000 + 180 * 2_150_000, detail: `RAKERNAS Bali 180 peserta: akomodasi 3 malam (180 × 3 × ${idr(1_450_000)}), paket meeting 2 hari (180 × 2 × ${idr(485_000)}), tiket grup PP (180 × ${idr(2_150_000)})`, paid: true },
  { id: 'SP-BMD-0014', partnerId: 'PRT-BMD-004', number: 'AVMW/INV/2026/07/1479', date: '2026-08-05', months: ['2026-07-01'], title: 'Perjalanan Dinas Juli 2026', base: Math.round(398 * 1_690_000 * 1.03), detail: `${num(398)} tiket domestik × rata-rata ${idr(1_690_000)} ditambah service fee 3%`, paid: true },
  { id: 'SP-BMD-0015', partnerId: 'PRT-BMD-004', number: 'AVMW/INV/2026/09/1603-INC', date: '2026-10-01', months: ['2026-08-01', '2026-09-01'], title: 'Perjalanan Dinas Agustus dan Trip Insentif Top Performer Jepang', base: Math.round(391 * 1_705_000 * 1.03) + 24 * 31_500_000, detail: `${num(391)} tiket domestik × rata-rata ${idr(1_705_000)} + service fee 3%; trip insentif Tokyo-Kyoto 6 hari untuk 24 top performer (24 × ${idr(31_500_000)})`, paid: false },

  // PT GroupN Media Indonesia: media buying at net cost plus a 15% agency fee.
  { id: 'SP-BMD-0016', partnerId: 'PRT-BMD-005', number: 'GRPN/INV/2026/04/0231', date: '2026-05-08', months: ['2026-04-01'], title: 'Kampanye Digital Ramadan April 2026', base: Math.round((41_200_000 / 1000) * 38_000 * 1.15), detail: `${num(41_200_000)} impresi digital × CPM ${idr(38_000)} ditambah agency fee 15% (Google, Meta, TikTok)`, paid: true },
  { id: 'SP-BMD-0017', partnerId: 'PRT-BMD-005', number: 'GRPN/INV/2026/06/0307-OOH', date: '2026-07-07', months: ['2026-06-01'], title: 'OOH Jabodetabek Juni 2026', base: Math.round(48 * 28_000_000 * 1.15), detail: `48 titik videotron dan billboard Jabodetabek × ${idr(28_000_000)} per titik per bulan ditambah agency fee 15%`, paid: true },
  { id: 'SP-BMD-0018', partnerId: 'PRT-BMD-005', number: 'GRPN/INV/2026/08/0388-TV', date: '2026-09-04', months: ['2026-08-01'], title: 'Spot TV Prime Time Agustus 2026', base: Math.round(120 * 14_750_000 * 1.15), detail: `120 spot TV prime time × ${idr(14_750_000)} ditambah agency fee 15% (verifikasi tayang terlampir)`, paid: true },
  { id: 'SP-BMD-0019', partnerId: 'PRT-BMD-005', number: 'GRPN/INV/2026/09/0452', date: '2026-10-02', months: ['2026-09-01'], title: 'Kampanye Digital September 2026', base: Math.round((52_800_000 / 1000) * 36_500 * 1.15), detail: `${num(52_800_000)} impresi digital × CPM ${idr(36_500)} ditambah agency fee 15%`, paid: false },
];

function spendingRow(inv: InvoiceSeed): Row {
  const partner = PARTNERS.find((p) => p.id === inv.partnerId)!;
  const total = withPpn(inv.base);
  const perMonth = Math.floor(total / inv.months.length);
  return {
    id: inv.id,
    organizationId: ORG,
    vendor_id: partner.id,
    vendor_name: partner.name,
    invoice_number: inv.number,
    invoice_date: inv.date,
    invoice_month: inv.months.map(monthEnd),
    invoice_title: inv.title,
    month_allocations: inv.months.map((m, i) => ({
      month: m.slice(0, 7),
      amount: i === inv.months.length - 1 ? total - perMonth * (inv.months.length - 1) : perMonth,
    })),
    invoice_description: `${inv.detail}. Sudah termasuk PPN 11%.`,
    currency: 'IDR',
    total_amount: total,
    payment_status: inv.paid ? 'Paid' : 'Unpaid',
    bank_name: partner.bank.name,
    bank_account_number: partner.bank.account,
    bank_account_holder_name: partner.name,
    created_at: ts(inv.date),
  };
}

export function buildDemoDataset(_now: Date = new Date()): DemoDataset {
  const createdAt = '2024-06-01T09:00:00.000Z';
  return {
    tenants: DEMO_TENANTS.map((item) => ({ ...item, settings: { ...item.settings }, created_at: createdAt, updated_at: '2026-10-01T09:00:00.000Z' })),
    // Every demo partner's internal PIC is a department here, so seeded records are department-owned.
    departments: ['Legal', 'Information Technology', 'Credit Risk Management', 'Digital Banking', 'Treasury & Investment', 'Procurement',
      'Human Capital & General Affairs', 'Marketing & Corporate Communications'].map((name, i) => ({
      id: `team-demo-bmd-${i + 1}`, organizationId: ORG, name, created_at: createdAt, updated_at: createdAt,
    })),
    allowedUsers: [
      { id: 'usr-demo-bmd-admin', organizationId: ORG, email: 'admin.bankmindiri@example.com', name: 'Admin Legal Bank Mindiri', role: 'Admin', department: 'Legal', status: 'Active', addedBy: 'Demo dataset', createdAt },
    ],
    partners: PARTNERS.map(partnerRow),
    contracts: CONTRACTS.map(contractRow),
    ios: IOS.map(ioRow),
    spendings: INVOICES.map(spendingRow),
    evaluations: [],
    notifications: [],
    activityLogs: [],
  };
}
