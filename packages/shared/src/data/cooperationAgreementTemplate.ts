import { getCountryPack, localize, type TenantSettings } from '../policy/index';

/**
 * Jurisdiction wording used by the built-in cooperation agreement. It comes
 * from the organization's country pack (and its overrides) instead of being
 * hardcoded, so the same template works for any supported jurisdiction.
 */
export interface AgreementJurisdiction {
  governingLaw: { en: string; id: string };
  disputeVenue: { en: string; id: string };
  holidayJurisdiction: { en: string; id: string };
  dataProtectionLaw: string;
  indirectTaxName: string;
  stampDuty: { en: string; id: string } | null;
}

export function jurisdictionFromSettings(settings: Pick<TenantSettings, 'countryCode' | 'governingLaw' | 'disputeVenue'>): AgreementJurisdiction {
  const pack = getCountryPack(settings.countryCode);
  const neutral = pack.code === 'INTL';
  return {
    governingLaw: settings.governingLaw
      ? { en: settings.governingLaw, id: settings.governingLaw }
      : { en: localize(pack.governingLaw, 'EN'), id: localize(pack.governingLaw, 'ID') },
    disputeVenue: settings.disputeVenue
      ? { en: settings.disputeVenue, id: settings.disputeVenue }
      : { en: localize(pack.disputeVenue, 'EN'), id: localize(pack.disputeVenue, 'ID') },
    holidayJurisdiction: neutral
      ? { en: 'the place where the relevant obligation is to be performed', id: 'tempat kewajiban yang bersangkutan dilaksanakan' }
      : { en: pack.name, id: pack.name },
    dataProtectionLaw: pack.dataProtectionLaw,
    indirectTaxName: pack.indirectTaxName,
    stampDuty: pack.stampDutyConvention
      ? { en: localize(pack.stampDutyConvention, 'EN'), id: localize(pack.stampDutyConvention, 'ID') }
      : null,
  };
}

let activeJurisdiction: AgreementJurisdiction = jurisdictionFromSettings({ countryCode: 'INTL' });

/** Set before rendering the template (the contract creator does this from tenant settings). */
export function setAgreementJurisdiction(next: AgreementJurisdiction): void {
  activeJurisdiction = next;
}

const J = () => activeJurisdiction;

export interface AgreementArticle {
  id: string;
  articleNumber?: number;
  titleEn: string;
  titleId: string;
  contentEn: string;
  contentId: string;
}

export interface FillableFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'currency' | 'textarea';
  icon: string;
  placeholder: string;
  defaultValue: string;
  description: string;
}

export const COOPERATION_AGREEMENT_FIELDS: FillableFieldDef[] = [
  // --- PIHAK PERTAMA (FIRST PARTY) ---
  {
    key: 'firstPartyName',
    label: 'Nama Perusahaan Pihak Pertama',
    type: 'text',
    icon: '🏛️',
    placeholder: 'PT Nama Perusahaan Pihak Pertama',
    defaultValue: '',
    description: 'Badan hukum atau perusahaan Pihak Pertama pembuat perjanjian',
  },
  {
    key: 'firstPartyAlias',
    label: 'Singkatan / Sebutan Pihak Pertama',
    type: 'text',
    icon: '🏷️',
    placeholder: 'Singkatan / Sebutan Singkat Pihak Pertama',
    defaultValue: '',
    description: 'Sebutan singkat pihak pertama di dalam klausul perjanjian',
  },
  {
    key: 'firstPartyAddress',
    label: 'Alamat Kantor Pihak Pertama',
    type: 'textarea',
    icon: '📍',
    placeholder: 'Alamat lengkap domisili kantor resmi pihak pertama',
    defaultValue: '',
    description: 'Alamat domisili hukum pihak pertama untuk korespondensi resmi',
  },
  {
    key: 'firstPartyPic',
    label: 'Nama Penandatangan Pihak Pertama',
    type: 'text',
    icon: '👤',
    placeholder: 'Nama Direktur / Pejabat Berwenang Pihak Pertama',
    defaultValue: '',
    description: 'Wakil sah pihak pertama yang menandatangani perjanjian',
  },
  {
    key: 'firstPartyPosition',
    label: 'Jabatan Penandatangan Pihak Pertama',
    type: 'text',
    icon: '💼',
    placeholder: 'Direktur Utama / Direktur',
    defaultValue: 'Direktur Utama',
    description: 'Kapasitas hukum pejabat pihak pertama',
  },
  {
    key: 'firstPartyEmail',
    label: 'Email Resmi Pihak Pertama',
    type: 'text',
    icon: '📧',
    placeholder: 'legal@perusahaan-pihak1.co.id',
    defaultValue: '',
    description: 'Alamat email korespondensi dan notifikasi resmi pihak pertama (Pasal 13)',
  },
  {
    key: 'firstPartyBusinessDesc',
    label: 'Keterangan Bisnis Pihak Pertama (Konsiderans)',
    type: 'textarea',
    icon: '🏢',
    placeholder: 'Uraian izin dan bidang usaha pihak pertama...',
    defaultValue: '',
    description: 'Deskripsi bidang usaha pihak pertama pada bagian konsiderans',
  },

  // --- PIHAK KEDUA (SECOND PARTY / MITRA) ---
  {
    key: 'partnerName',
    label: 'Nama Perusahaan Pihak Kedua',
    type: 'text',
    icon: '🏢',
    placeholder: 'PT Nama Mitra Usaha',
    defaultValue: '',
    description: 'Badan hukum atau perusahaan mitra yang mengadakan kerjasama',
  },
  {
    key: 'partnerAlias',
    label: 'Singkatan / Sebutan Pihak Kedua',
    type: 'text',
    icon: '🏷️',
    placeholder: 'Singkatan / Sebutan Singkat Pihak Kedua',
    defaultValue: '',
    description: 'Sebutan singkat pihak kedua di dalam klausul perjanjian',
  },
  {
    key: 'partnerAddress',
    label: 'Alamat Kantor Pihak Kedua',
    type: 'textarea',
    icon: '📍',
    placeholder: 'Alamat lengkap domisili kantor resmi mitra',
    defaultValue: '',
    description: 'Alamat korespondensi dan hukum pihak kedua',
  },
  {
    key: 'partnerPic',
    label: 'Nama Penandatangan Pihak Kedua',
    type: 'text',
    icon: '👤',
    placeholder: 'Nama Lengkap Direktur / Wakil Sah',
    defaultValue: '',
    description: 'Pejabat berwenang mewakili mitra menandatangani perjanjian',
  },
  {
    key: 'partnerPosition',
    label: 'Jabatan Penandatangan Pihak Kedua',
    type: 'text',
    icon: '💼',
    placeholder: 'Direktur Utama / Direktur',
    defaultValue: 'Direktur Utama',
    description: 'Kapasitas hukum pejabat penandatangan mitra',
  },
  {
    key: 'partnerEmail',
    label: 'Email Resmi Pihak Kedua',
    type: 'text',
    icon: '📧',
    placeholder: 'legal@mitra.co.id',
    defaultValue: 'legal@mitra.co.id',
    description: 'Email resmi pemberitahuan dan korespondensi hukum mitra (Pasal 13)',
  },
  {
    key: 'partnerBusinessDesc',
    label: 'Keterangan Bisnis Pihak Kedua (Konsiderans)',
    type: 'textarea',
    icon: '🏢',
    placeholder: 'Uraian izin dan bidang usaha pihak kedua...',
    defaultValue: '',
    description: 'Deskripsi bidang usaha pihak kedua pada bagian konsiderans',
  },

  // --- WAKTU, LINGKUP & KOMERSIAL ---
  {
    key: 'dateStr',
    label: 'Tanggal Penandatanganan',
    type: 'date',
    icon: '📅',
    placeholder: '19 September 2026',
    defaultValue: '19 September 2026',
    description: 'Tanggal efektif pengikatan perjanjian kerjasama',
  },
  {
    key: 'startDate',
    label: 'Tanggal Mulai Berlaku',
    type: 'date',
    icon: '📅',
    placeholder: '19 September 2026',
    defaultValue: '19 September 2026',
    description: 'Awal periode pelaksanaan kerjasama (Pasal 3)',
  },
  {
    key: 'endDate',
    label: 'Tanggal Berakhir',
    type: 'date',
    icon: '📅',
    placeholder: '18 September 2027',
    defaultValue: '18 September 2027',
    description: 'Akhir periode kerjasama sebelum perpanjangan (Pasal 3)',
  },
  {
    key: 'scopeDescId',
    label: 'Ruang Lingkup Kerjasama',
    type: 'textarea',
    icon: '📝',
    placeholder: 'penyediaan layanan teknologi, integrasi sistem informasi, dan dukungan operasional bersama',
    defaultValue: 'penyediaan layanan teknologi, integrasi sistem informasi, dan dukungan operasional bersama',
    description: 'Uraian pokok aktivitas dan hasil kerja yang disepakati (Pasal 2)',
  },
  {
    key: 'feeAmountId',
    label: 'Nilai Kerjasama / Biaya Jasa',
    type: 'currency',
    icon: '💰',
    placeholder: '100.000 (seratus ribu) belum termasuk pajak',
    defaultValue: '',
    description: 'Kompensasi atau imbalan jasa yang disepakati (Pasal 5)',
  },
  {
    key: 'bankName',
    label: 'Nama Bank Pembayaran',
    type: 'text',
    icon: '🏦',
    placeholder: 'Nama bank',
    defaultValue: '',
    description: 'Bank penampung pembayaran resmi (Pasal 5)',
  },
  {
    key: 'bankAccount',
    label: 'Nomor Rekening Bank',
    type: 'text',
    icon: '#️⃣',
    placeholder: 'Nomor rekening / IBAN',
    defaultValue: '',
    description: 'Nomor rekening tujuan pembayaran transfer',
  },
  {
    key: 'bankHolder',
    label: 'Atas Nama Rekening',
    type: 'text',
    icon: '🏢',
    placeholder: 'Nama Pemilik Rekening Bank',
    defaultValue: '',
    description: 'Nama pemilik rekening bank resmi pihak penerima',
  },
];

