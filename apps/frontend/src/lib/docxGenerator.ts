import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  HeadingLevel,
} from 'docx';

export interface BilingualContractClause {
  articleNumber?: string;
  titleEn: string;
  titleId: string;
  contentEn: string | string[];
  contentId: string | string[];
}

export interface ContractDraftData {
  titleEn: string;
  titleId: string;
  contractNumber: string;
  effectiveDate: string;
  expiryDate: string;
  party1: {
    companyName: string;
    brandName: string;
    licenseInfo: string;
    address: string;
    signatoryName: string;
    signatoryTitle: string;
    noticeEmail: string;
  };
  party2: {
    companyName: string;
    legalJurisdiction: string;
    address: string;
    signatoryName: string;
    signatoryTitle: string;
    noticeEmail: string;
    noticePhone: string;
  };
  commercials: {
    scopeOfServices: string;
    scopeOfServicesId: string;
    paymentTermDays: number;
    interestPerDayPercent: number;
    creditLimitAmount: string;
    bankName: string;
    bankAccountNo: string;
    bankBeneficiary: string;
    bankAddress: string;
    swiftCode: string;
  };
  /** e.g. "Singapore Law" (see the country pack's governingLaw). */
  governingLaw: string;
  disputeForumEn: string;
  disputeForumId: string;
  /**
   * ISO country of the governing law. Jurisdiction-specific clauses (e.g.
   * Indonesia's Civil Code art. 1266 waiver and Law 24/2009 language rule)
   * are only added for that country.
   */
  countryCode?: string;
  /** Jurisdiction under which Party 1 is incorporated, e.g. "the Republic of Singapore". */
  party1Jurisdiction?: string;
  customClauses?: BilingualContractClause[];
}

