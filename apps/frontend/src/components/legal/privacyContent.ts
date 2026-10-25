import type { LegalCatalog } from './LegalDocument';

const EMAIL = 'legal@company.com';

export const PRIVACY_CONTENT: LegalCatalog = {
  EN: {
    navLabel: 'Legalio • Privacy Policy',
    title: 'Privacy Policy',
    updated: 'August 29, 2026',
    intro: [
      'Welcome to Legalio, an enterprise contract and corporate document management system (the "Platform"). Legalio ("we", "us", "our") respects your privacy and is committed to protecting your Personal Data.',
      'This Privacy Policy explains how we collect, use, store, disclose and protect Personal Data when you access or use the Platform. Please read it carefully together with our Terms of Service.',
      'By registering for, accessing or using the Platform, you acknowledge that you have read and understood this Privacy Policy and consent to the collection, use and disclosure of your Personal Data as described below. If you do not agree, please do not use the Platform.',
    ],
    sections: [
      {
        title: 'Introduction and Scope',
        clauses: [
          '"Personal Data" means any data about an identified or identifiable individual, whether on its own or combined with other information, including as defined under Indonesian Law No. 27 of 2022 on Personal Data Protection ("PDP Law").',
          'The Platform is used for internal contract management, partner and vendor due diligence, Insertion Order (IO) tracking and notice-period reminders. This Privacy Policy applies to all users of the Platform and to Personal Data of individuals contained in documents uploaded to it.',
          'Where a user uploads Personal Data of a third party (for example a partner\'s director), the user confirms they are authorized to do so for legitimate corporate purposes.',
        ],
      },
      {
        title: 'Information We Collect',
        clauses: [
          {
            text: 'We collect the following categories of information:',
            items: [
              'Account information: full name, corporate email address, hashed credentials, role and permission level, team or organization, and account status;',
              'Contract and commercial information: contract numbers, agreement titles, partner names, start and end dates, commercial values, duration, auto-renewal terms, amendments and Insertion Orders;',
              'Due diligence documents: Business Identification Number (NIB), Tax ID (NPWP), Articles of Incorporation, director identification (KTP/Passport), bank account details and Non-Disclosure Agreements (NDA);',
              'Usage and audit information: timestamps of actions, document uploads and edits, session identifiers, IP address, browser and device information, and reminder dispatch records.',
            ],
          },
          'We collect this information when you register, when you or your administrator enter or upload data, when you use the Platform, and automatically through the Platform\'s logging systems.',
        ],
      },
      {
        title: 'Cookies and Similar Technologies',
        clauses: [
          'The Platform uses cookies and browser storage that are necessary for it to function, such as keeping you signed in, protecting your session and remembering your language and display preferences.',
          'We do not use cookies or similar technologies for advertising or behavioral profiling. You may block cookies in your browser settings, but parts of the Platform may then stop working.',
        ],
      },
      {
        title: 'How We Use Personal Data',
        clauses: [
          {
            text: 'We use Personal Data only for corporate legal administration and the following purposes:',
            items: [
              'to create and manage your account, verify your identity and apply role-based permissions;',
              'to track the contract lifecycle, including active dates, amendments and notice-period deadlines;',
              'to send expiry, renewal and approval reminders and system notifications;',
              'to maintain audit trails for governance, accountability and dispute resolution;',
              'to detect, prevent and investigate fraud, unauthorized access and security incidents;',
              'to comply with applicable laws, regulations and lawful requests from authorities;',
              'to maintain, support and improve the Platform.',
            ],
          },
          'We will not use your Personal Data for a purpose materially different from those above without informing you and, where required by law, obtaining your consent.',
        ],
      },
      {
        title: 'Disclosure of Personal Data',
        clauses: [
          'We do not sell Personal Data. We keep information confidential and disclose it only as described in this section.',
          {
            text: 'Personal Data may be disclosed to:',
            items: [
              'other authorized users of your organization, according to their assigned roles;',
              'service providers that host, store, back up or help us operate the Platform, who may process data only on our instructions;',
              'professional advisers such as auditors and legal counsel, under duties of confidentiality;',
              'courts, regulators, law enforcement or other authorities where required by law or legal process;',
              'a successor entity in a merger, acquisition or restructuring, subject to this Privacy Policy.',
            ],
          },
        ],
      },
      {
        title: 'Security of Personal Data',
        clauses: [
          {
            text: 'We apply technical and organizational safeguards appropriate to the sensitivity of the data, including:',
            items: [
              'encryption of data in transit using TLS/HTTPS;',
              'role-based access control (RBAC) so only authorized personnel can view sensitive contract and due diligence files;',
              'tamper-resistant audit logs recording actions and modifications;',
              'hashing of account credentials.',
            ],
          },
          'No system is completely secure. You are responsible for keeping your password confidential and for activity under your account. Please notify us immediately if you suspect unauthorized access.',
          'If a personal data protection failure occurs, we will notify affected parties and authorities as required by the PDP Law.',
        ],
      },
      {
        title: 'Retention and Deletion',
        clauses: [
          'We retain contract files and records for the duration of the agreement plus the statutory legal and tax retention periods under Indonesian law, typically 5 to 10 years after termination.',
          'When the retention period ends, or on a valid legal instruction, records are archived or securely deleted. Audit logs may be retained longer where necessary to protect legal claims.',
        ],
      },
      {
        title: 'International Transfers',
        clauses: [
          'Some service providers, may store or process data on servers outside Indonesia. Where Personal Data is transferred abroad, we take steps to ensure it receives a level of protection consistent with the PDP Law.',
        ],
      },
      {
        title: 'Children\'s Information',
        clauses: [
          'The Platform is intended for business use by adults. We do not knowingly collect Personal Data from persons under 18. If you believe a minor has provided Personal Data, contact us and we will delete it.',
        ],
      },
      {
        title: 'Your Rights',
        clauses: [
          {
            text: 'Subject to applicable law, you have the right to:',
            items: [
              'access and obtain a copy of your Personal Data we hold;',
              'request correction of inaccurate or outdated Personal Data;',
              'request deletion or restriction of processing, subject to our legal retention obligations;',
              'withdraw consent at any time;',
              'export your data in standard tabular formats (Excel/CSV);',
              'lodge a complaint with us or the competent authority.',
            ],
          },
          'To exercise these rights, contact us using the details below. We may need to verify your identity first and will respond within the period required by law.',
        ],
      },
      {
        title: 'Changes to this Policy',
        clauses: [
          'We may update this Privacy Policy from time to time. The "last updated" date shows the current version. Material changes will be notified through the Platform. Continued use after changes take effect means you accept the updated policy.',
        ],
      },
      {
        title: 'Contact Us',
        clauses: [
          'If you have questions, requests or complaints about this Privacy Policy or your Personal Data, please contact our Legal Operations & Compliance team in Jakarta, Indonesia.',
        ],
      },
    ],
    contact: { title: 'Legal Operations & Compliance', text: 'Jakarta, Republic of Indonesia', email: EMAIL },
  },

  ID: {
    navLabel: 'Legalio • Kebijakan Privasi',
    title: 'Kebijakan Privasi',
    updated: '29 Agustus 2026',
    intro: [
      'Selamat datang di Legalio, sistem manajemen kontrak dan dokumen korporat ("Platform"). Legalio ("kami") menghormati privasi Anda dan berkomitmen melindungi Data Pribadi Anda.',
      'Kebijakan Privasi ini menjelaskan bagaimana kami mengumpulkan, menggunakan, menyimpan, mengungkapkan, dan melindungi Data Pribadi saat Anda mengakses atau menggunakan Platform. Mohon baca bersama Ketentuan Layanan kami.',
      'Dengan mendaftar, mengakses, atau menggunakan Platform, Anda menyatakan telah membaca dan memahami Kebijakan Privasi ini serta menyetujui pengumpulan, penggunaan, dan pengungkapan Data Pribadi Anda sebagaimana diuraikan di bawah. Jika tidak setuju, mohon jangan menggunakan Platform.',
    ],
    sections: [
      {
        title: 'Pendahuluan dan Ruang Lingkup',
        clauses: [
          '"Data Pribadi" berarti setiap data tentang orang perseorangan yang teridentifikasi atau dapat diidentifikasi, baik secara tersendiri maupun dikombinasikan dengan informasi lain, termasuk sebagaimana didefinisikan dalam Undang-Undang No. 27 Tahun 2022 tentang Pelindungan Data Pribadi ("UU PDP").',
          'Platform digunakan untuk manajemen kontrak internal, uji tuntas (due diligence) mitra dan vendor, pelacakan Insertion Order (IO), dan pengingat masa pemberitahuan. Kebijakan ini berlaku bagi seluruh pengguna Platform dan Data Pribadi individu yang tercantum dalam dokumen yang diunggah.',
          'Apabila pengguna mengunggah Data Pribadi pihak ketiga (misalnya direktur mitra), pengguna menyatakan berwenang melakukannya untuk tujuan korporat yang sah.',
        ],
      },
      {
        title: 'Informasi yang Kami Kumpulkan',
        clauses: [
          {
            text: 'Kami mengumpulkan kategori informasi berikut:',
            items: [
              'Informasi akun: nama lengkap, email korporat, kredensial ter-hash, peran dan tingkat izin, tim atau organisasi, serta status akun;',
              'Informasi kontrak dan komersial: nomor kontrak, judul perjanjian, nama mitra, tanggal mulai dan berakhir, nilai komersial, durasi, ketentuan perpanjangan otomatis, amendemen, dan Insertion Order;',
              'Dokumen uji tuntas: Nomor Induk Berusaha (NIB), NPWP, Akta Pendirian, identitas direksi (KTP/Paspor), rekening bank, dan Perjanjian Kerahasiaan (NDA);',
              'Informasi penggunaan dan audit: waktu tindakan, pengunggahan dan perubahan dokumen, ID sesi, alamat IP, informasi peramban dan perangkat, serta catatan pengiriman pengingat.',
            ],
          },
          'Kami mengumpulkan informasi ini saat Anda mendaftar, saat Anda atau administrator memasukkan atau mengunggah data, saat Anda menggunakan Platform, dan secara otomatis melalui sistem pencatatan Platform.',
        ],
      },
      {
        title: 'Cookie dan Teknologi Serupa',
        clauses: [
          'Platform menggunakan cookie dan penyimpanan peramban yang diperlukan agar berfungsi, seperti menjaga Anda tetap masuk, melindungi sesi, serta mengingat preferensi bahasa dan tampilan.',
          'Kami tidak menggunakan cookie atau teknologi serupa untuk iklan atau pembuatan profil perilaku. Anda dapat memblokir cookie melalui pengaturan peramban, namun sebagian fungsi Platform dapat berhenti bekerja.',
        ],
      },
      {
        title: 'Cara Kami Menggunakan Data Pribadi',
        clauses: [
          {
            text: 'Kami menggunakan Data Pribadi hanya untuk administrasi hukum korporat dan tujuan berikut:',
            items: [
              'membuat dan mengelola akun Anda, memverifikasi identitas, dan menerapkan izin berbasis peran;',
              'melacak siklus hidup kontrak, termasuk tanggal berlaku, amendemen, dan tenggat masa pemberitahuan;',
              'mengirim pengingat kedaluwarsa, perpanjangan, dan persetujuan serta notifikasi sistem;',
              'memelihara jejak audit untuk tata kelola, akuntabilitas, dan penyelesaian sengketa;',
              'mendeteksi, mencegah, dan menyelidiki penipuan, akses tidak sah, dan insiden keamanan;',
              'mematuhi hukum, peraturan, dan permintaan sah dari otoritas;',
              'memelihara, mendukung, dan meningkatkan Platform.',
            ],
          },
          'Kami tidak akan menggunakan Data Pribadi Anda untuk tujuan yang berbeda secara material dari yang disebutkan tanpa memberi tahu Anda dan, jika diwajibkan hukum, memperoleh persetujuan Anda.',
        ],
      },
      {
        title: 'Pengungkapan Data Pribadi',
        clauses: [
          'Kami tidak menjual Data Pribadi. Kami menjaga kerahasiaan informasi dan hanya mengungkapkannya sebagaimana diuraikan pada bagian ini.',
          {
            text: 'Data Pribadi dapat diungkapkan kepada:',
            items: [
              'pengguna berwenang lain di organisasi Anda sesuai peran yang diberikan;',
              'penyedia layanan yang menghosting, menyimpan, mencadangkan, atau membantu operasional Platform, yang hanya boleh memproses data sesuai instruksi kami;',
              'penasihat profesional seperti auditor dan penasihat hukum, dengan kewajiban menjaga kerahasiaan;',
              'pengadilan, regulator, penegak hukum, atau otoritas lain bila diwajibkan oleh hukum atau proses hukum;',
              'pihak penerus dalam merger, akuisisi, atau restrukturisasi, dengan tetap tunduk pada Kebijakan Privasi ini.',
            ],
          },
        ],
      },
      {
        title: 'Keamanan Data Pribadi',
        clauses: [
          {
            text: 'Kami menerapkan pengamanan teknis dan organisasi yang sesuai dengan sensitivitas data, antara lain:',
            items: [
              'enkripsi data dalam transmisi menggunakan TLS/HTTPS;',
              'kontrol akses berbasis peran (RBAC) sehingga hanya personel berwenang yang dapat melihat berkas kontrak dan uji tuntas yang sensitif;',
              'log audit tahan manipulasi yang mencatat tindakan dan perubahan;',
              'hashing kredensial akun.',
            ],
          },
          'Tidak ada sistem yang sepenuhnya aman. Anda bertanggung jawab menjaga kerahasiaan kata sandi dan aktivitas di akun Anda. Segera beri tahu kami jika Anda mencurigai akses tidak sah.',
          'Jika terjadi kegagalan pelindungan data pribadi, kami akan memberi tahu pihak terdampak dan otoritas sebagaimana diwajibkan UU PDP.',
        ],
      },
      {
        title: 'Penyimpanan dan Penghapusan',
        clauses: [
          'Kami menyimpan berkas dan catatan kontrak selama masa perjanjian ditambah masa retensi hukum dan perpajakan menurut hukum Indonesia, umumnya 5 hingga 10 tahun setelah berakhir.',
          'Setelah masa retensi berakhir, atau atas instruksi hukum yang sah, catatan diarsipkan atau dihapus secara aman. Log audit dapat disimpan lebih lama jika diperlukan untuk melindungi klaim hukum.',
        ],
      },
      {
        title: 'Transfer Internasional',
        clauses: [
          'Beberapa penyedia layanan dapat menyimpan atau memproses data di server di luar Indonesia. Bila Data Pribadi ditransfer ke luar negeri, kami mengupayakan tingkat pelindungan yang sejalan dengan UU PDP.',
        ],
      },
      {
        title: 'Informasi Anak',
        clauses: [
          'Platform ditujukan untuk penggunaan bisnis oleh orang dewasa. Kami tidak dengan sengaja mengumpulkan Data Pribadi dari orang di bawah 18 tahun. Jika Anda yakin anak di bawah umur telah memberikan Data Pribadi, hubungi kami dan kami akan menghapusnya.',
        ],
      },
      {
        title: 'Hak Anda',
        clauses: [
          {
            text: 'Sesuai hukum yang berlaku, Anda berhak untuk:',
            items: [
              'mengakses dan memperoleh salinan Data Pribadi Anda yang kami simpan;',
              'meminta perbaikan Data Pribadi yang tidak akurat atau usang;',
              'meminta penghapusan atau pembatasan pemrosesan, dengan tunduk pada kewajiban retensi hukum kami;',
              'menarik persetujuan kapan saja;',
              'mengekspor data Anda dalam format tabular standar (Excel/CSV);',
              'mengajukan keluhan kepada kami atau otoritas yang berwenang.',
            ],
          },
          'Untuk menggunakan hak tersebut, hubungi kami melalui kontak di bawah. Kami mungkin perlu memverifikasi identitas Anda terlebih dahulu dan akan menanggapi dalam jangka waktu yang ditentukan hukum.',
        ],
      },
      {
        title: 'Perubahan Kebijakan',
        clauses: [
          'Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Tanggal "terakhir diperbarui" menunjukkan versi terkini. Perubahan material akan diberitahukan melalui Platform. Penggunaan berkelanjutan setelah perubahan berlaku berarti Anda menerima kebijakan yang diperbarui.',
        ],
      },
      {
        title: 'Hubungi Kami',
        clauses: [
          'Jika Anda memiliki pertanyaan, permintaan, atau keluhan terkait Kebijakan Privasi ini atau Data Pribadi Anda, silakan hubungi tim Legal Operations & Compliance kami di Jakarta, Indonesia.',
        ],
      },
    ],
    contact: { title: 'Legal Operations & Compliance', text: 'Jakarta, Republik Indonesia', email: EMAIL },
  },

  ZH: {
    navLabel: 'Legalio • 隐私政策',
    title: '隐私政策',
    updated: '2026年8月29日',
    intro: [
      '欢迎使用 Legalio，一个企业合同与公司文档管理系统（“平台”）。Legalio（“我们”）尊重您的隐私，并致力于保护您的个人数据。',
      '本隐私政策说明您访问或使用平台时，我们如何收集、使用、存储、披露和保护个人数据。请连同我们的《服务条款》一并仔细阅读。',
      '注册、访问或使用平台，即表示您已阅读并理解本隐私政策，并同意按下述方式收集、使用和披露您的个人数据。如不同意，请勿使用平台。',
    ],
    sections: [
      {
        title: '简介与适用范围',
        clauses: [
          '“个人数据”指与已识别或可识别的自然人有关的任何数据，无论单独使用还是与其他信息结合，包括印度尼西亚 2022 年第 27 号《个人数据保护法》（“PDP 法”）所定义的数据。',
          '平台用于内部合同管理、合作伙伴与供应商尽职调查、插单（IO）跟踪及通知期提醒。本政策适用于平台所有用户，以及上传文档中包含的个人数据。',
          '如用户上传第三方个人数据（例如合作伙伴的董事信息），用户确认其为合法的公司目的而获得授权。',
        ],
      },
      {
        title: '我们收集的信息',
        clauses: [
          {
            text: '我们收集以下类别的信息：',
            items: [
              '账户信息：姓名、公司邮箱、哈希凭证、角色与权限级别、团队或组织、账户状态；',
              '合同与商业信息：合同编号、协议标题、合作伙伴名称、起止日期、商业金额、期限、自动续约条款、补充协议及插单；',
              '尽职调查文件：营业识别号（NIB）、税号（NPWP）、公司章程、董事身份证明（KTP/护照）、银行账户及保密协议（NDA）；',
              '使用与审计信息：操作时间戳、文档上传与编辑、会话标识、IP 地址、浏览器与设备信息及提醒发送记录。',
            ],
          },
          '我们在您注册、您或管理员录入或上传数据、您使用平台时收集这些信息，并通过平台日志系统自动收集。',
        ],
      },
      {
        title: 'Cookie 及类似技术',
        clauses: [
          '平台使用运行所必需的 Cookie 和浏览器存储，例如保持登录状态、保护会话以及记住语言和显示偏好。',
          '我们不将 Cookie 或类似技术用于广告或行为画像。您可在浏览器设置中阻止 Cookie，但平台部分功能可能因此无法使用。',
        ],
      },
      {
        title: '我们如何使用个人数据',
        clauses: [
          {
            text: '我们仅为公司法务管理及以下目的使用个人数据：',
            items: [
              '创建和管理您的账户、验证身份并应用基于角色的权限；',
              '跟踪合同生命周期，包括生效日期、补充协议和通知期限；',
              '发送到期、续约和审批提醒及系统通知；',
              '维护审计轨迹，用于治理、问责和争议解决；',
              '检测、防止和调查欺诈、未经授权的访问及安全事件；',
              '遵守适用法律法规及主管机关的合法要求；',
              '维护、支持和改进平台。',
            ],
          },
          '未经告知并在法律要求时取得您的同意，我们不会将您的个人数据用于与上述目的存在实质差异的用途。',
        ],
      },
      {
        title: '个人数据的披露',
        clauses: [
          '我们不出售个人数据。我们对信息保密，仅按本节所述披露。',
          {
            text: '个人数据可能披露给：',
            items: [
              '您所在组织中其他获授权用户，依其被分配的角色而定；',
              '托管、存储、备份或协助运营平台的服务提供商，其仅可按我们的指示处理数据；',
              '审计师、法律顾问等负有保密义务的专业顾问；',
              '依法律或法律程序要求的法院、监管机构、执法机关或其他主管机关；',
              '合并、收购或重组中的继受实体，其仍受本隐私政策约束。',
            ],
          },
        ],
      },
      {
        title: '个人数据的安全',
        clauses: [
          {
            text: '我们根据数据敏感程度采取适当的技术和组织措施，包括：',
            items: [
              '使用 TLS/HTTPS 对传输中的数据加密；',
              '基于角色的访问控制（RBAC），仅获授权人员可查看敏感的合同和尽职调查文件；',
              '记录操作与修改的防篡改审计日志；',
              '对账户凭证进行哈希处理。',
            ],
          },
          '没有任何系统是绝对安全的。您有责任保管好密码，并对账户下的活动负责。如怀疑存在未经授权的访问，请立即通知我们。',
          '如发生个人数据保护失败，我们将依 PDP 法要求通知受影响方和主管机关。',
        ],
      },
      {
        title: '保留与删除',
        clauses: [
          '我们在协议期间加上印度尼西亚法律规定的法律和税务保存期内保留合同文件和记录，通常为终止后 5 至 10 年。',
          '保存期届满或依有效法律指令，记录将被归档或安全删除。为保护法律主张所必需时，审计日志可保留更久。',
        ],
      },
      {
        title: '跨境传输',
        clauses: [
          '部分服务提供商可能在印度尼西亚境外的服务器上存储或处理数据。个人数据被转移至境外时，我们会采取措施确保其获得与 PDP 法相符的保护水平。',
        ],
      },
      {
        title: '儿童信息',
        clauses: [
          '平台面向成年人的商业用途。我们不会故意收集 18 岁以下人士的个人数据。如您认为未成年人提供了个人数据，请联系我们，我们将予以删除。',
        ],
      },
      {
        title: '您的权利',
        clauses: [
          {
            text: '在适用法律允许的范围内，您有权：',
            items: [
              '访问并获取我们持有的您的个人数据副本；',
              '要求更正不准确或过时的个人数据；',
              '要求删除或限制处理，但须遵守我们的法定保存义务；',
              '随时撤回同意；',
              '以标准表格格式（Excel/CSV）导出您的数据；',
              '向我们或主管机关投诉。',
            ],
          },
          '如需行使上述权利，请通过下方联系方式联系我们。我们可能需要先验证您的身份，并将在法律规定的期限内答复。',
        ],
      },
      {
        title: '政策变更',
        clauses: [
          '我们可能不时更新本隐私政策，“最后更新”日期标示当前版本。重大变更将通过平台通知。变更生效后继续使用即表示您接受更新后的政策。',
        ],
      },
      {
        title: '联系我们',
        clauses: [
          '如您对本隐私政策或您的个人数据有任何疑问、请求或投诉，请联系我们位于印度尼西亚雅加达的法务运营与合规团队。',
        ],
      },
    ],
    contact: { title: 'Legal Operations & Compliance', text: '印度尼西亚雅加达', email: EMAIL },
  },
};
