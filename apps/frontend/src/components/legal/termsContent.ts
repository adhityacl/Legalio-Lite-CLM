import type { LegalCatalog } from './LegalDocument';

const EMAIL = 'legal@company.com';

export const TERMS_CONTENT: LegalCatalog = {
  EN: {
    navLabel: 'Legalio • Terms of Service',
    title: 'Terms of Service',
    updated: 'August 29, 2026',
    intro: [
      'Welcome to Legalio, an enterprise contract and corporate document management system (the "Platform"). Please read these Terms of Service ("Terms") carefully before accessing or using the Platform.',
      'By registering for, accessing or using the Platform you confirm that you have read, understood and agree to be bound by these Terms and our Privacy Policy. If you do not agree, you must not use the Platform.',
    ],
    sections: [
      {
        title: 'Acceptance and Eligibility',
        clauses: [
          'These Terms form a binding agreement between you and Legalio ("we", "us", "our").',
          'If you use the Platform on behalf of an organization, you represent and warrant that you have full legal authority to bind that organization to these Terms, and "you" includes that organization.',
          'You must be at least 18 years old and legally able to enter into a binding agreement.',
        ],
      },
      {
        title: 'Privacy',
        clauses: [
          'Your use of the Platform is also governed by our Privacy Policy, which explains how we collect, use, store and disclose Personal Data.',
          'You consent to the collection and use of Personal Data as described in the Privacy Policy, and confirm that you are authorized to submit any third-party Personal Data you upload.',
        ],
      },
      {
        title: 'Accounts and Security',
        clauses: [
          'Access is limited to authorized personnel and verified partners. You must register with an official corporate email address, and new accounts require approval by an Administrator before use.',
          'Permissions to create, modify, approve or purge contract data and due diligence files are partitioned by assigned role (for example Admin, Legal, Finance, Viewer). You may not attempt to exceed your assigned role.',
          {
            text: 'You are responsible for your account and agree to:',
            items: [
              'provide accurate and current registration information;',
              'keep your password confidential and not share your account;',
              'notify us immediately of any suspected unauthorized access;',
              'accept responsibility for all activity under your authenticated session.',
            ],
          },
        ],
      },
      {
        title: 'Limited License',
        clauses: [
          'We grant you a limited, non-exclusive, non-transferable, revocable license to use the Platform for your internal business purposes, subject to these Terms.',
          'The Platform, including its software, design, text and trademarks, is owned by or licensed to us. Except for this license, no rights are transferred to you.',
          'You retain ownership of the contracts, documents and data you upload ("Your Content"). You grant us a limited license to host, process and display Your Content solely to provide the Platform to you.',
        ],
      },
      {
        title: 'Confidentiality',
        clauses: [
          'Agreement drafts, Master Service Agreements (PKS), Addendums, Insertion Orders (IO), partner compliance files (NIB, Tax ID, Articles) and transaction values stored in the Platform are confidential corporate information.',
          'You must not export, capture or distribute confidential files to third parties without an active Non-Disclosure Agreement (NDA) or prior legal authorization.',
        ],
      },
      {
        title: 'Acceptable Use',
        clauses: [
          {
            text: 'You agree that you will not:',
            items: [
              'forge, falsify or misrepresent any contract, document or metadata;',
              'bypass, disable or circumvent authorization, authentication or security controls;',
              'access data or functions you are not authorized to use;',
              'upload malware or any content that is unlawful or infringes the rights of others;',
              'probe, scan or test the vulnerability of the Platform without written permission;',
              'interfere with or disrupt the Platform, its servers or networks;',
              'use automated means such as bots or scrapers to access the Platform without our consent;',
              'alter, delete or tamper with audit logs;',
              'use the Platform in violation of applicable law.',
            ],
          },
          'You acknowledge that document edits, approvals and uploads generate audit trail entries linked to your account.',
          'You agree to keep contract numbers, validity dates, values and other metadata accurate and consistent with the executed copies.',
        ],
      },
      {
        title: 'Third-Party Services',
        clauses: [
          'Third-party services are governed by their own terms, and we are not responsible for their availability or conduct.',
        ],
      },
      {
        title: 'Disclaimers',
        clauses: [
          'The Platform supports contract governance and is provided "as is" and "as available". Automated reminders are an aid only. Legal obligations and notice periods are governed by the executed contracts, which prevail over any data shown in the Platform.',
          'The Platform does not provide legal advice. You are responsible for verifying information before relying on it.',
          'We do not guarantee that the Platform will be uninterrupted, error-free or free of harmful components.',
        ],
      },
      {
        title: 'Limitation of Liability',
        clauses: [
          'To the maximum extent permitted by law, we are not liable for indirect, incidental, special or consequential loss, loss of profit or goodwill, or missed deadlines or notice periods arising from your use of or inability to use the Platform.',
          'Nothing in these Terms excludes liability that cannot be excluded under Indonesian law.',
        ],
      },
      {
        title: 'Suspension and Termination',
        clauses: [
          'We may suspend or terminate your access immediately, with or without notice, if you breach these Terms, particularly the confidentiality and security provisions, or if required by law.',
          'You may stop using the Platform at any time. Provisions that by nature should survive termination, including confidentiality, ownership, disclaimers, liability and governing law, will survive.',
          'Records are retained after termination as described in the Privacy Policy.',
        ],
      },
      {
        title: 'Changes to these Terms',
        clauses: [
          'We may amend these Terms from time to time. The "last updated" date shows the current version, and material changes will be notified through the Platform. Continued use after changes take effect means you accept them.',
        ],
      },
      {
        title: 'Governing Law and Contact',
        clauses: [
          'These Terms are governed by and construed in accordance with the laws of the Republic of Indonesia. The parties will first seek to resolve any dispute amicably through discussion in good faith.',
          'For questions about these Terms, please contact our Legal Operations & Compliance team in Jakarta, Indonesia.',
        ],
      },
    ],
    contact: { title: 'Legal Operations & Compliance', text: 'Jakarta, Republic of Indonesia', email: EMAIL },
  },

  ID: {
    navLabel: 'Legalio • Ketentuan Layanan',
    title: 'Ketentuan Layanan',
    updated: '29 Agustus 2026',
    intro: [
      'Selamat datang di Legalio, sistem manajemen kontrak dan dokumen korporat ("Platform"). Mohon baca Ketentuan Layanan ini ("Ketentuan") dengan saksama sebelum mengakses atau menggunakan Platform.',
      'Dengan mendaftar, mengakses, atau menggunakan Platform, Anda menyatakan telah membaca, memahami, dan setuju terikat pada Ketentuan ini serta Kebijakan Privasi kami. Jika tidak setuju, Anda tidak boleh menggunakan Platform.',
    ],
    sections: [
      {
        title: 'Penerimaan dan Kelayakan',
        clauses: [
          'Ketentuan ini merupakan perjanjian yang mengikat antara Anda dan Legalio ("kami").',
          'Jika Anda menggunakan Platform atas nama suatu organisasi, Anda menyatakan dan menjamin memiliki kewenangan hukum penuh untuk mengikat organisasi tersebut pada Ketentuan ini, dan "Anda" mencakup organisasi tersebut.',
          'Anda harus berusia minimal 18 tahun dan cakap hukum untuk membuat perjanjian yang mengikat.',
        ],
      },
      {
        title: 'Privasi',
        clauses: [
          'Penggunaan Platform juga diatur oleh Kebijakan Privasi kami, yang menjelaskan cara kami mengumpulkan, menggunakan, menyimpan, dan mengungkapkan Data Pribadi.',
          'Anda menyetujui pengumpulan dan penggunaan Data Pribadi sebagaimana diuraikan dalam Kebijakan Privasi, dan menyatakan berwenang menyerahkan Data Pribadi pihak ketiga yang Anda unggah.',
        ],
      },
      {
        title: 'Akun dan Keamanan',
        clauses: [
          'Akses dibatasi bagi personel berwenang dan mitra terverifikasi. Anda harus mendaftar dengan email korporat resmi, dan akun baru memerlukan persetujuan Administrator sebelum dapat digunakan.',
          'Izin untuk membuat, mengubah, menyetujui, atau menghapus data kontrak dan berkas uji tuntas dibagi berdasarkan peran (misalnya Admin, Legal, Finance, Viewer). Anda tidak boleh mencoba melampaui peran yang diberikan.',
          {
            text: 'Anda bertanggung jawab atas akun Anda dan setuju untuk:',
            items: [
              'memberikan informasi pendaftaran yang akurat dan terkini;',
              'menjaga kerahasiaan kata sandi dan tidak membagikan akun;',
              'segera memberi tahu kami jika mencurigai akses tidak sah;',
              'bertanggung jawab atas seluruh aktivitas dalam sesi terautentikasi Anda.',
            ],
          },
        ],
      },
      {
        title: 'Lisensi Terbatas',
        clauses: [
          'Kami memberi Anda lisensi terbatas, non-eksklusif, tidak dapat dialihkan, dan dapat dicabut untuk menggunakan Platform bagi keperluan bisnis internal, sesuai Ketentuan ini.',
          'Platform, termasuk perangkat lunak, desain, teks, dan mereknya, dimiliki oleh atau dilisensikan kepada kami. Selain lisensi ini, tidak ada hak yang dialihkan kepada Anda.',
          'Anda tetap memiliki kontrak, dokumen, dan data yang Anda unggah ("Konten Anda"). Anda memberi kami lisensi terbatas untuk menghosting, memproses, dan menampilkan Konten Anda semata-mata untuk menyediakan Platform kepada Anda.',
        ],
      },
      {
        title: 'Kerahasiaan',
        clauses: [
          'Draf perjanjian, Perjanjian Kerja Sama (PKS), Addendum, Insertion Order (IO), berkas kepatuhan mitra (NIB, NPWP, Akta), dan nilai transaksi yang tersimpan di Platform adalah informasi korporat yang bersifat rahasia.',
          'Anda dilarang mengekspor, menangkap layar, atau menyebarkan berkas rahasia kepada pihak ketiga tanpa Perjanjian Kerahasiaan (NDA) yang berlaku atau otorisasi hukum sebelumnya.',
        ],
      },
      {
        title: 'Penggunaan yang Dapat Diterima',
        clauses: [
          {
            text: 'Anda setuju untuk tidak:',
            items: [
              'memalsukan atau menyajikan secara keliru kontrak, dokumen, atau metadata;',
              'melewati, menonaktifkan, atau menghindari kontrol otorisasi, autentikasi, atau keamanan;',
              'mengakses data atau fungsi yang tidak diizinkan bagi Anda;',
              'mengunggah malware atau konten yang melanggar hukum atau hak pihak lain;',
              'menyelidiki, memindai, atau menguji kerentanan Platform tanpa izin tertulis;',
              'mengganggu Platform, server, atau jaringannya;',
              'menggunakan cara otomatis seperti bot atau scraper untuk mengakses Platform tanpa persetujuan kami;',
              'mengubah, menghapus, atau memanipulasi log audit;',
              'menggunakan Platform yang melanggar hukum yang berlaku.',
            ],
          },
          'Anda memahami bahwa perubahan, persetujuan, dan pengunggahan dokumen menghasilkan catatan jejak audit yang terkait dengan akun Anda.',
          'Anda setuju menjaga nomor kontrak, tanggal berlaku, nilai, dan metadata lain tetap akurat dan sesuai dengan salinan yang telah ditandatangani.',
        ],
      },
      {
        title: 'Layanan Pihak Ketiga',
        clauses: [
          'Layanan pihak ketiga diatur oleh ketentuannya sendiri, dan kami tidak bertanggung jawab atas ketersediaan atau tindakan mereka.',
        ],
      },
      {
        title: 'Penafian',
        clauses: [
          'Platform mendukung tata kelola kontrak dan disediakan "sebagaimana adanya" dan "sebagaimana tersedia". Pengingat otomatis hanyalah alat bantu. Kewajiban hukum dan masa pemberitahuan diatur oleh kontrak yang telah ditandatangani, yang berlaku di atas data yang ditampilkan di Platform.',
          'Platform tidak memberikan nasihat hukum. Anda bertanggung jawab memverifikasi informasi sebelum mengandalkannya.',
          'Kami tidak menjamin Platform akan selalu tersedia tanpa gangguan, bebas kesalahan, atau bebas dari komponen berbahaya.',
        ],
      },
      {
        title: 'Pembatasan Tanggung Jawab',
        clauses: [
          'Sejauh diizinkan hukum, kami tidak bertanggung jawab atas kerugian tidak langsung, insidental, khusus, atau konsekuensial, hilangnya keuntungan atau goodwill, maupun terlewatnya tenggat atau masa pemberitahuan yang timbul dari penggunaan atau ketidakmampuan menggunakan Platform.',
          'Tidak ada ketentuan dalam Ketentuan ini yang mengecualikan tanggung jawab yang tidak dapat dikecualikan menurut hukum Indonesia.',
        ],
      },
      {
        title: 'Penangguhan dan Pengakhiran',
        clauses: [
          'Kami dapat menangguhkan atau mengakhiri akses Anda segera, dengan atau tanpa pemberitahuan, jika Anda melanggar Ketentuan ini, terutama ketentuan kerahasiaan dan keamanan, atau jika diwajibkan hukum.',
          'Anda dapat berhenti menggunakan Platform kapan saja. Ketentuan yang menurut sifatnya tetap berlaku setelah pengakhiran, termasuk kerahasiaan, kepemilikan, penafian, tanggung jawab, dan hukum yang berlaku, tetap berlaku.',
          'Catatan disimpan setelah pengakhiran sebagaimana diuraikan dalam Kebijakan Privasi.',
        ],
      },
      {
        title: 'Perubahan Ketentuan',
        clauses: [
          'Kami dapat mengubah Ketentuan ini dari waktu ke waktu. Tanggal "terakhir diperbarui" menunjukkan versi terkini, dan perubahan material akan diberitahukan melalui Platform. Penggunaan berkelanjutan setelah perubahan berlaku berarti Anda menerimanya.',
        ],
      },
      {
        title: 'Hukum yang Berlaku dan Kontak',
        clauses: [
          'Ketentuan ini diatur oleh dan ditafsirkan berdasarkan hukum Republik Indonesia. Para pihak terlebih dahulu akan berupaya menyelesaikan sengketa secara musyawarah dengan itikad baik.',
          'Untuk pertanyaan mengenai Ketentuan ini, silakan hubungi tim Legal Operations & Compliance kami di Jakarta, Indonesia.',
        ],
      },
    ],
    contact: { title: 'Legal Operations & Compliance', text: 'Jakarta, Republik Indonesia', email: EMAIL },
  },

  ZH: {
    navLabel: 'Legalio • 服务条款',
    title: '服务条款',
    updated: '2026年8月29日',
    intro: [
      '欢迎使用 Legalio，一个企业合同与公司文档管理系统（“平台”）。在访问或使用平台之前，请仔细阅读本服务条款（“条款”）。',
      '注册、访问或使用平台，即表示您确认已阅读、理解并同意受本条款及我们的《隐私政策》约束。如不同意，您不得使用平台。',
    ],
    sections: [
      {
        title: '接受条款与资格',
        clauses: [
          '本条款构成您与 Legalio（“我们”）之间具有约束力的协议。',
          '如您代表某组织使用平台，您声明并保证拥有充分的法律权限使该组织受本条款约束，“您”包括该组织。',
          '您必须年满 18 周岁，并具有订立有约束力协议的法律行为能力。',
        ],
      },
      {
        title: '隐私',
        clauses: [
          '您对平台的使用同时受我们《隐私政策》约束，该政策说明我们如何收集、使用、存储和披露个人数据。',
          '您同意按《隐私政策》所述收集和使用个人数据，并确认您有权提交您所上传的任何第三方个人数据。',
        ],
      },
      {
        title: '账户与安全',
        clauses: [
          '访问仅限于获授权人员和已验证的合作伙伴。您必须使用正式的公司邮箱注册，新账户须经管理员批准后方可使用。',
          '创建、修改、批准或清除合同数据和尽职调查文件的权限按分配的角色划分（例如 Admin、Legal、Finance、Viewer）。您不得试图超越所分配的角色。',
          {
            text: '您对自己的账户负责，并同意：',
            items: [
              '提供准确且最新的注册信息；',
              '对密码保密，不得共享账户；',
              '怀疑存在未经授权的访问时立即通知我们；',
              '对已认证会话下的所有活动承担责任。',
            ],
          },
        ],
      },
      {
        title: '有限许可',
        clauses: [
          '在遵守本条款的前提下，我们授予您有限的、非排他的、不可转让的、可撤销的许可，仅供您出于内部业务目的使用平台。',
          '平台（包括其软件、设计、文字和商标）归我们所有或经许可使用。除本许可外，不向您转让任何权利。',
          '您保留所上传合同、文档和数据（“您的内容”）的所有权。您授予我们有限许可，仅为向您提供平台之目的托管、处理和展示您的内容。',
        ],
      },
      {
        title: '保密',
        clauses: [
          '存储在平台中的协议草稿、主服务协议（PKS）、补充协议、插单（IO）、合作伙伴合规文件（NIB、税号、公司章程）及交易金额均属保密的公司信息。',
          '未经有效保密协议（NDA）或事先法律授权，您不得向第三方导出、截取或分发保密文件。',
        ],
      },
      {
        title: '可接受的使用',
        clauses: [
          {
            text: '您同意不会：',
            items: [
              '伪造、篡改或虚假陈述任何合同、文档或元数据；',
              '绕过、禁用或规避授权、认证或安全控制；',
              '访问您无权使用的数据或功能；',
              '上传恶意软件或任何违法或侵犯他人权利的内容；',
              '未经书面许可探测、扫描或测试平台漏洞；',
              '干扰或破坏平台、其服务器或网络；',
              '未经我们同意使用机器人或爬虫等自动化手段访问平台；',
              '更改、删除或篡改审计日志；',
              '以违反适用法律的方式使用平台。',
            ],
          },
          '您知悉文档的编辑、审批和上传将生成与您账户关联的审计轨迹记录。',
          '您同意保持合同编号、有效期、金额及其他元数据准确，并与已签署的副本一致。',
        ],
      },
      {
        title: '第三方服务',
        clauses: [
          '第三方服务受其自身条款约束，我们对其可用性或行为不承担责任。',
        ],
      },
      {
        title: '免责声明',
        clauses: [
          '平台用于支持合同治理，按“现状”和“可用”基础提供。自动提醒仅作辅助。法律义务和通知期以已签署的合同为准，合同效力优先于平台中显示的任何数据。',
          '平台不提供法律意见。您应在依赖信息之前自行核实。',
          '我们不保证平台不会中断、无错误或不含有害组件。',
        ],
      },
      {
        title: '责任限制',
        clauses: [
          '在法律允许的最大范围内，对于因您使用或无法使用平台而产生的间接、附带、特殊或后果性损失、利润或商誉损失，或错过期限或通知期，我们不承担责任。',
          '本条款中任何内容均不排除依印度尼西亚法律不可排除的责任。',
        ],
      },
      {
        title: '暂停与终止',
        clauses: [
          '如您违反本条款（尤其是保密和安全条款）或法律要求，我们可立即暂停或终止您的访问，无论是否另行通知。',
          '您可随时停止使用平台。依其性质应在终止后继续有效的条款（包括保密、所有权、免责声明、责任和适用法律）将继续有效。',
          '终止后的记录保存按《隐私政策》所述处理。',
        ],
      },
      {
        title: '条款变更',
        clauses: [
          '我们可能不时修订本条款。“最后更新”日期标示当前版本，重大变更将通过平台通知。变更生效后继续使用即表示您接受。',
        ],
      },
      {
        title: '适用法律与联系方式',
        clauses: [
          '本条款受印度尼西亚共和国法律管辖并据其解释。双方应首先本着诚意通过协商友好解决争议。',
          '如对本条款有任何疑问，请联系我们位于印度尼西亚雅加达的法务运营与合规团队。',
        ],
      },
    ],
    contact: { title: 'Legal Operations & Compliance', text: '印度尼西亚雅加达', email: EMAIL },
  },
};