export async function generateContractDocxBlob(data: ContractDraftData): Promise<Blob> {
  const isIndonesianLaw = String(data.countryCode || '').toUpperCase() === 'ID';
  const thinBorder = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'CCCCCC',
  };

  const tableBorders = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
    insideHorizontal: thinBorder,
    insideVertical: thinBorder,
  };

  const createCell = (paragraphs: Paragraph[], widthPercent: number = 50) => {
    return new TableCell({
      width: {
        size: widthPercent,
        type: WidthType.PERCENTAGE,
      },
      margins: {
        top: 140,
        bottom: 140,
        left: 180,
        right: 180,
      },
      children: paragraphs,
    });
  };

  const textToParagraphs = (text: string | string[], isBoldTitle = false, isRightCol = false) => {
    const lines = Array.isArray(text) ? text : text.split('\n');
    return lines
      .filter((l) => l.trim() !== '')
      .map((line, idx) => {
        return new Paragraph({
          spacing: { after: 100, line: 260 },
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({
              text: line.trim(),
              font: 'Calibri',
              size: isBoldTitle && idx === 0 ? 21 : 19, // 10.5pt / 9.5pt
              bold: isBoldTitle && idx === 0,
              color: isRightCol ? '1F2937' : '111827',
            }),
          ],
        });
      });
  };

  // Header Row
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 180, bottom: 180, left: 180, right: 180 },
        shading: { fill: 'F3F4F6' },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: data.titleEn.toUpperCase(),
                font: 'Calibri',
                size: 24,
                bold: true,
                color: '111827',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60 },
            children: [
              new TextRun({
                text: `No. ${data.party1.companyName}: ${data.contractNumber || '[***]'}`,
                font: 'Calibri',
                size: 18,
                bold: true,
                color: '4B5563',
              }),
            ],
          }),
        ],
      }),
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 180, bottom: 180, left: 180, right: 180 },
        shading: { fill: 'F3F4F6' },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: data.titleId.toUpperCase(),
                font: 'Calibri',
                size: 24,
                bold: true,
                color: '111827',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60 },
            children: [
              new TextRun({
                text: `No. ${data.party1.companyName}: ${data.contractNumber || '[***]'}`,
                font: 'Calibri',
                size: 18,
                bold: true,
                color: '4B5563',
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Table rows array
  const tableRows: TableRow[] = [headerRow];

  // Helper to push a row
  const addClauseRow = (clause: BilingualContractClause) => {
    const leftParas = [
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: clause.titleEn,
            font: 'Calibri',
            size: 21,
            bold: true,
            color: '111827',
          }),
        ],
      }),
      ...textToParagraphs(clause.contentEn, false, false),
    ];

    const rightParas = [
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: clause.titleId,
            font: 'Calibri',
            size: 21,
            bold: true,
            color: '111827',
          }),
        ],
      }),
      ...textToParagraphs(clause.contentId, false, true),
    ];

    tableRows.push(
      new TableRow({
        children: [createCell(leftParas), createCell(rightParas)],
      })
    );
  };

  // 1. Preamble & Parties
  addClauseRow({
    titleEn: 'PARTIES & RECITALS',
    titleId: 'KOMPARISI PARA PIHAK & PENDAHULUAN',
    contentEn: [
      `This Agreement is made and entered into on ${data.effectiveDate || '[Date]'} by and between:`,
      `1. ${data.party1.companyName}, a company duly established under the laws of ${data.party1Jurisdiction || '[Jurisdiction]'}, having its registered office at ${data.party1.address}, represented by ${data.party1.signatoryName} in his capacity as ${data.party1.signatoryTitle}, therefore validly acting for and on behalf of ${data.party1.companyName} (hereinafter referred to as "${data.party1.brandName}"); and`,
      `2. ${data.party2.companyName || '[Partner/Vendor Company]'}, a company duly established under the laws of ${data.party2.legalJurisdiction || '[Jurisdiction]'}, having its registered office at ${data.party2.address || '[Address]'}, represented by ${data.party2.signatoryName || '[Signatory Name]'} in his capacity as ${data.party2.signatoryTitle || '[Position]'} (hereinafter referred to as "PARTNER").`,
      `WITNESSETH:`,
      `WHEREAS, ${data.party1.brandName} is a company conducting business activities in ${data.party1.licenseInfo || '[line of business]'}.`,
      `WHEREAS, PARTNER is a professional company providing ${data.commercials.scopeOfServices || 'services and strategic partnership'}.`,
      `WHEREAS, the Parties agree to protect personal data and maintain confidentiality in accordance with applicable laws.`,
      `THEREFORE, the Parties agree to enter into this Agreement under the following terms:`,
    ],
    contentId: [
      `Perjanjian ini dibuat dan ditandatangani pada tanggal ${data.effectiveDate || '[Tanggal]'} oleh dan antara:`,
      `1. ${data.party1.companyName}, suatu badan usaha yang didirikan berdasarkan hukum ${data.party1Jurisdiction || '[Yurisdiksi]'}, berkedudukan di ${data.party1.address}, dalam hal ini diwakili oleh ${data.party1.signatoryName} dalam kapasitasnya sebagai ${data.party1.signatoryTitle}, oleh karenanya sah bertindak untuk dan atas nama ${data.party1.companyName} (selanjutnya disebut "${data.party1.brandName}"); dan`,
      `2. ${data.party2.companyName || '[Perusahaan Partner/Vendor]'}, suatu perusahaan yang didirikan berdasarkan hukum ${data.party2.legalJurisdiction || '[Yurisdiksi]'}, berkedudukan di ${data.party2.address || '[Alamat]'}, diwakili oleh ${data.party2.signatoryName || '[Nama Penandatangan]'} dalam kapasitasnya sebagai ${data.party2.signatoryTitle || '[Jabatan]'} (selanjutnya disebut "PARTNER").`,
      `PENDAHULUAN:`,
      `BAHWA, ${data.party1.brandName} adalah perusahaan yang bergerak dalam bidang ${data.party1.licenseInfo || '[bidang usaha]'}.`,
      `BAHWA, PARTNER adalah perusahaan profesional yang menyediakan ${data.commercials.scopeOfServicesId || 'layanan dan kerjasama strategis'}.`,
      `BAHWA, Para Pihak sepakat untuk mematuhi perlindungan data pribadi dan menjaga kerahasiaan sesuai peraturan perundang-undangan.`,
      `OLEH KARENA ITU, Para Pihak dengan ini menyepakati Perjanjian dengan ketentuan sebagai berikut:`,
    ],
  });

  // 2. Article 1 Definition
  addClauseRow({
    titleEn: 'ARTICLE 1 - DEFINITION AND INTERPRETATION',
    titleId: 'PASAL 1 - DEFINISI DAN INTERPRETASI',
    contentEn: [
      `"Product" means the registered trademark and services of ${data.party1.brandName}.`,
      `"Scope of Services" means the operational and marketing execution agreed under this Agreement or subsequent Insertion Orders (IO).`,
      `"Insertion Order (IO)" means a form or purchase order issued summarizing the scope, duration, and commercials.`,
      `"Confidential Information" means all non-public technical, commercial, financial, and personal data exchanged between the Parties.`,
    ],
    contentId: [
      `"Produk" berarti merek dagang terdaftar dan layanan milik ${data.party1.brandName}.`,
      `"Ruang Lingkup Layanan" berarti pelaksanaan operasional dan pemasaran yang disepakati berdasarkan Perjanjian ini atau Insertion Order (IO).`,
      `"Insertion Order (IO)" berarti formulir atau surat pesanan yang diterbitkan merangkum ruang lingkup, durasi, dan ketentuan komersial.`,
      `"Informasi Rahasia" berarti seluruh data teknis, komersial, keuangan, dan data pribadi non-publik yang dipertukarkan antara Para Pihak.`,
    ],
  });

  // 3. Article 2 Scope of Services
  addClauseRow({
    titleEn: 'ARTICLE 2 - SCOPE OF SERVICES & COOPERATION',
    titleId: 'PASAL 2 - RUANG LINGKUP LAYANAN & KERJASAMA',
    contentEn: [
      `PARTNER shall provide the services specified as follows: ${data.commercials.scopeOfServices || 'digital media planning, commercial operations, and technical integrations'}.`,
      `All services shall be rendered with reasonable professional skill, care, and diligence in accordance with the industry standards and Service Level Agreements (SLA).`,
    ],
    contentId: [
      `PARTNER wajib menyediakan layanan sebagaimana ditentukan sebagai berikut: ${data.commercials.scopeOfServicesId || 'perencanaan media digital, operasional komersial, dan integrasi teknis'}.`,
      `Seluruh layanan wajib dilaksanakan dengan keahlian profesional, kehati-hatian, dan ketekunan yang wajar sesuai standar industri dan Service Level Agreement (SLA).`,
    ],
  });

  // 4. Article 3 Payment Terms
  addClauseRow({
    titleEn: 'ARTICLE 3 - TERM OF PAYMENT & COMMERCIALS',
    titleId: 'PASAL 3 - TATA CARA PEMBAYARAN & KOMERSIAL',
    contentEn: [
      `Payment shall be made within ${data.commercials.paymentTermDays || 30} calendar days after receipt of undisputed invoice and performance reports.`,
      `In the event of late payment, interest shall accrue at a rate of ${data.commercials.interestPerDayPercent || 0.5}% per day on the overdue amount.`,
      `The real-time accumulative maximum credit line is ${data.commercials.creditLimitAmount || 'USD 100,000'}.`,
      `Payment shall be remitted to the designated bank account:`,
      `Beneficiary: ${data.commercials.bankBeneficiary || '[Beneficiary Name]'} | Bank: ${data.commercials.bankName || '[Bank Name]'}`,
      `Account No: ${data.commercials.bankAccountNo || '[Account Number]'} | Swift Code: ${data.commercials.swiftCode || '[Swift Code]'}`,
    ],
    contentId: [
      `Pembayaran dilakukan dalam waktu ${data.commercials.paymentTermDays || 30} hari kalender setelah diterimanya faktur dan laporan kinerja yang valid.`,
      `Dalam hal terjadi keterlambatan pembayaran, bunga denda dikenakan sebesar ${data.commercials.interestPerDayPercent || 0.5}% per hari atas jumlah tunggakan.`,
      `Batas kredit konsumsi kumulatif waktu-nyata adalah ${data.commercials.creditLimitAmount || 'USD 100,000'}.`,
      `Pembayaran ditransfer ke rekening bank yang ditunjuk sebagai berikut:`,
      `Atas Nama: ${data.commercials.bankBeneficiary || '[Nama Penerima]'} | Nama Bank: ${data.commercials.bankName || '[Nama Bank]'}`,
      `No. Rekening: ${data.commercials.bankAccountNo || '[Nomor Rekening]'} | Swift Code: ${data.commercials.swiftCode || '[Swift Code]'}`,
    ],
  });

  // 5. Article 4 Confidentiality
  addClauseRow({
    titleEn: 'ARTICLE 4 - CONFIDENTIALITY & DATA PROTECTION',
    titleId: 'PASAL 4 - KERAHASIAAN & PERLINDUNGAN DATA',
    contentEn: [
      `The Receiving Party shall maintain strictly the confidentiality of all Confidential Information received from the Disclosing Party.`,
      `Confidential Information shall not be disclosed to any third party without prior written consent, except where required by law.`,
      `Upon termination, all Confidential Information must be returned or securely destroyed within 5 (five) business days upon written request.`,
      `The obligations under this Article shall survive termination of this Agreement.`,
    ],
    contentId: [
      `Penerima Informasi wajib menjaga kerahasiaan seluruh Informasi Rahasia yang diterima dari Pihak Pengungkap.`,
      `Informasi Rahasia dilarang diungkapkan kepada pihak ketiga mana pun tanpa persetujuan tertulis sebelumnya, kecuali disyaratkan oleh hukum.`,
      `Setelah pengakhiran, seluruh Informasi Rahasia wajib dikembalikan atau dimusnahkan secara aman dalam waktu 5 (lima) hari kerja setelah permintaan tertulis.`,
      `Kewajiban dalam Pasal ini tetap berlaku dan mengikat meskipun Perjanjian ini telah berakhir.`,
    ],
  });

  // 6. Article 5 Term and Termination
  addClauseRow({
    titleEn: 'ARTICLE 5 - PERIOD & TERMINATION',
    titleId: 'PASAL 5 - JANGKA WAKTU & PENGAKHIRAN',
    contentEn: [
      `This Agreement shall be effective from ${data.effectiveDate || '[Start Date]'} until ${data.expiryDate || '[End Date]'} and shall automatically renew for successive 1 (one) year terms unless terminated with 30 days prior written notice.`,
      `Either Party may terminate this Agreement if the other Party commits a material breach and fails to cure such breach within 15 calendar days of notice.`,
      ...(isIndonesianLaw ? [`The Parties expressly agree to waive Article 1266 of the Indonesian Civil Code to the extent a court judgment is required for termination.`] : []),
    ],
    contentId: [
      `Perjanjian ini berlaku efektif sejak ${data.effectiveDate || '[Tanggal Mulai]'} sampai dengan ${data.expiryDate || '[Tanggal Berakhir]'} dan otomatis diperpanjang untuk periode 1 (satu) tahun berikutnya kecuali diakhiri dengan pemberitahuan tertulis 30 hari sebelumnya.`,
      `Salah satu Pihak dapat mengakhiri Perjanjian jika Pihak lain melakukan pelanggaran material dan tidak memperbaikinya dalam waktu 15 hari kalender sejak pemberitahuan.`,
      ...(isIndonesianLaw ? [`Para Pihak sepakat mengesampingkan berlakunya ketentuan Pasal 1266 KUHPerdata sepanjang mengenai diperlukannya putusan pengadilan untuk pengakhiran perjanjian.`] : []),
    ],
  });

  // 7. Article 6 Governing Law & Dispute Resolution
  addClauseRow({
    titleEn: 'ARTICLE 6 - GOVERNING LAW & DISPUTE SETTLEMENT',
    titleId: 'PASAL 6 - HUKUM YANG BERLAKU & PENYELESAIAN SENGKETA',
    contentEn: [
      `This Agreement shall be governed by and construed in accordance with ${data.governingLaw || '[governing law]'}.`,
      `Any dispute arising out of or in connection with this Agreement shall be resolved through good faith negotiations within 10 days, failing which the dispute shall be submitted to the jurisdiction of the ${data.disputeForumEn || '[dispute forum]'}.`,
    ],
    contentId: [
      `Perjanjian ini diatur oleh dan ditafsirkan sesuai dengan ${data.governingLaw || '[hukum yang berlaku]'}.`,
      `Setiap perselisihan yang timbul dari atau sehubungan dengan Perjanjian ini diselesaikan melalui musyawarah mufakat dalam waktu 10 hari, apabila tidak tercapai kesepakatan maka akan diselesaikan melalui yurisdiksi ${data.disputeForumId || '[forum sengketa]'}.`,
    ],
  });

  // 8. Article 7 Miscellaneous
  addClauseRow({
    titleEn: 'ARTICLE 7 - MISCELLANEOUS & LANGUAGE',
    titleId: 'PASAL 7 - KETENTUAN LAIN-LAIN & BAHASA',
    contentEn: [
      isIndonesianLaw
        ? `Language: In compliance with Law No. 24 of 2009, this Agreement is executed in English and Indonesian versions. In the event of any discrepancy, the Indonesian version shall prevail.`
        : `Language: This Agreement is executed in English and Indonesian versions. In the event of any discrepancy, the English version shall prevail.`,
      `Entire Agreement: This Agreement supersedes all prior discussions, representations, and understandings between the Parties.`,
      `Electronic Execution: This Agreement may be executed in counterparts and transmitted electronically with equal legal binding force.`,
    ],
    contentId: [
      isIndonesianLaw
        ? `Bahasa: Untuk memenuhi UU No. 24 Tahun 2009, Perjanjian ini dibuat dalam versi Bahasa Inggris dan Bahasa Indonesia. Apabila terdapat perbedaan penafsiran, versi Bahasa Indonesia yang berlaku.`
        : `Bahasa: Perjanjian ini dibuat dalam versi Bahasa Inggris dan Bahasa Indonesia. Apabila terdapat perbedaan penafsiran, versi Bahasa Inggris yang berlaku.`,
      `Keseluruhan Perjanjian: Perjanjian ini menggantikan seluruh pembicaraan, pernyataan, dan kesepakatan terdahulu di antara Para Pihak.`,
      `Penandatanganan Elektronik: Perjanjian ini dapat ditandatangani dalam salinan elektronik dengan kekuatan hukum pembuktian yang sah dan mengikat.`,
    ],
  });

  // 9. Custom clauses if any
  if (data.customClauses && data.customClauses.length > 0) {
    data.customClauses.forEach((cc) => {
      addClauseRow(cc);
    });
  }

  // 10. Signatures Row
  const sigRow = new TableRow({
    children: [
      createCell([
        new Paragraph({
          children: [
            new TextRun({
              text: `For and on behalf of / Untuk dan atas nama:`,
              font: 'Calibri',
              size: 18,
              italics: true,
              color: '6B7280',
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({
              text: data.party1.companyName,
              font: 'Calibri',
              size: 21,
              bold: true,
              color: '111827',
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 600 },
          children: [
            new TextRun({
              text: `_______________________________`,
              font: 'Calibri',
              size: 20,
              color: '9CA3AF',
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: data.party1.signatoryName,
              font: 'Calibri',
              size: 20,
              bold: true,
              color: '111827',
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: data.party1.signatoryTitle,
              font: 'Calibri',
              size: 18,
              color: '4B5563',
            }),
          ],
        }),
      ]),
      createCell([
        new Paragraph({
          children: [
            new TextRun({
              text: `For and on behalf of / Untuk dan atas nama:`,
              font: 'Calibri',
              size: 18,
              italics: true,
              color: '6B7280',
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({
              text: data.party2.companyName || '[Partner/Vendor Name]',
              font: 'Calibri',
              size: 21,
              bold: true,
              color: '111827',
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 600 },
          children: [
            new TextRun({
              text: `_______________________________`,
              font: 'Calibri',
              size: 20,
              color: '9CA3AF',
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: data.party2.signatoryName || '[Signatory Name]',
              font: 'Calibri',
              size: 20,
              bold: true,
              color: '111827',
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: data.party2.signatoryTitle || '[Signatory Title]',
              font: 'Calibri',
              size: 18,
              color: '4B5563',
            }),
          ],
        }),
      ]),
    ],
  });

  tableRows.push(sigRow);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720, // 0.5 in
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children: [
          new Table({
            rows: tableRows,
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            borders: tableBorders,
          }),
        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
}
