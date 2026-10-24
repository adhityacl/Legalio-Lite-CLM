import type { IndustryPack } from '@legalio/types/policy';
import { clause, GENERIC_PRICING, order, t } from './industryHelpers';

/** The neutral pack every unknown industry key falls back to; available without loading the other packs. */
export const GENERAL_INDUSTRY_PACK: IndustryPack = {
    key: 'general',
    name: t('General', 'Umum'),
    coreDocuments: [
      t('Non-disclosure agreement', 'Perjanjian Kerahasiaan (NDA)'),
      t('Master services agreement', 'Master Services Agreement (MSA)'),
      t('Statement of work', 'Statement of Work (SOW)'),
      t('Supply agreement', 'Perjanjian Pengadaan Barang'),
      t('Partnership agreement / MoU', 'Perjanjian Kerja Sama / MoU'),
    ],
    partnerCategories: ['Supplier', 'Service Provider', 'Consultant', 'Customer', 'Distributor', 'Partner'],
    dueDiligence: [],
    complianceStandards: [
      'Commercial contract law of the operating country',
      'Personal data protection law',
      'Anti-bribery & corruption laws',
      'Sanctions screening',
    ],
    criticalClauses: [
      clause(
        'Limitation of liability',
        'Batasan tanggung jawab',
        'Flag if liability is uncapped for either party or the cap is below 12 months’ fees.',
        'Tandai jika tanggung jawab salah satu pihak tidak dibatasi atau batasnya di bawah nilai 12 bulan.',
      ),
      clause(
        'Termination & notice',
        'Pengakhiran & pemberitahuan',
        'Flag if there is no termination for convenience or the notice period is unclear.',
        'Tandai jika tidak ada hak pengakhiran sepihak yang wajar atau masa pemberitahuan tidak jelas.',
      ),
      clause(
        'Confidentiality',
        'Kerahasiaan',
        'Flag if confidentiality has no survival period after termination.',
        'Tandai jika kewajiban kerahasiaan tidak berlaku setelah perjanjian berakhir.',
      ),
      clause(
        'Payment terms',
        'Termin pembayaran',
        'Flag if payment terms, late-payment interest or invoicing requirements are missing.',
        'Tandai jika termin pembayaran, bunga keterlambatan, atau syarat penagihan tidak ada.',
      ),
      clause(
        'Dispute resolution',
        'Penyelesaian sengketa',
        'Flag if governing law or the dispute forum is missing or differs from the organization default.',
        'Tandai jika hukum yang berlaku atau forum sengketa tidak ada atau berbeda dari default organisasi.',
      ),
    ],
    counterpartyTypes: ['organization'],
    taxConsiderations: [
      t('VAT / GST on goods and services.', 'PPN atas barang dan jasa.'),
      t('Withholding tax on services and cross-border payments.', 'PPh Pasal 23 / 26 atas jasa dan pembayaran lintas negara.'),
    ],
    commercialDocument: order('Statement of Work', 'Statements of Work', 'SOW', GENERIC_PRICING, 'Scope / Workstream', 'e.g. Implementation phase 1'),
    newsTopic: 'commercial contract and corporate compliance regulation',
  };