export const COOPERATION_AGREEMENT_HEADER = {
  titleEn: 'COOPERATION AGREEMENT',
  titleId: 'PERJANJIAN KERJASAMA',
  docNumberPrefix: 'Nomor Perjanjian:',
};

/**
 * Helper to render an inline fillable field badge matching the visual specification:
 * Shows a bordered box with type icon (T, 📅, 💰, etc.) and clear placeholder/value.
 */
export function renderFillableSlot(
  type: 'text' | 'date' | 'currency' | 'entity' | 'person' | 'location' | 'number',
  key: string,
  placeholderText: string,
  currentValue?: string,
  mode: 'edit' | 'plain' = 'edit'
): string {
  const isPlain = mode === 'plain';
  const hasValue = Boolean(currentValue && currentValue.trim() && !currentValue.startsWith('[') && currentValue !== '...');
  const val = hasValue ? currentValue!.trim() : '...';

  if (isPlain) {
    return hasValue ? currentValue!.trim() : `[...]`;
  }

  const iconMap: Record<string, string> = {
    text: 'T',
    date: '📅',
    currency: '💰',
    entity: '🏢',
    person: '👤',
    location: '📍',
    number: '#️⃣',
  };

  const icon = iconMap[type] || 'T';
  const isFilled = hasValue;

  return `<span class="fillable-slot ${isFilled ? 'slot-filled' : 'slot-empty'}" draggable="true" data-slot-key="${key}" data-slot-type="${type}" contenteditable="true">
  <span class="slot-icon-badge">${icon}</span>
  <span class="slot-text">${val}</span>
</span>`;
}

/**
 * Strips any residual interactive fillable-slot HTML span elements into clean plain text
 */
export function stripFillableSlotsToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<span[^>]*class=["'][^"']*fillable-slot[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*slot-text[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/span>/gi, '$1')
    .replace(/<span[^>]*class=["'][^"']*fillable-slot[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '$1');
}

export const COOPERATION_AGREEMENT_PREAMBLE = {
  en: (slots?: Record<string, string>, modeParam?: 'edit' | 'plain') => {
    const mode: 'edit' | 'plain' = (slots?._mode === 'plain' || modeParam === 'plain') ? 'plain' : 'edit';
    const slot = (type: any, key: string, placeholder: string, val?: string) =>
      renderFillableSlot(type, key, placeholder, val, mode);

    const p1Name = slots?.firstPartyName || '';
    const p1Alias = slots?.firstPartyAlias || '';
    const p1Address = slots?.firstPartyAddress || '';
    const p1Pic = slots?.firstPartyPic || '';
    const p1Pos = slots?.firstPartyPosition || '';
    const p1Desc = slots?.firstPartyBusinessDesc || '';
    const p2Alias = slots?.partnerAlias || '';
    const p2Desc = slots?.partnerBusinessDesc || '';

    return `<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
This Cooperation Agreement (hereinafter referred to as the &ldquo;<strong>Agreement</strong>&rdquo;) is made and entered into on this day ${slot('date', 'dateStr', 'DD/MM/YYYY', slots?.dateStr)}, by and between:
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
1. <strong>${slot('entity', 'firstPartyName', 'First Party Corporate Name', p1Name)}</strong>, a company duly incorporated under ${J().governingLaw.en}, having its registered domicile at ${slot('location', 'firstPartyAddress', 'First Party Domicile Address', p1Address)}, represented by <strong>${slot('person', 'firstPartyPic', 'First Party Signatory Name', p1Pic)}</strong> in their capacity as the <strong>${slot('text', 'firstPartyPosition', 'First Party Signatory Position', p1Pos)}</strong>, therefore lawfully acting for and on behalf of ${slot('entity', 'firstPartyName', 'First Party Name', p1Name)} (hereinafter referred to as &ldquo;<strong>${slot('text', 'firstPartyAlias', 'First Party Alias', p1Alias)}</strong>&rdquo; or the &ldquo;<strong>First Party</strong>&rdquo;);
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
And
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
2. <strong>${slot('entity', 'partnerName', 'Second Party Corporate Name', slots?.partnerName)}</strong>, a legal entity duly incorporated under the laws of its jurisdiction of incorporation, having its registered domicile at ${slot('location', 'partnerAddress', 'Second Party Domicile Address', slots?.partnerAddress)}, represented in this matter by ${slot('person', 'partnerPic', 'Second Party Signatory Name', slots?.partnerPic)} in their capacity as ${slot('text', 'partnerPosition', 'Director / Authorized Representative', slots?.partnerPosition)}, therefore lawfully acting for and on behalf of ${slot('entity', 'partnerName', 'Second Party Corporate Name', slots?.partnerName)} (hereinafter referred to as &ldquo;<strong>${slot('text', 'partnerAlias', 'Second Party Alias', p2Alias)}</strong>&rdquo; or the &ldquo;<strong>Second Party</strong>&rdquo;).
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
The First Party and the Second Party are collectively referred to as the &ldquo;<strong>Parties</strong>&rdquo; and individually as a &ldquo;<strong>Party</strong>&rdquo;.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
<strong>WITNESSETH:</strong>
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
WHEREAS, the First Party is ${slot('text', 'firstPartyBusinessDesc', 'First Party Business Description', p1Desc)}.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
WHEREAS, the Second Party is ${slot('text', 'partnerBusinessDesc', 'Second Party Business Description', p2Desc)}.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
WHEREAS, the Parties have agreed to execute this Cooperation Agreement to govern the legal framework, rights, obligations, service delivery, and operational parameters of their business cooperation on the basis of mutual benefit and applicable laws.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 14px;">
<strong>NOW, THEREFORE</strong>, based on the foregoing recitals and mutual covenants herein contained, the Parties hereby agree as follows:
</p>`;
  },

  id: (slots?: Record<string, string>, modeParam?: 'edit' | 'plain') => {
    const mode: 'edit' | 'plain' = (slots?._mode === 'plain' || modeParam === 'plain') ? 'plain' : 'edit';
    const slot = (type: any, key: string, placeholder: string, val?: string) =>
      renderFillableSlot(type, key, placeholder, val, mode);

    const p1Name = slots?.firstPartyName || '';
    const p1Alias = slots?.firstPartyAlias || '';
    const p1Address = slots?.firstPartyAddress || '';
    const p1Pic = slots?.firstPartyPic || '';
    const p1Pos = slots?.firstPartyPosition || '';
    const p1Desc = slots?.firstPartyBusinessDesc || '';
    // "MITRA" is what the other 15 articles already call the Second Party by default (Pasal
    // 1.2, 2.3, 4.1–4.2, 5.2, and the signature blocks) — keeping it as the fallback here means
    // a document nobody touches this new field on still reads exactly as it did before.
    const p2Alias = slots?.partnerAlias || 'MITRA';
    const p2Desc = slots?.partnerBusinessDesc || '';

    return `<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
Perjanjian Kerjasama ini (selanjutnya disebut sebagai &ldquo;<strong>Perjanjian</strong>&rdquo;) dibuat dan ditandatangani pada hari ${slot('date', 'dateStr', 'Hari, DD/MM/YYYY (Contoh: Senin, 19 September 2026)', slots?.dateStr)}, oleh dan antara:
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
1. <strong>${slot('entity', 'firstPartyName', 'Nama Perusahaan Pihak Pertama', p1Name)}</strong>, suatu badan usaha yang didirikan berdasarkan ${J().governingLaw.id}, berkedudukan di ${slot('location', 'firstPartyAddress', 'Alamat Lengkap Kantor Pihak Pertama', p1Address)}, dalam hal ini diwakili oleh <strong>${slot('person', 'firstPartyPic', 'Nama Penandatangan Pihak Pertama', p1Pic)}</strong> dalam kapasitasnya selaku <strong>${slot('text', 'firstPartyPosition', 'Jabatan Penandatangan Pihak Pertama', p1Pos)}</strong>, oleh karenanya sah bertindak untuk dan atas nama ${slot('entity', 'firstPartyName', 'Nama Perusahaan Pihak Pertama', p1Name)} (selanjutnya disebut &ldquo;<strong>${slot('text', 'firstPartyAlias', 'Singkatan Pihak Pertama', p1Alias)}</strong>&rdquo; atau &ldquo;<strong>Pihak Pertama</strong>&rdquo;);
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
Dan
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
2. <strong>${slot('entity', 'partnerName', 'Nama Perusahaan Mitra', slots?.partnerName)}</strong>, suatu badan hukum / badan usaha yang didirikan berdasarkan hukum negara tempat pendiriannya, berkedudukan di ${slot('location', 'partnerAddress', 'Alamat Lengkap Perusahaan Mitra', slots?.partnerAddress)}, dalam hal ini diwakili oleh ${slot('person', 'partnerPic', 'Nama Penandatangan Mitra', slots?.partnerPic)} dalam kapasitasnya selaku ${slot('text', 'partnerPosition', 'Direktur / Jabatan Penandatangan', slots?.partnerPosition)}, oleh karenanya sah bertindak untuk dan atas nama ${slot('entity', 'partnerName', 'Nama Perusahaan Mitra', slots?.partnerName)} (selanjutnya disebut &ldquo;<strong>${slot('text', 'partnerAlias', 'Singkatan Pihak Kedua', p2Alias)}</strong>&rdquo; atau &ldquo;<strong>Pihak Kedua</strong>&rdquo;).
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
Pihak Pertama dan Pihak Kedua secara bersama-sama disebut sebagai &ldquo;<strong>Para Pihak</strong>&rdquo; dan masing-masing disebut sebagai &ldquo;<strong>Pihak</strong>&rdquo;.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
<strong>MENERANGKAN TERLEBIH DAHULU:</strong>
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
BAHWA, Pihak Pertama adalah ${slot('text', 'firstPartyBusinessDesc', 'Uraian bidang usaha Pihak Pertama', p1Desc)}.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
BAHWA, Pihak Kedua adalah ${slot('text', 'partnerBusinessDesc', 'Uraian bidang usaha Pihak Kedua', p2Desc)}.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
BAHWA, Para Pihak bermaksud untuk mengadakan hubungan kemitraan strategis dan operasional yang saling menguntungkan dengan mematuhi prinsip-prinsip itikad baik, kehati-hatian, kepatuhan hukum, dan standar industri yang berlaku.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 14px;">
<strong>OLEH KARENA ITU</strong>, berdasarkan pertimbangan di atas, Para Pihak dengan ini sepakat untuk mengikatkan diri dalam Perjanjian Kerjasama ini dengan syarat dan ketentuan sebagai berikut:
</p>`;
  },
};

export const COOPERATION_AGREEMENT_ARTICLES: (slots?: Record<string, string>, modeParam?: 'edit' | 'plain') => AgreementArticle[] = (slots, modeParam) => {
  const mode: 'edit' | 'plain' = (slots?._mode === 'plain' || modeParam === 'plain') ? 'plain' : 'edit';
  const slot = (type: any, key: string, placeholder: string, val?: string) =>
    renderFillableSlot(type, key, placeholder, val, mode);

  return [
  {
    id: 'pasal_1',
    articleNumber: 1,
    titleEn: 'ARTICLE 1 DEFINITIONS AND INTERPRETATIONS',
    titleId: 'PASAL 1 DEFINISI DAN PENAFSIRAN',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
In this Agreement, unless the context otherwise requires, the following terms shall have the meanings set forth below:
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.1. &ldquo;<strong>Cooperation</strong>&rdquo; means the joint operational, technical, or commercial cooperation conducted by the Parties in accordance with the terms and scope of this Agreement.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.2. &ldquo;<strong>Services / Deliverables</strong>&rdquo; means all products, services, technological integration, operational support, or deliverables provided by the Second Party to the First Party (or vice versa) as described in this Agreement and its annexes.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.3. &ldquo;<strong>Work Order / SOW</strong>&rdquo; means any statement of work, purchase order, execution agreement, or specific annex executed in writing by both Parties from time to time detailing the technical specifications, timeline, and commercial fees.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.4. &ldquo;<strong>Service Level Agreement (SLA)</strong>&rdquo; means the agreed performance standards, response times, uptime, and delivery timelines applicable to the Services.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.5. &ldquo;<strong>Confidential Information</strong>&rdquo; means any and all technical, commercial, financial, operational data, customer data, and personal data disclosed by one Party to the other Party in connection with this Agreement.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
1.6. &ldquo;<strong>Business Day</strong>&rdquo; means any day other than Saturday, Sunday, or official public holidays in ${J().holidayJurisdiction.en}.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
Dalam Perjanjian ini, kecuali konteksnya menentukan lain, istilah-istilah di bawah ini memiliki arti sebagai berikut:
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.1. &ldquo;<strong>Kerjasama</strong>&rdquo; berarti hubungan kemitraan usaha, operasional, teknis, atau komersial yang dilaksanakan oleh Para Pihak berdasarkan syarat dan ketentuan dalam Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.2. &ldquo;<strong>Layanan / Hasil Pekerjaan</strong>&rdquo; berarti seluruh produk, jasa, integrasi sistem, dukungan operasional, atau hasil pekerjaan yang diberikan oleh MITRA kepada Pihak Pertama (atau sebaliknya) sebagaimana diatur dalam Perjanjian ini dan lampirannya.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.3. &ldquo;<strong>Formulir Pelaksanaan / Work Order (SOW)</strong>&rdquo; berarti dokumen pelaksanaan, perintah kerja, atau kesepakatan turunan yang ditandatangani secara tertulis oleh Para Pihak dari waktu ke waktu yang memuat rincian teknis, jadwal pelaksanaan, dan/atau nilai biaya spesifik.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.4. &ldquo;<strong>Service Level Agreement (SLA)</strong>&rdquo; berarti standar tingkat keandalan layanan, waktu tanggap (response time), kualitas, dan jadwal penyelesaian pekerjaan yang disepakati oleh Para Pihak.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 6px;">
1.5. &ldquo;<strong>Informasi Rahasia</strong>&rdquo; berarti setiap dan seluruh informasi bisnis, keuangan, teknis, operasional, kode pemrograman, data pengguna, dan data pribadi yang dipertukarkan oleh Para Pihak sehubungan dengan Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
1.6. &ldquo;<strong>Hari Kerja</strong>&rdquo; berarti hari selain Sabtu, Minggu, atau hari libur resmi yang berlaku di ${J().holidayJurisdiction.id}.
</p>`,
  },
  {
    id: 'pasal_2',
    articleNumber: 2,
    titleEn: 'ARTICLE 2 SCOPE OF COOPERATION',
    titleId: 'PASAL 2 RUANG LINGKUP KERJASAMA',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
2.1. The Parties agree to cooperate in the following scope:
<br/>
${slot('text', 'scopeDescEn', 'Describe the scope of cooperation / services provided (e.g. provision of digital services, technical integration, operational consultancy, product supply)...', slots?.scopeDescEn)}
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
2.2. Detailed operational workflows, service deliverables, performance targets, and milestone schedules shall be set forth in one or more Work Orders (SOW) mutually signed by both Parties.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
2.3. The Second Party shall perform the Services professionally in accordance with applicable industry standards, legal regulations, and reasonable instructions provided by the First Party.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
2.1. Para Pihak sepakat untuk mengadakan kerjasama dengan ruang lingkup sebagai berikut:
<br/>
${slot('text', 'scopeDescId', 'Uraikan ruang lingkup kerjasama / penyediaan jasa (contoh: penyediaan jasa teknologi informasi, integrasi sistem, konsultansi operasional, penyediaan barang/jasa bisnis)...', slots?.scopeDescId)}
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
2.2. Rincian teknis, tata cara operasional, target kinerja, dan tahapan pencapaian (milestone) dapat dituangkan dalam Formulir Pelaksanaan / Work Order (SOW) yang disepakati dan ditandatangani oleh Para Pihak, yang merupakan bagian tak terpisahkan dari Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
2.3. MITRA wajib melaksanakan seluruh ruang lingkup pekerjaan secara profesional, cermat, dan sesuai dengan standar etika industri serta peraturan perundang-undangan yang berlaku di Indonesia.
</p>`,
  },
  {
    id: 'pasal_3',
    articleNumber: 3,
    titleEn: 'ARTICLE 3 TERM AND DURATION OF AGREEMENT',
    titleId: 'PASAL 3 JANGKA WAKTU PERJANJIAN',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
3.1. This Agreement shall be effective as of ${slot('date', 'startDate', 'MM/DD/YYYY (Commencement Date)', slots?.startDate)} and shall remain in full force and effect until ${slot('date', 'endDate', 'MM/DD/YYYY (Expiration Date)', slots?.endDate)} (&ldquo;<strong>Term</strong>&rdquo;), unless terminated earlier in accordance with the terms of this Agreement.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
3.2. Unless either Party notifies the other Party in writing of its intention not to renew this Agreement at least 30 (thirty) calendar days prior to the expiration of the Term, this Agreement shall automatically renew for successive 1 (one) year terms upon the same terms and conditions.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
3.1. Perjanjian ini berlaku efektif terhitung sejak tanggal ${slot('date', 'startDate', 'DD/MM/YYYY (Tanggal Mulai)', slots?.startDate)} dan akan terus berlaku hingga tanggal ${slot('date', 'endDate', 'DD/MM/YYYY (Tanggal Berakhir)', slots?.endDate)} (&ldquo;<strong>Jangka Waktu</strong>&rdquo;), kecuali apabila diakhiri lebih awal berdasarkan ketentuan dalam Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
3.2. Kecuali salah satu Pihak menyampaikan pemberitahuan tertulis mengenai kehendak untuk tidak memperpanjang Perjanjian sekurang-kurangnya 30 (tiga puluh) hari kalender sebelum berakhirnya Jangka Waktu, maka Perjanjian ini akan diperpanjang secara otomatis untuk periode 1 (satu) tahun berikutnya dengan syarat dan ketentuan yang sama.
</p>`,
  },
  {
    id: 'pasal_4',
    articleNumber: 4,
    titleEn: 'ARTICLE 4 RIGHTS AND OBLIGATIONS OF THE PARTIES',
    titleId: 'PASAL 4 HAK DAN KEWAJIBAN PARA PIHAK',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
4.1. <strong>Rights and Obligations of the First Party:</strong>
<br/>
(a) To receive the Services and Deliverables in compliance with the specifications and SLA agreed herein;
<br/>
(b) To conduct reviews, evaluations, and verifications on the performance and deliverables submitted by the Second Party;
<br/>
(c) To make payments for the Services verified and approved in accordance with Article 5 of this Agreement;
<br/>
(d) To provide necessary data, materials, and assistance reasonably required for the execution of the Services.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
4.2. <strong>Rights and Obligations of the Second Party:</strong>
<br/>
(a) To execute the Services with due care, professional expertise, and within agreed timelines;
<br/>
(b) To submit regular progress reports and deliverable documentations as requested by the First Party;
<br/>
(c) To guarantee that all deliverables are original and do not infringe any third-party intellectual property rights;
<br/>
(d) To receive payment in the agreed amount and method upon satisfactory delivery and verification.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
4.1. <strong>Hak dan Kewajiban Pihak Pertama:</strong>
<br/>
(a) Berhak menerima Layanan dan Hasil Pekerjaan sesuai dengan spesifikasi, standar mutu, dan SLA yang telah disepakati;
<br/>
(b) Berhak melakukan peninjauan, evaluasi, dan pemeriksaan terhadap hasil pekerjaan yang diserahkan oleh MITRA;
<br/>
(c) Wajib melakukan pembayaran atas biaya kerjasama yang telah diverifikasi dan disetujui sesuai dengan Pasal 5 Perjanjian ini;
<br/>
(d) Wajib menyediakan informasi, bahan, atau data penunjang yang sah yang secara wajar diperlukan oleh MITRA dalam rangka pelaksanaan kerjasama.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
4.2. <strong>Hak dan Kewajiban MITRA:</strong>
<br/>
(a) Wajib melaksanakan dan menyelesaikan seluruh lingkup kerjasama dengan penuh tanggung jawab, keahlian profesional, dan tepat waktu;
<br/>
(b) Wajib menyampaikan laporan kemajuan (progress report) dan dokumentasi hasil pekerjaan secara berkala kepada Pihak Pertama;
<br/>
(c) Menjamin bahwa seluruh layanan dan hasil cipta yang disediakan adalah sah, orisinal, serta tidak melanggar hak kekayaan intelektual pihak ketiga;
<br/>
(d) Berhak menerima pembayaran imbalan jasa/kerjasama secara tepat waktu setelah pekerjaan diverifikasi dan disetujui oleh Pihak Pertama.
</p>`,
  },
  {
    id: 'pasal_5',
    articleNumber: 5,
    titleEn: 'ARTICLE 5 COOPERATION FEES AND PAYMENT PROCEDURE',
    titleId: 'PASAL 5 NILAI KERJASAMA DAN TATA CARA PEMBAYARAN',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
5.1. The value of this Cooperation is agreed as:
<br/>
${slot('currency', 'feeAmountEn', 'Total fee / rate scheme (amount and currency, or per executed work order)', slots?.feeAmountEn)}
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
5.2. Payment shall be made via electronic bank transfer to the official bank account designated by the PARTNER as follows:
<br/>
Bank Name: ${slot('text', 'bankName', 'Bank name', slots?.bankName)}
<br/>
Account Number: ${slot('number', 'bankAccount', 'Nomor Rekening Bank', slots?.bankAccount)}
<br/>
Account Holder: ${slot('text', 'bankHolder', 'Nama Pemilik Rekening (Atas Nama)', slots?.bankHolder)}
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
5.3. Payment shall be settled within ${slot('number', 'paymentTermDays', '30 (tiga puluh)', slots?.paymentTermDays || '30')} calendar days following the receipt of an official and complete tax invoice, debit note, and accompanying verification documentation.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
5.1. Nilai Kerjasama atau imbalan jasa dalam Perjanjian ini disepakati sebesar:
<br/>
${slot('currency', 'feeAmountId', 'Nilai biaya kerja sama (jumlah dan mata uang, atau berdasarkan formulir pelaksanaan)', slots?.feeAmountId)}
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
5.2. Pembayaran akan dilakukan melalui transfer bank ke rekening resmi MITRA sebagai berikut:
<br/>
Nama Bank: ${slot('text', 'bankName', 'Nama Bank (Contoh: Bank Central Asia / Mandiri)', slots?.bankName)}
<br/>
Nomor Rekening: ${slot('number', 'bankAccount', 'Nomor Rekening Bank Mitra', slots?.bankAccount)}
<br/>
Atas Nama: ${slot('text', 'bankHolder', 'Nama Pemegang Rekening (Harus Sesuai Entitas Mitra)', slots?.bankHolder)}
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
5.3. Pembayaran wajib diselesaikan dalam jangka waktu ${slot('number', 'paymentTermDays', '30 (tiga puluh)', slots?.paymentTermDays || '30')} hari kalender setelah Pihak Pertama menerima invoice resmi yang sah dan lengkap beserta faktur pajak dan berita acara verifikasi hasil pekerjaan.
</p>`,
  },
  {
    id: 'pasal_6',
    articleNumber: 6,
    titleEn: 'ARTICLE 6 TAXATION',
    titleId: 'PASAL 6 PERPAJAKAN',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
6.1. Each Party shall be individually responsible for its own tax liabilities arising out of the performance of this Agreement in accordance with the tax laws applicable to that Party.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
6.2. All taxes, including ${J().indirectTaxName} and any applicable withholding taxes, shall be handled in compliance with statutory regulations. The paying Party shall provide lawful tax withholding receipts to the other Party in a timely manner.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
6.1. Masing-masing Pihak bertanggung jawab secara mandiri atas segala kewajiban perpajakan yang timbul dari pelaksanaan Perjanjian ini sesuai dengan ketentuan perundang-undangan perpajakan yang berlaku bagi masing-masing Pihak.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
6.2. Seluruh pajak, termasuk ${J().indirectTaxName} dan pemotongan pajak yang berlaku, wajib diperlakukan sesuai hukum yang berlaku. Pihak yang memotong pajak wajib menerbitkan dan menyerahkan Bukti Potong Pajak yang sah kepada Pihak lainnya tepat pada waktunya.
</p>`,
  },
  {
    id: 'pasal_7',
    articleNumber: 7,
    titleEn: 'ARTICLE 7 CONFIDENTIALITY AND PERSONAL DATA PROTECTION',
    titleId: 'PASAL 7 KERAHASIAAN DAN PERLINDUNGAN DATA PRIBADI',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
7.1. Each Party undertakes to maintain strict confidentiality of all Confidential Information received from the other Party, and shall not disclose, duplicate, or distribute such information to any third party without prior written consent.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
7.2. The confidentiality obligations herein shall remain in full force and effect during the Term and shall survive for a period of 5 (five) years following any termination or expiration of this Agreement.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
7.3. The Parties strictly commit to comply with ${J().dataProtectionLaw} and any other data protection laws applicable to the processing of personal data under this Agreement. Each Party shall implement robust administrative and technical security measures to safeguard personal data against unauthorized access, loss, or leakage.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
7.1. Masing-masing Pihak wajib menjaga kerahasiaan seluruh Informasi Rahasia yang diterima dari Pihak lainnya dengan penuh kehati-hatian, serta tidak diperkenankan mengungkapkan, menggandakan, atau menyebarluaskan informasi tersebut kepada pihak ketiga mana pun tanpa persetujuan tertulis terlebih dahulu.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
7.2. Kewajiban kerahasiaan ini berlaku penuh selama masa berlakunya Perjanjian dan tetap mengikat Para Pihak untuk jangka waktu 5 (lima) tahun setelah Perjanjian ini berakhir atau diakhiri karena sebab apa pun.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
7.3. Para Pihak berkomitmen tunduk sepenuhnya pada ${J().dataProtectionLaw} serta peraturan perlindungan data pribadi lain yang berlaku. Para Pihak wajib menerapkan standar pengamanan teknis dan organisasi yang memadai untuk mencegah terjadinya akses tanpa hak, perusakan, atau kebocoran data pribadi.
</p>`,
  },
  {
    id: 'pasal_8',
    articleNumber: 8,
    titleEn: 'ARTICLE 8 INTELLECTUAL PROPERTY RIGHTS',
    titleId: 'PASAL 8 HAK KEKAYAAN INTELEKTUAL (HKI)',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
8.1. All trademarks, patents, copyrights, trade secrets, and other intellectual property rights owned by each Party prior to the signing of this Agreement shall remain the exclusive property of that respective Party.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
8.2. Neither Party shall obtain any right, title, or interest in or to the intellectual property of the other Party, except for the limited, non-exclusive, non-transferable license necessary strictly for the execution of this Agreement during the Term.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
8.1. Seluruh hak kekayaan intelektual, termasuk merek dagang, hak cipta, paten, rahasia dagang, dan teknologi yang telah dimiliki oleh masing-masing Pihak sebelum tanggal Perjanjian ini tetap menjadi hak milik eksklusif Pihak yang bersangkutan.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
8.2. Tidak ada ketentuan dalam Perjanjian ini yang dapat ditafsirkan sebagai pengalihan hak kepemilikan intelektual dari satu Pihak kepada Pihak lainnya, selain daripada izin penggunaan terbatas (lisensi non-eksklusif) yang semata-mata diperlukan untuk pelaksanaan Perjanjian ini.
</p>`,
  },
  {
    id: 'pasal_9',
    articleNumber: 9,
    titleEn: 'ARTICLE 9 REPRESENTATIONS AND WARRANTIES',
    titleId: 'PASAL 9 PERNYATAAN DAN JAMINAN',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
9.1. Each Party represents and warrants that it is a legal entity duly established, validly existing, and in good standing under the laws of its jurisdiction of incorporation.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
9.2. Each signatory represents that they have full legal power, corporate authorization, and capacity to execute this Agreement and bind their respective entity.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
9.3. The execution and performance of this Agreement do not violate any applicable laws, court judgements, government regulations, or other contractual obligations binding upon either Party.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
9.1. Masing-masing Pihak menyatakan dan menjamin bahwa dirinya merupakan badan hukum / badan usaha yang didirikan secara sah dan memiliki izin usaha yang masih berlaku menurut hukum negara tempat pendiriannya.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
9.2. Masing-masing penandatangan menyatakan dan menjamin bahwa dirinya memiliki kewenangan hukum dan persetujuan korporasi yang sah untuk menandatangani dan mengikatkan perusahaannya pada Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
9.3. Pelaksanaan Perjanjian ini tidak bertentangan dengan anggaran dasar, peraturan perundang-undangan yang berlaku, putusan pengadilan, maupun perjanjian lain yang mengikat masing-masing Pihak.
</p>`,
  },
  {
    id: 'pasal_10',
    articleNumber: 10,
    titleEn: 'ARTICLE 10 INDEMNIFICATION AND LIMITATION OF LIABILITY',
    titleId: 'PASAL 10 GANTI RUGI DAN BATASAN TANGGUNG JAWAB',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
10.1. Each Party agrees to indemnify, defend, and hold harmless the other Party, its directors, officers, and employees from and against any direct losses, damages, liabilities, and legal expenses arising out of any gross negligence, willful misconduct, or material breach of this Agreement.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
10.2. In no event shall either Party be liable to the other Party for any indirect, special, incidental, punitive, or consequential damages (including loss of profits, loss of business opportunity, or goodwill), even if advised of the possibility thereof.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
10.1. Masing-masing Pihak setuju untuk mengganti rugi, membela, dan membebaskan Pihak lainnya, direksi, komisaris, dan karyawannya dari dan terhadap segala tuntutan hukum, kerugian langsung, atau kewajiban finansial yang timbul akibat kelalaian berat, kesengajaan, atau wanprestasi terhadap Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
10.2. Tidak ada Pihak yang bertanggung jawab kepada Pihak lainnya atas kerugian tidak langsung, kerugian insidental, kehilangan keuntungan usaha (loss of profit), atau kerugian reputasi bisnis sehubungan dengan Perjanjian ini.
</p>`,
  },
  {
    id: 'pasal_11',
    articleNumber: 11,
    titleEn: 'ARTICLE 11 TERMINATION OF AGREEMENT',
    titleId: 'PASAL 11 PENGAKHIRAN PERJANJIAN',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
11.1. Either Party may terminate this Agreement immediately upon written notice if the other Party commits a material breach of this Agreement and fails to remedy such breach within 14 (fourteen) calendar days after receiving written notice of default.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
11.2. Either Party may terminate this Agreement for convenience by providing at least 30 (thirty) calendar days prior written notice to the other Party.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
11.3. <strong>Waiver of Article 1266:</strong> The Parties hereby expressly waive the provisions of Article 1266 of the Indonesian Civil Code (Kitab Undang-Undang Hukum Perdata), to the extent that a court decision or judicial decree shall not be required to terminate this Agreement.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
11.1. Salah satu Pihak berhak mengakhiri Perjanjian ini secara sepihak dengan pemberitahuan tertulis apabila Pihak lainnya melakukan wanprestasi atas ketentuan Perjanjian ini dan tidak memperbaikinya dalam jangka waktu 14 (empat belas) hari kalender sejak diterimanya surat peringatan tertulis (somasi).
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
11.2. Masing-masing Pihak dapat mengakhiri Perjanjian ini demi alasan operasional atau kenyamanan (for convenience) dengan menyampaikan pemberitahuan tertulis sekurang-kurangnya 30 (tiga puluh) hari kalender sebelumnya kepada Pihak lainnya.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
11.3. <strong>Pengesampingan Pasal 1266 KUHPerdata:</strong> Para Pihak dengan ini secara tegas mengesampingkan keberlakuan ketentuan Pasal 1266 Kitab Undang-Undang Hukum Perdata (KUHPerdata), sejauh putusan atau penetapan pengadilan diperlukan untuk mengakhiri Perjanjian ini.
</p>`,
  },
  {
    id: 'pasal_12',
    articleNumber: 12,
    titleEn: 'ARTICLE 12 FORCE MAJEURE',
    titleId: 'PASAL 12 KEADAAN MEMAKSA (FORCE MAJEURE)',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
12.1. Force Majeure means any event beyond the reasonable foresight and control of a Party, including natural disasters (earthquake, flood, tsunami), epidemic, war, armed conflict, riot, and mandatory government embargoes or statutory prohibitions directly preventing the fulfillment of contractual obligations.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
12.2. The Party affected by Force Majeure must notify the other Party in writing within 7 (seven) calendar days following the occurrence of such event, accompanied by official verification from the competent local authorities where applicable.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
12.1. Keadaan Memaksa (Force Majeure) adalah setiap peristiwa yang terjadi di luar kendali dan kemampuan wajar Para Pihak, termasuk namun tidak terbatas pada bencana alam (gempa bumi, banjir besar, tsunami), epidemi, perang, huru-hara, kebakaran hebat, atau perubahan kebijakan pemerintah yang melarang secara langsung pelaksanaan kewajiban dalam Perjanjian ini.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
12.2. Pihak yang mengalami Keadaan Memaksa wajib memberitahukan secara tertulis kepada Pihak lainnya selambat-lambatnya 7 (tujuh) hari kalender sejak terjadinya peristiwa tersebut beserta bukti keterangan resmi dari instansi pemerintah yang berwenang.
</p>`,
  },
  {
    id: 'pasal_13',
    articleNumber: 13,
    titleEn: 'ARTICLE 13 NOTICES AND CORRESPONDENCE',
    titleId: 'PASAL 13 PEMBERITAHUAN DAN KORESPONDENSI',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
13.1. All notices, requests, invoices, and other formal communications between the Parties shall be delivered in writing via registered letter, courier, or official email to the addresses below:
</p>
<div class="notice-box" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-bottom: 10px; font-size: 10pt;">
  <strong>To First Party (${slot('entity', 'firstPartyName', 'First Party Name', slots?.firstPartyName)}):</strong><br/>
  Address: ${slot('location', 'firstPartyAddress', 'First Party Address', slots?.firstPartyAddress)}<br/>
  Attention: Legal &amp; Compliance Department / ${slot('person', 'firstPartyPic', 'First Party Signatory', slots?.firstPartyPic)}<br/>
  Email: ${slot('text', 'firstPartyEmail', 'First Party Official Email', slots?.firstPartyEmail)}
</div>
<div class="notice-box" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-bottom: 12px; font-size: 10pt;">
  <strong>To PARTNER:</strong><br/>
  Company: ${slot('entity', 'partnerName', 'Nama Perusahaan Mitra', slots?.partnerName)}<br/>
  Address: ${slot('location', 'partnerAddress', 'Alamat Lengkap Kantor Mitra', slots?.partnerAddress)}<br/>
  Attention: ${slot('person', 'partnerPic', 'Nama PIC / Penandatangan Mitra', slots?.partnerPic)}<br/>
  Email: ${slot('text', 'partnerEmail', 'alamat.email@perusahaanmitra.com', slots?.partnerEmail)}
</div>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
13.1. Setiap surat, pemberitahuan, tagihan, atau korespondensi resmi sehubungan dengan Perjanjian ini wajib disampaikan secara tertulis melalui surat tercatat, kurir resmi, atau surat elektronik (email) ke alamat berikut:
</p>
<div class="notice-box" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-bottom: 10px; font-size: 10pt;">
  <strong>Pihak Pertama (${slot('entity', 'firstPartyName', 'Nama Perusahaan Pihak Pertama', slots?.firstPartyName)}):</strong><br/>
  Alamat: ${slot('location', 'firstPartyAddress', 'Alamat Lengkap Kantor Pihak Pertama', slots?.firstPartyAddress)}<br/>
  U.p. / PIC: Departemen Legal &amp; Kepatuhan / ${slot('person', 'firstPartyPic', 'Nama PIC Pihak Pertama', slots?.firstPartyPic)}<br/>
  Email: ${slot('text', 'firstPartyEmail', 'Email Resmi Pihak Pertama', slots?.firstPartyEmail)}
</div>
<div class="notice-box" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-bottom: 12px; font-size: 10pt;">
  <strong>Pihak Kedua (MITRA):</strong><br/>
  Nama Perusahaan: ${slot('entity', 'partnerName', 'Nama Perusahaan Mitra', slots?.partnerName)}<br/>
  Alamat: ${slot('location', 'partnerAddress', 'Alamat Kantor Perusahaan Mitra', slots?.partnerAddress)}<br/>
  U.p. / PIC: ${slot('person', 'partnerPic', 'Nama PIC / Penandatangan Mitra', slots?.partnerPic)}<br/>
  Email: ${slot('text', 'partnerEmail', 'legal@perusahaanmitra.com / pic@perusahaanmitra.com', slots?.partnerEmail)}
</div>`,
  },
  {
    id: 'pasal_14',
    articleNumber: 14,
    titleEn: 'ARTICLE 14 LEGAL COMPLIANCE AND ANTI-CORRUPTION',
    titleId: 'PASAL 14 KEPATUHAN HUKUM DAN ANTI-KORUPSI',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
14.1. The Parties strictly commit to conducting business with the highest standards of integrity and in full compliance with all anti-bribery, anti-corruption, and anti-money laundering laws and regulations in Indonesia.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
14.2. Neither Party shall directly or indirectly offer, promise, give, or authorize any financial inducement or unlawful gratuity to any officer, employee, or representative of the other Party or government officials.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
14.1. Para Pihak berkomitmen untuk senantiasa menjalankan seluruh kegiatan bisnis berdasarkan standar integritas tertinggi dan mematuhi seluruh peraturan perundang-undangan anti-suap, anti-korupsi, serta pencegahan tindak pidana pencucian uang yang berlaku bagi masing-masing Pihak.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
14.2. Tidak ada Pihak yang diperkenankan secara langsung maupun tidak langsung untuk menawarkan, menjanjikan, atau memberikan suap, gratifikasi ilegal, atau imbalan tidak sah kepada direksi, karyawan, atau perwakilan Pihak lainnya maupun pejabat pemerintahan.
</p>`,
  },
  {
    id: 'pasal_15',
    articleNumber: 15,
    titleEn: 'ARTICLE 15 GOVERNING LAW AND DISPUTE RESOLUTION',
    titleId: 'PASAL 15 HUKUM YANG BERLAKU DAN PENYELESAIAN SENGKETA',
    contentEn: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
15.1. This Agreement shall be governed by, construed, and enforced in accordance with ${J().governingLaw.en}.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
15.2. Any dispute, controversy, or claim arising out of or relating to this Agreement shall first be resolved amicably through good faith consultations between the Parties within 30 (thirty) calendar days.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
15.3. If such dispute cannot be settled amicably, the Parties agree to submit the dispute for final resolution to ${J().disputeVenue.en}.
</p>`,
    contentId: `<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
15.1. Perjanjian ini tunduk pada, diatur oleh, dan ditafsirkan berdasarkan ${J().governingLaw.id}.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 8px;">
15.2. Segala perselisihan atau sengketa yang timbul dari penafsiran atau pelaksanaan Perjanjian ini wajib diselesaikan terlebih dahulu secara musyawarah untuk mufakat dalam waktu 30 (tiga puluh) hari kalender.
</p>
<p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
15.3. Apabila penyelesaian secara musyawarah tidak mencapai mufakat, maka Para Pihak sepakat untuk menyerahkan penyelesaiannya kepada ${J().disputeVenue.id}.
</p>`,
  },
];
};

export const COOPERATION_AGREEMENT_SIGNATURES = {
  en: (slots?: Record<string, string>, modeParam?: 'edit' | 'plain') => {
    const mode: 'edit' | 'plain' = (slots?._mode === 'plain' || modeParam === 'plain') ? 'plain' : 'edit';
    const slot = (type: any, key: string, placeholder: string, val?: string) =>
      renderFillableSlot(type, key, placeholder, val, mode);

    const p1Name = slots?.firstPartyName || '';
    const p1Pic = slots?.firstPartyPic || '';
    const p1Pos = slots?.firstPartyPosition || '';

    return `<p style="text-align: justify; line-height: 1.6; margin-bottom: 24px;">
IN WITNESS WHEREOF, the Parties hereto have caused this Agreement to be executed by their duly authorized representatives in two (2) original counterparts, both having equal legal force and validity.
</p>
<table style="width: 100%; border-collapse: collapse; margin-top: 15px; border: none;">
  <tr>
    <td style="width: 50%; vertical-align: top; padding: 12px; text-align: center; border: none;">
      <p style="margin-bottom: 4px; font-size: 10pt; opacity: 0.8; font-weight: bold;">For and on behalf of First Party:</p>
      <p style="font-weight: bold; font-size: 11pt; margin-bottom: 65px; color: inherit;">${slot('entity', 'firstPartyName', 'First Party Name', p1Name)}</p>
      <p style="font-weight: bold; text-decoration: underline; margin-bottom: 2px; color: inherit;">${slot('person', 'firstPartyPic', 'First Party Signatory', p1Pic)}</p>
      <p style="font-size: 9.5pt; opacity: 0.8;">${slot('text', 'firstPartyPosition', 'First Party Position', p1Pos)}</p>
    </td>
    <td style="width: 50%; vertical-align: top; padding: 12px; text-align: center; border: none;">
      <p style="margin-bottom: 4px; font-size: 10pt; opacity: 0.8; font-weight: bold;">For and on behalf of Second Party:</p>
      <p style="font-weight: bold; font-size: 11pt; margin-bottom: 65px; color: inherit;">${slot('entity', 'partnerName', 'Nama Perusahaan Mitra', slots?.partnerName)}</p>
      <p style="font-weight: bold; text-decoration: underline; margin-bottom: 2px; color: inherit;">${slot('person', 'partnerPic', 'Nama Penandatangan Mitra', slots?.partnerPic)}</p>
      <p style="font-size: 9.5pt; opacity: 0.8;">${slot('text', 'partnerPosition', 'Direktur / Jabatan Mitra', slots?.partnerPosition)}</p>
    </td>
  </tr>
</table>`;
  },

  id: (slots?: Record<string, string>, modeParam?: 'edit' | 'plain') => {
    const mode: 'edit' | 'plain' = (slots?._mode === 'plain' || modeParam === 'plain') ? 'plain' : 'edit';
    const slot = (type: any, key: string, placeholder: string, val?: string) =>
      renderFillableSlot(type, key, placeholder, val, mode);

    const p1Name = slots?.firstPartyName || '';
    const p1Pic = slots?.firstPartyPic || '';
    const p1Pos = slots?.firstPartyPosition || '';

    return `<p style="text-align: justify; line-height: 1.6; margin-bottom: 24px;">
DEMIKIANLAH Perjanjian ini dibuat dan ditandatangani oleh Para Pihak melalui perwakilan yang berwenang pada hari dan tanggal sebagaimana disebutkan di bagian awal Perjanjian, ${J().stampDuty ? J().stampDuty!.id : 'dibuat dalam 2 (dua) rangkap asli'}, masing-masing mempunyai kekuatan hukum yang sama.
</p>
<table style="width: 100%; border-collapse: collapse; margin-top: 15px; border: none;">
  <tr>
    <td style="width: 50%; vertical-align: top; padding: 12px; text-align: center; border: none;">
      <p style="margin-bottom: 4px; font-size: 10pt; opacity: 0.8; font-weight: bold;">Pihak Pertama:</p>
      <p style="font-weight: bold; font-size: 11pt; margin-bottom: 65px; color: inherit;">${slot('entity', 'firstPartyName', 'Nama Perusahaan Pihak Pertama', p1Name)}</p>
      <p style="font-weight: bold; text-decoration: underline; margin-bottom: 2px; color: inherit;">${slot('person', 'firstPartyPic', 'Nama Penandatangan Pihak Pertama', p1Pic)}</p>
      <p style="font-size: 9.5pt; opacity: 0.8;">${slot('text', 'firstPartyPosition', 'Jabatan Penandatangan Pihak Pertama', p1Pos)}</p>
    </td>
    <td style="width: 50%; vertical-align: top; padding: 12px; text-align: center; border: none;">
      <p style="margin-bottom: 4px; font-size: 10pt; opacity: 0.8; font-weight: bold;">Pihak Kedua (MITRA):</p>
      <p style="font-weight: bold; font-size: 11pt; margin-bottom: 65px; color: inherit;">${slot('entity', 'partnerName', 'Nama Perusahaan Mitra', slots?.partnerName)}</p>
      <p style="font-weight: bold; text-decoration: underline; margin-bottom: 2px; color: inherit;">${slot('person', 'partnerPic', 'Nama Penandatangan Mitra', slots?.partnerPic)}</p>
      <p style="font-size: 9.5pt; opacity: 0.8;">${slot('text', 'partnerPosition', 'Direktur / Jabatan Mitra', slots?.partnerPosition)}</p>
    </td>
  </tr>
</table>`;
  },
};

/**
 * Builds the default HTML loaded in the WYSIWYG editor (Versi Asli Bahasa Indonesia - PERJANJIAN KERJASAMA).
 */
/** Indonesian-language agreement (kept for compatibility). */
export function buildIndonesianAgreementHtml(vars?: AgreementVars): string {
  return buildAgreementHtml(vars, 'ID');
}

export type AgreementVars = {
  contractNo?: string;
  firstPartyName?: string;
  firstPartyAlias?: string;
  firstPartyAddress?: string;
  firstPartyPic?: string;
  firstPartyPosition?: string;
  firstPartyEmail?: string;
  firstPartyBusinessDesc?: string;
  partnerName?: string;
  partnerAlias?: string;
  partnerAddress?: string;
  partnerPic?: string;
  partnerPosition?: string;
  partnerBusinessDesc?: string;
  dateStr?: string;
  scopeDescId?: string;
  startDate?: string;
  endDate?: string;
  feeAmountId?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  partnerEmail?: string;
};

/**
 * Single-language agreement HTML for the editor. English uses the `*En`
 * article bodies; the scope/fee values entered once are reused for both.
 */
export function buildAgreementHtml(vars?: AgreementVars, language: 'EN' | 'ID' = 'EN'): string {
  const contractNo = vars?.contractNo || '';

  const slots: Record<string, string> = {
    firstPartyName: vars?.firstPartyName || '',
    firstPartyAlias: vars?.firstPartyAlias || '',
    firstPartyAddress: vars?.firstPartyAddress || '',
    firstPartyPic: vars?.firstPartyPic || '',
    firstPartyPosition: vars?.firstPartyPosition || '',
    firstPartyEmail: vars?.firstPartyEmail || '',
    firstPartyBusinessDesc: vars?.firstPartyBusinessDesc || '',
    partnerName: vars?.partnerName || '',
    partnerAlias: vars?.partnerAlias || '',
    partnerAddress: vars?.partnerAddress || '',
    partnerPic: vars?.partnerPic || '',
    partnerPosition: vars?.partnerPosition || '',
    partnerBusinessDesc: vars?.partnerBusinessDesc || '',
    dateStr: vars?.dateStr || '',
    scopeDescId: vars?.scopeDescId || '',
    startDate: vars?.startDate || '',
    endDate: vars?.endDate || '',
    feeAmountId: vars?.feeAmountId || '',
    bankName: vars?.bankName || '',
    bankAccount: vars?.bankAccount || '',
    bankHolder: vars?.bankHolder || '',
    partnerEmail: vars?.partnerEmail || '',
  };

  const EN = language === 'EN';
  if (EN) {
    slots.scopeDescEn = slots.scopeDescEn || slots.scopeDescId;
    slots.feeAmountEn = slots.feeAmountEn || slots.feeAmountId;
  }
  const preamble = EN ? COOPERATION_AGREEMENT_PREAMBLE.en(slots) : COOPERATION_AGREEMENT_PREAMBLE.id(slots);

  const articles = COOPERATION_AGREEMENT_ARTICLES(slots);
  let articlesHtml = '';
  for (const article of articles) {
    articlesHtml += `
<h2 style="font-size: 12.5pt; font-weight: bold; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid rgba(148, 163, 184, 0.3); padding-bottom: 4px; color: inherit;">
  ${EN ? article.titleEn : article.titleId}
</h2>
${EN ? article.contentEn : article.contentId}
`;
  }

  const sigHtml = EN ? COOPERATION_AGREEMENT_SIGNATURES.en(slots) : COOPERATION_AGREEMENT_SIGNATURES.id(slots);
  const title = EN ? COOPERATION_AGREEMENT_HEADER.titleEn : COOPERATION_AGREEMENT_HEADER.titleId;
  const numberLabel = EN ? 'Agreement No.' : 'Nomor Perjanjian';

  return `<h1 style="text-align: center; font-size: 20pt; font-weight: bold; margin-bottom: 4px; letter-spacing: -0.5px; color: inherit;">
  ${title}
</h1>
<div style="text-align: center; font-size: 11pt; font-weight: bold; opacity: 0.85; margin-bottom: 24px;">
  ${numberLabel}: ${renderFillableSlot('number', 'contractNo', numberLabel, contractNo)}
</div>

${preamble}

${articlesHtml}

${sigHtml}`;
}

/**
 * Builds the official side-by-side bilingual HTML table for DOCX export and bilingual preview:
 * Column 1 (Left): English (COOPERATION AGREEMENT)
 * Column 2 (Right): Bahasa Indonesia (PERJANJIAN KERJASAMA)
 */
export function buildBilingualExportHtml(vars: {
  contractNo: string;
  firstPartyName?: string;
  firstPartyAlias?: string;
  firstPartyAddress?: string;
  firstPartyPic?: string;
  firstPartyPosition?: string;
  firstPartyEmail?: string;
  firstPartyBusinessDesc?: string;
  partnerName: string;
  partnerAlias?: string;
  partnerAddress: string;
  partnerPic: string;
  partnerPosition: string;
  partnerBusinessDesc?: string;
  dateStr?: string;
  scopeDescId?: string;
  scopeDescEn?: string;
  startDate?: string;
  endDate?: string;
  feeAmountId?: string;
  feeAmountEn?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  partnerEmail?: string;
}): string {
  const contractNo = vars.contractNo || '';

  const slots: Record<string, string> = {
    _mode: 'plain',
    firstPartyName: vars.firstPartyName || '',
    firstPartyAlias: vars.firstPartyAlias || '',
    firstPartyAddress: vars.firstPartyAddress || '',
    firstPartyPic: vars.firstPartyPic || '',
    firstPartyPosition: vars.firstPartyPosition || '',
    firstPartyEmail: vars.firstPartyEmail || '',
    firstPartyBusinessDesc: vars.firstPartyBusinessDesc || '',
    partnerName: vars.partnerName || '',
    partnerAlias: vars.partnerAlias || '',
    partnerAddress: vars.partnerAddress || '',
    partnerPic: vars.partnerPic || '',
    partnerPosition: vars.partnerPosition || '',
    partnerBusinessDesc: vars.partnerBusinessDesc || '',
    dateStr: vars.dateStr || '',
    scopeDescId: vars.scopeDescId || '',
    scopeDescEn: vars.scopeDescEn || '',
    startDate: vars.startDate || '',
    endDate: vars.endDate || '',
    feeAmountId: vars.feeAmountId || '',
    feeAmountEn: vars.feeAmountEn || '',
    bankName: vars.bankName || '',
    bankAccount: vars.bankAccount || '',
    bankHolder: vars.bankHolder || '',
    partnerEmail: vars.partnerEmail || '',
  };

  const preambleEn = COOPERATION_AGREEMENT_PREAMBLE.en(slots, 'plain');
  const preambleId = COOPERATION_AGREEMENT_PREAMBLE.id(slots, 'plain');

  const articles = COOPERATION_AGREEMENT_ARTICLES(slots, 'plain');

  let rowsHtml = '';

  // Header Title Row
  rowsHtml += `
  <tr style="background-color: #f8fafc;">
    <td style="width: 50%; vertical-align: top; padding: 12px 16px; border: 1px solid #cbd5e1; border-right: 1px solid #94a3b8;">
      <h2 style="margin: 0 0 4px 0; font-size: 15pt; font-weight: bold; text-align: center; color: #0f172a;">COOPERATION AGREEMENT</h2>
      <div style="font-size: 10pt; font-weight: bold; text-align: center; color: #475569;">Contract No: ${contractNo}</div>
    </td>
    <td style="width: 50%; vertical-align: top; padding: 12px 16px; border: 1px solid #cbd5e1;">
      <h2 style="margin: 0 0 4px 0; font-size: 15pt; font-weight: bold; text-align: center; color: #0f172a;">PERJANJIAN KERJASAMA</h2>
      <div style="font-size: 10pt; font-weight: bold; text-align: center; color: #475569;">Nomor Perjanjian: ${contractNo}</div>
    </td>
  </tr>
  `;

  // Preamble Row
  rowsHtml += `
  <tr>
    <td style="width: 50%; vertical-align: top; padding: 14px 16px; border: 1px solid #cbd5e1; border-right: 1px solid #94a3b8; font-size: 10.5pt;">
      ${preambleEn}
    </td>
    <td style="width: 50%; vertical-align: top; padding: 14px 16px; border: 1px solid #cbd5e1; font-size: 10.5pt;">
      ${preambleId}
    </td>
  </tr>
  `;

  // Articles Rows
  for (const article of articles) {
    rowsHtml += `
  <tr>
    <td style="width: 50%; vertical-align: top; padding: 14px 16px; border: 1px solid #cbd5e1; border-right: 1px solid #94a3b8; font-size: 10.5pt;">
      <div style="font-weight: bold; font-size: 11pt; margin-bottom: 8px; color: #0f172a; text-transform: uppercase;">
        ${article.titleEn}
      </div>
      ${article.contentEn}
    </td>
    <td style="width: 50%; vertical-align: top; padding: 14px 16px; border: 1px solid #cbd5e1; font-size: 10.5pt;">
      <div style="font-weight: bold; font-size: 11pt; margin-bottom: 8px; color: #0f172a; text-transform: uppercase;">
        ${article.titleId}
      </div>
      ${article.contentId}
    </td>
  </tr>
    `;
  }

  // Signatures Row
  const sigEn = COOPERATION_AGREEMENT_SIGNATURES.en(slots, 'plain');
  const sigId = COOPERATION_AGREEMENT_SIGNATURES.id(slots, 'plain');

  rowsHtml += `
  <tr>
    <td style="width: 50%; vertical-align: top; padding: 16px; border: 1px solid #cbd5e1; border-right: 1px solid #94a3b8;">
      ${sigEn}
    </td>
    <td style="width: 50%; vertical-align: top; padding: 16px; border: 1px solid #cbd5e1;">
      ${sigId}
    </td>
  </tr>
  `;

  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>COOPERATION AGREEMENT / PERJANJIAN KERJASAMA - ${vars.partnerName || 'Mitra'}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      size: A4 portrait;
      margin: 1.27cm 1.27cm 1.27cm 1.27cm; /* Narrow margin: 0.5 in / 1.27 cm balanced left and right */
      mso-page-orientation: portrait;
    }
    @page Section1 {
      size: 21.0cm 29.7cm;
      margin: 1.27cm 1.27cm 1.27cm 1.27cm;
      mso-header-margin: 0.8cm;
      mso-footer-margin: 0.8cm;
      mso-paper-source: 0;
    }
    div.Section1 {
      page: Section1;
    }
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.45;
      color: #0f172a;
      margin: 0;
      padding: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin: 0 auto;
    }
    td {
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    p {
      margin: 0 0 6px 0;
      text-align: justify;
      line-height: 1.45;
    }
    h1, h2 {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    }
    .fillable-slot {
      border: 1px solid #94a3b8;
      background: #f8fafc;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: normal;
    }
  </style>
</head>
<body>
  <div class="Section1">
    <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; table-layout: fixed;">
      ${rowsHtml}
    </table>
  </div>
</body>
</html>`;
}
