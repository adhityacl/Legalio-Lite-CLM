import type { NextFunction, Request, Response } from 'express';

/**
 * Translates API error / status messages into the UI language sent in `x-app-language`
 * (see src/lib/apiFetch.ts). Routes keep writing their message in English or Indonesian;
 * the text is matched here, so a route message missing from this list is sent unchanged.
 */
type Lang = 'EN' | 'ID' | 'ZH';
type Entry = readonly [en: string, id: string, zh: string];

/** `{0}`, `{1}`… stand for the values the route puts in the message, in the order they appear in the original. */
const MESSAGES: Entry[] = [
  ['Your account is waiting for manual superuser approval.', 'Akun Anda menunggu persetujuan manual superuser.', '您的账户正在等待超级用户手动批准。'],
  ['Forbidden: Account Banned', 'Ditolak: Akun Dicekal', '禁止访问：账户已被封禁'],
  ['Your account has been deactivated/banned by an Administrator. Please contact the IT/Admin team.', 'Akun Anda telah dinonaktifkan/banned oleh Administrator. Silakan hubungi tim IT/Admin.', '您的账户已被管理员停用 / 封禁。请联系 IT / 管理团队。'],
  ['Authentication is required.', 'Autentikasi diperlukan.', '需要身份验证。'],
  ['Role {0} is not allowed to change data ({1}).', 'Peran {0} tidak memiliki izin untuk melakukan perubahan data ({1}).', '角色 {0} 无权修改数据（{1}）。'],
  ['Unauthorized', 'Tidak diizinkan', '未授权'],
  ['Organization ID header is missing', 'Header ID organisasi tidak ada', '缺少组织 ID 请求头'],
  ['Forbidden: Insufficient permissions for this tenant', 'Ditolak: Izin tidak cukup untuk tenant ini', '禁止访问：您对该租户的权限不足'],
  ['Internal server error', 'Kesalahan internal server', '服务器内部错误'],
  ['Tenant secret: Admin/Owner of this organization only.', 'Rahasia Tenant: Hanya untuk Admin/Owner organisasi ini.', '租户机密：仅限本组织的管理员 / 所有者。'],
  ['Resource not found.', 'Sumber daya tidak ditemukan.', '未找到资源。'],
  ['Missing GEMINI_API_KEY. Enter the Gemini API key under Settings > AI Model & Parser.', 'Missing GEMINI_API_KEY. Silakan masukkan Gemini API Key di menu Pengaturan (Settings) > Model AI & Parser.', '缺少 GEMINI_API_KEY。请在“设置 > AI 模型与解析器”中输入 Gemini API 密钥。'],
  ['Timeout: model {0} took longer than {1}s', 'Timeout: model {0} membutuhkan lebih dari {1} detik', '超时：模型 {0} 用时超过 {1} 秒'],
  ['Your Gemini API key quota has been exceeded (Quota Exceeded / Rate Limit). Check your Google AI Studio account or update the API key under Settings > AI Model & Parser.', 'Batas kuota Gemini API Key Anda telah terlampaui (Quota Exceeded / Rate Limit). Silakan periksa akun Google AI Studio atau perbarui API Key di menu Settings > AI Model & Parser.', '您的 Gemini API 密钥配额已用尽（超出配额 / 速率限制）。请检查 Google AI Studio 账户，或在“设置 > AI 模型与解析器”中更新 API 密钥。'],
  ['The Gemini API key is invalid. Check your API key under Settings > AI Model & Parser.', 'Gemini API Key tidak valid. Silakan periksa kembali API Key Anda di menu Settings > AI Model & Parser.', 'Gemini API 密钥无效。请在“设置 > AI 模型与解析器”中检查您的 API 密钥。'],
  ['The Google Gemini AI model is busy or not responding. Please try again in a moment.', 'Google AI Gemini model sedang sibuk atau tidak merespons. Silakan coba lagi beberapa saat lagi.', 'Google Gemini AI 模型繁忙或无响应，请稍后重试。'],
  ['The SMTP relay is not enabled or not configured.', 'SMTP Relay belum diaktifkan atau belum dikonfigurasi.', 'SMTP 中继未启用或未配置。'],
  ['Not authenticated.', 'Tidak terautentikasi.', '未通过身份验证。'],
  ['Access Denied', 'Akses Ditolak', '拒绝访问'],
  ['Email \'{0}\' has been deactivated. Contact the Administrator team.', 'Email \'{0}\' telah dinonaktifkan. Hubungi Tim Administrator.', '邮箱“{0}”已被停用。请联系管理员团队。'],
  ['The AI provider returned no headlines.', 'Penyedia AI tidak mengembalikan judul berita.', 'AI 服务未返回任何新闻标题。'],
  ['Failed to load the news ticker.', 'Gagal memuat ticker berita.', '加载新闻滚动条失败。'],
  ['Failed to fetch departments', 'Gagal memuat departemen', '获取部门失败'],
  ['Forbidden: Only Admins can manage whitelist.', 'Ditolak: Hanya Admin yang dapat mengelola whitelist.', '禁止访问：只有管理员可以管理白名单。'],
  ['Email, name, and role are required.', 'Email, Nama, dan Role wajib diisi.', '邮箱、姓名和角色为必填项。'],
  ['Email \'{0}\' is already on the whitelist.', 'Email \'{0}\' sudah ada dalam daftar whitelist.', '邮箱“{0}”已在白名单中。'],
  ['User not found.', 'Pengguna tidak ditemukan.', '未找到用户。'],
  ['The system needs at least 1 active Admin account. Create another Admin before changing this account\'s role.', 'Sistem membutuhkan minimal 1 akun Admin aktif. Buat Admin lain terlebih dahulu sebelum mengubah role akun ini.', '系统至少需要 1 个有效的管理员账户。请先创建另一个管理员，再更改此账户的角色。'],
  ['You cannot delete your own account while signed in.', 'Anda tidak dapat menghapus akun Anda sendiri saat sedang login.', '登录状态下无法删除您自己的账户。'],
  ['You cannot delete the only remaining Admin account in the system.', 'Tidak dapat menghapus satu-satunya akun Admin yang tersisa di sistem.', '无法删除系统中仅剩的管理员账户。'],
  ['Forbidden: Only Admins can reset user passwords.', 'Forbidden: Hanya Admin yang dapat mereset password pengguna.', '禁止访问：只有管理员可以重置用户密码。'],
  ['Email and new password are required.', 'Email dan Password Baru wajib diisi.', '邮箱和新密码为必填项。'],
  ['Password must be at least 6 characters.', 'Password minimal 6 karakter.', '密码至少需要 6 个字符。'],
  ['Password for \'{0}\' was reset!', 'Password untuk \'{0}\' berhasil direset!', '“{0}”的密码已重置！'],
  ['An error occurred while resetting the password.', 'Terjadi kesalahan saat mereset password.', '重置密码时出错。'],
  ['AI features are disabled for this organization.', 'Fitur AI dinonaktifkan untuk organisasi ini.', '该组织已停用 AI 功能。'],
  ['No AI provider key is configured. Add one under Settings > AI.', 'Belum ada kunci penyedia AI. Tambahkan di Settings > AI.', '尚未配置 AI 服务密钥。请在“设置 > AI”中添加。'],
  ['File (binary or base64) is required', 'File (biner atau base64) wajib diisi', '必须提供文件（二进制或 base64）'],
  ['Failed to parse document. Google AI model is currently busy, please try again.', 'Gagal membaca dokumen. Model Google AI sedang sibuk, silakan coba lagi.', '文档解析失败。Google AI 模型当前繁忙，请重试。'],
  ['Partner name is required.', 'Nama partner wajib diisi.', '合作伙伴名称为必填项。'],
  ['Failed to generate the AI due diligence summary.', 'Gagal menghasilkan ringkasan Due Diligence AI.', '生成 AI 尽职调查摘要失败。'],
  ['Partner name is required.', 'Nama Partner wajib diisi.', '合作伙伴名称为必填项。'],
  ['Partner not found.', 'Partner tidak ditemukan.', '未找到合作伙伴。'],
  ['Please complete all required evaluation form fields.', 'Harap lengkapi semua bidang isian formulir evaluasi yang wajib.', '请填写评估表中的所有必填字段。'],
  ['Evaluation data not found.', 'Data evaluasi tidak ditemukan.', '未找到评估数据。'],
  ['Failed to parse Spending document. Google AI model is currently busy, please try again.', 'Gagal membaca dokumen Spending. Model Google AI sedang sibuk, silakan coba lagi.', '支出文档解析失败。Google AI 模型当前繁忙，请重试。'],
  ['Vendor Name, Invoice Number, and Total Amount are required.', 'Nama Vendor, Nomor Invoice, dan Total Nilai wajib diisi.', '供应商名称、发票编号和总金额为必填项。'],
  ['Spending data not found.', 'Data spending tidak ditemukan.', '未找到支出数据。'],
  ['Title and contentHtml are required.', 'Title dan contentHtml wajib diisi.', '标题和 contentHtml 为必填项。'],
  ['Failed to create the Google Docs document.', 'Gagal membuat dokumen Google Docs.', '创建 Google 文档失败。'],
  ['Failed to parse contract document. Google AI model is currently busy, please try again.', 'Gagal membaca dokumen kontrak. Model Google AI sedang sibuk, silakan coba lagi.', '合同文档解析失败。Google AI 模型当前繁忙，请重试。'],
  ['Contract not found.', 'Kontrak tidak ditemukan.', '未找到合同。'],
  ['The AI redline analysis failed. Please try again.', 'Gagal melakukan analisis redline AI. Silakan coba kembali.', 'AI 红线分析失败，请重试。'],
  ['Name and content are required.', 'Nama dan konten wajib diisi.', '名称和内容为必填项。'],
  ['Template not found.', 'Template tidak ditemukan.', '未找到模板。'],
  ['Contract number, title, partner, and start/end dates are required.', 'Nomor Kontrak, Judul, Partner, dan Tanggal Mula/Selesai wajib diisi.', '合同编号、名称、合作伙伴及开始 / 结束日期为必填项。'],
  ['The end date must be after the start date.', 'Tanggal Berakhir harus setelah Tanggal Mulai.', '结束日期必须晚于开始日期。'],
  ['Contract number \'{0}\' is already registered in the system.', 'Nomor Kontrak \'{0}\' sudah terdaftar dalam sistem.', '合同编号“{0}”已在系统中登记。'],
  ['Contract number \'{0}\' is already used by another contract.', 'Nomor Kontrak \'{0}\' sudah digunakan oleh kontrak lain.', '合同编号“{0}”已被其他合同使用。'],
  ['Failed to parse IO document. Google AI model is currently busy, please try again.', 'Gagal membaca dokumen IO. Model Google AI sedang sibuk, silakan coba lagi.', 'IO 文档解析失败。Google AI 模型当前繁忙，请重试。'],
  ['IO number, title, partner, dates, pricing model & charging type are required.', 'Nomor IO, Judul, Partner, Tanggal, Pricing Model, & Charging Type wajib diisi.', 'IO 编号、名称、合作伙伴、日期、定价模式和计费类型为必填项。'],
  ['IO number \'{0}\' is already registered in the system.', 'Nomor IO \'{0}\' sudah terdaftar dalam sistem.', 'IO 编号“{0}”已在系统中登记。'],
  ['IO not found.', 'IO tidak ditemukan.', '未找到 IO。'],
  ['IO number \'{0}\' is already used by another IO.', 'Nomor IO \'{0}\' sudah digunakan oleh IO lain.', 'IO 编号“{0}”已被其他 IO 使用。'],
  ['Authorization code is required', 'Authorization code wajib diisi', '必须提供授权码'],
  ['The Google OAuth client is not configured. Upload the OAuth client JSON file under Settings → Google, or set GOOGLE_CLIENT_ID.', 'OAuth client Google belum dikonfigurasi. Unggah file JSON OAuth client di Settings → Google, atau isi GOOGLE_CLIENT_ID.', '尚未配置 Google OAuth 客户端。请在“设置 → Google”中上传 OAuth 客户端 JSON 文件，或设置 GOOGLE_CLIENT_ID。'],
  ['Failed to get an access token from the Google OAuth server.', 'Gagal mendapatkan Access Token dari Google OAuth server.', '无法从 Google OAuth 服务器获取访问令牌。'],
  ['Failed to exchange the Google authorization code.', 'Gagal menukarkan Google Authorization Code.', '交换 Google 授权码失败。'],
  ['Failed to check the Google token.', 'Gagal memeriksa token Google.', '检查 Google 令牌失败。'],
  ['Failed to refresh the Google token.', 'Gagal me-refresh token Google.', '刷新 Google 令牌失败。'],
  ['Email is required to sync the account.', 'Email diperlukan untuk sinkronisasi akun.', '同步账户需要邮箱。'],
  ['The Google sign-in could not be verified. Please sign in again.', 'Login Google tidak dapat diverifikasi. Silakan masuk kembali.', '无法验证 Google 登录，请重新登录。'],
  ['This Google account has not been invited. Ask an administrator to add you.', 'Akun Google ini belum diundang. Minta administrator untuk menambahkan Anda.', '此 Google 账户尚未被邀请。请联系管理员添加您。'],
  ['Your account has been deactivated by an Administrator.', 'Akun Anda telah dinonaktifkan oleh Administrator.', '您的账户已被管理员停用。'],
  ['Failed to sync the Google session to Better Auth.', 'Gagal menyinkronkan sesi Google ke Better Auth.', '将 Google 会话同步到 Better Auth 失败。'],
  ['Forbidden: only administrators can change the Google integration.', 'Ditolak: hanya administrator yang dapat mengubah integrasi Google.', '禁止访问：只有管理员可以更改 Google 集成。'],
  ['A Google access token or refresh token is required.', 'Access token atau Refresh token Google diperlukan.', '需要 Google 访问令牌或刷新令牌。'],
  ['Failed to sync the Google connection status.', 'Gagal menyinkronkan status koneksi Google.', '同步 Google 连接状态失败。'],
  ['The Google account was disconnected from the server configuration.', 'Akun Google berhasil diputuskan dari konfigurasi server.', 'Google 账户已从服务器配置中断开。'],
  ['Failed to disconnect the Google account on the server.', 'Gagal memutuskan akun Google di server.', '在服务器上断开 Google 账户失败。'],
  ['Unauthorized: please sign in first.', 'Unauthorized: Harap login terlebih dahulu.', '未授权：请先登录。'],
  ['Forbidden: Only Admins can modify settings.', 'Ditolak: Hanya Admin yang dapat mengubah pengaturan.', '禁止访问：只有管理员可以修改设置。'],
  ['Forbidden: Only Admins can test SMTP settings.', 'Ditolak: Hanya Admin yang dapat menguji pengaturan SMTP.', '禁止访问：只有管理员可以测试 SMTP 设置。'],
  ['SMTP host, username, and test recipient email are required.', 'SMTP Host, Username, dan Email Penerima Uji Coba wajib diisi.', 'SMTP 主机、用户名和测试收件人邮箱为必填项。'],
  ['Test email sent to \'{0}\'! (Message ID: {1})', 'Email uji coba berhasil dikirim ke \'{0}\'! (Message ID: {1})', '测试邮件已发送至“{0}”！（消息 ID：{1}）'],
  ['Failed to send email via the SMTP relay: {0}', 'Gagal mengirim email via SMTP Relay: {0}', '通过 SMTP 中继发送邮件失败：{0}'],
  ['The API key is empty. Enter a Gemini API key first.', 'API Key belum diisi. Masukkan Gemini API Key terlebih dahulu.', 'API 密钥为空。请先输入 Gemini API 密钥。'],
  ['Connected to the Google Gemini API! (Active model: {0})', 'Koneksi ke Google Gemini API berhasil! (Model aktif: {0})', '已成功连接 Google Gemini API！（当前模型：{0}）'],
  ['No response from the Gemini API.', 'Tidak ada respon dari Gemini API.', 'Gemini API 无响应。'],
  ['Failed to connect to the Google Gemini API. Make sure the API key is valid.', 'Gagal terhubung ke Google Gemini API. Pastikan API Key valid.', '连接 Google Gemini API 失败。请确认 API 密钥有效。'],
  ['Data is synced and fully stored in the SQLite database (single source of truth).', 'Data tersinkronisasi dan tersimpan penuh di database SQLite (Single Source of Truth).', '数据已同步并完整存储在 SQLite 数据库中（唯一可信数据源）。'],
  ['SQLite WAL is active as the single source of truth.', 'SQLite WAL aktif sebagai single source of truth.', 'SQLite WAL 已作为唯一可信数据源启用。'],
  ['The sync queue is clear. SQLite WAL is active.', 'Sinkronisasi antrean bersih. SQLite WAL aktif.', '同步队列已清空。SQLite WAL 已启用。'],
  ['Forbidden: only an Admin/Superuser can create the Master Root.', 'Forbidden: Hanya Admin/Superuser yang berhak membuat Master Root.', '禁止访问：只有管理员 / 超级用户可以创建主根目录。'],
  ['Google is not connected. Connect a Google account first.', 'Koneksi Google belum aktif. Hubungkan akun Google terlebih dahulu.', 'Google 尚未连接。请先连接 Google 账户。'],
  ['Failed to create the database spreadsheet in the folder.', 'Gagal membuat Spreadsheet Database di dalam folder.', '在文件夹中创建数据库表格失败。'],
  ['The Master Root folder, database spreadsheet, organization folder and organization database sheet were created automatically in Google Drive.', 'Master Root Folder, Spreadsheet Database, serta Folder Organisasi dan Sheet Database Organisasi berhasil dibuat otomatis di Google Drive.', '已在 Google Drive 中自动创建主根文件夹、数据库表格、组织文件夹及组织数据库工作表。'],
  ['Failed to create the Master Root automatically.', 'Gagal membuat Master Root secara otomatis.', '自动创建主根目录失败。'],
  ['Forbidden: only an Admin/Superuser can sync organization folders.', 'Forbidden: Hanya Admin/Superuser yang berhak menyinkronkan folder organisasi.', '禁止访问：只有管理员 / 超级用户可以同步组织文件夹。'],
  ['Organization folders synced to the Master Root ({0} organizations synced).', 'Berhasil menyinkronkan folder organisasi ke Master Root ({0} organisasi disinkronkan).', '已将组织文件夹同步到主根目录（已同步 {0} 个组织）。'],
  ['Failed to sync organization folders to the Master Root.', 'Gagal menyinkronkan folder organisasi ke Master Root.', '将组织文件夹同步到主根目录失败。'],
  ['Forbidden: Only Admins can provision folders.', 'Ditolak: Hanya Admin yang dapat membuat folder.', '禁止访问：只有管理员可以创建文件夹。'],
  ['4 category subfolders (Contract, Invoice & Billing, IO, DD folders) were created/updated for {0} partners.', '4 Subfolder Kategori (Folder Contract, Folder Invoice & Billing, Folder IO, Folder DD) berhasil dibuat/diperbarui untuk {0} partner.', '已为 {0} 个合作伙伴创建 / 更新 4 个分类子文件夹（合同、发票与账单、IO、尽调）。'],
  ['Failed to create category folders.', 'Gagal membuat folder kategori.', '创建分类文件夹失败。'],
  ['Only a superuser can reset the application.', 'Hanya superuser yang dapat mereset aplikasi.', '只有超级用户可以重置应用。'],
  ['Invalid confirmation. Type "RESET NOW" to reset the application.', 'Konfirmasi tidak valid. Ketik "RESET NOW" untuk mereset aplikasi.', '确认无效。请输入“RESET NOW”以重置应用。'],
  ['mode must be "empty" or "demo".', 'mode harus "empty" atau "demo".', 'mode 必须为 "empty" 或 "demo"。'],
  ['Failed to reset organization tables.', 'Gagal mereset tabel organisasi.', '重置组织数据表失败。'],
  ['The application was reset and the demo dataset was loaded.', 'Aplikasi telah direset dan data demo telah dimuat.', '应用已重置，并已加载演示数据。'],
  ['The application was reset. Organization "{0}" is ready to use.', 'Aplikasi telah direset. Organisasi "{0}" siap digunakan.', '应用已重置。组织“{0}”已可使用。'],
  ['Google Service Account authentication for the Google Sheets API was configured.', 'Otentikasi Google Service Account untuk Google Sheets API berhasil dikonfigurasi.', '已为 Google Sheets API 配置 Google 服务账户认证。'],
  ['Data type and rows cannot be empty.', 'Tipe data dan baris tidak boleh kosong.', '数据类型和行不能为空。'],
  ['The partner_name column is required.', 'Kolom partner_name wajib diisi.', 'partner_name 列为必填项。'],
  ['A partner named "{0}" already exists (ID: {1}).', 'Partner dengan nama "{0}" sudah ada (ID: {1}).', '名为“{0}”的合作伙伴已存在（ID：{1}）。'],
  ['Partner created (ID: {0}).', 'Partner berhasil dibuat (ID: {0}).', '合作伙伴已创建（ID：{0}）。'],
  ['Failed to create partner.', 'Gagal membuat partner.', '创建合作伙伴失败。'],
  ['The contract_number column is required.', 'Kolom contract_number wajib diisi.', 'contract_number 列为必填项。'],
  ['Contract "{0}" already exists (ID: {1}).', 'Kontrak "{0}" sudah ada (ID: {1}).', '合同“{0}”已存在（ID：{1}）。'],
  ['Contract created (ID: {0}).', 'Kontrak berhasil dibuat (ID: {0}).', '合同已创建（ID：{0}）。'],
  ['Failed to create contract.', 'Gagal membuat kontrak.', '创建合同失败。'],
  ['The io_number column is required.', 'Kolom io_number wajib diisi.', 'io_number 列为必填项。'],
  ['IO "{0}" already exists (ID: {1}).', 'IO "{0}" sudah ada (ID: {1}).', 'IO“{0}”已存在（ID：{1}）。'],
  ['IO created (ID: {0}).', 'IO berhasil dibuat (ID: {0}).', 'IO 已创建（ID：{0}）。'],
  ['Failed to create IO.', 'Gagal membuat IO.', '创建 IO 失败。'],
  ['The supplier_name and review_date columns are required.', 'Kolom supplier_name dan review_date wajib diisi.', 'supplier_name 和 review_date 列为必填项。'],
  ['An evaluation for "{0}" on {1} already exists.', 'Evaluasi untuk "{0}" pada {1} sudah ada.', '“{0}”在 {1} 的评估已存在。'],
  ['Evaluation created (ID: {0}).', 'Evaluasi berhasil dibuat (ID: {0}).', '评估已创建（ID：{0}）。'],
  ['Failed to create evaluation.', 'Gagal membuat evaluasi.', '创建评估失败。'],
  ['The invoice_number and vendor_name columns are required.', 'Kolom invoice_number dan vendor_name wajib diisi.', 'invoice_number 和 vendor_name 列为必填项。'],
  ['Invoice "{0}" for "{1}" already exists (ID: {2}).', 'Invoice "{0}" untuk "{1}" sudah ada (ID: {2}).', '“{1}”的发票“{0}”已存在（ID：{2}）。'],
  ['Spending created (ID: {0}).', 'Spending berhasil dibuat (ID: {0}).', '支出记录已创建（ID：{0}）。'],
  ['Failed to create spending.', 'Gagal membuat spending.', '创建支出记录失败。'],
  ['Unknown import type: {0}', 'Tipe import tidak dikenal: {0}', '未知的导入类型：{0}'],
  ['Bulk import {0}: {1} succeeded, {2} skipped, {3} failed.', 'Bulk import {0}: {1} berhasil, {2} dilewati, {3} gagal.', '批量导入 {0}：成功 {1} 条，跳过 {2} 条，失败 {3} 条。'],
  ['tenantId is required.', 'tenantId wajib diisi.', 'tenantId 为必填项。'],
  ['Tenant not found.', 'Tenant tidak ditemukan.', '未找到租户。'],
  ['Tenant name is required.', 'Nama tenant wajib diisi.', '租户名称为必填项。'],
  ['Default tenant cannot be deleted.', 'Tenant default tidak dapat dihapus.', '默认租户无法删除。'],
  ['Organization not found.', 'Organisasi tidak ditemukan.', '未找到组织。'],
  ['Google is not connected. Connect a Google Drive session / Service Account first.', 'Koneksi Google belum aktif. Hubungkan sesi Google Drive / Service Account terlebih dahulu.', 'Google 尚未连接。请先连接 Google Drive 会话 / 服务账户。'],
  ['Google Drive folders configured for {0}.', 'Berhasil mengonfigurasi folder Google Drive untuk {0}.', '已为 {0} 配置 Google Drive 文件夹。'],
  ['Failed to set up Google Drive for the organization.', 'Gagal mengatur Google Drive untuk organisasi.', '为组织设置 Google Drive 失败。'],
  ['Organization data \'{0}\' is stored safely & synced in the SQLite database.', 'Data organisasi \'{0}\' tersimpan aman & tersinkronisasi di database SQLite.', '组织“{0}”的数据已安全存储并同步到 SQLite 数据库。'],
  ['Query is required', 'Query wajib diisi', '必须提供查询内容'],
  ['Failed to process AI request', 'Gagal memproses permintaan AI', '处理 AI 请求失败'],
  ['Only administrators can change organization settings.', 'Hanya administrator yang dapat mengubah pengaturan organisasi.', '只有管理员可以更改组织设置。'],
  ['API route not found: {0} {1}', 'Route API tidak ditemukan: {0} {1}', '未找到 API 路由：{0} {1}'],
  ['An internal server error occurred.', 'Terjadi kesalahan internal server.', '服务器内部发生错误。'],
  ['You do not have permission to access this area.', 'Anda tidak memiliki izin untuk mengakses area ini.', '您无权访问此区域。'],
  ['System Admin access is required.', 'Diperlukan akses System Admin.', '需要系统管理员权限。'],
  ['Failed to fetch console overview', 'Gagal memuat ringkasan konsol', '获取控制台概览失败'],
  ['Failed to list users', 'Gagal memuat daftar pengguna', '获取用户列表失败'],
  ['Name and email are required', 'Nama dan email wajib diisi', '姓名和邮箱为必填项'],
  ['An organization/tenant must be selected for roles below Superuser and Admin.', 'Organisasi/Tenant wajib dipilih untuk peran di bawah Superuser dan Admin.', '低于超级用户和管理员的角色必须选择组织 / 租户。'],
  ['User with this email already exists', 'Pengguna dengan email ini sudah ada', '使用该邮箱的用户已存在'],
  ['Failed to create user', 'Gagal membuat pengguna', '创建用户失败'],
  ['User not found', 'Pengguna tidak ditemukan', '未找到用户'],
  ['Failed to update user', 'Gagal memperbarui pengguna', '更新用户失败'],
  ['Password must be at least 6 characters', 'Kata sandi minimal 6 karakter', '密码至少需要 6 个字符'],
  ['Password reset successful for {0}', 'Kata sandi {0} berhasil direset', '已成功重置 {0} 的密码'],
  ['Failed to reset password', 'Gagal mereset kata sandi', '重置密码失败'],
  ['Password updated for {0}', 'Kata sandi {0} berhasil diperbarui', '已更新 {0} 的密码'],
  ['Failed to update password', 'Gagal memperbarui kata sandi', '更新密码失败'],
  ['Role is required', 'Peran wajib diisi', '角色为必填项'],
  ['Email address is already in use by another user', 'Alamat email sudah digunakan pengguna lain', '该邮箱地址已被其他用户使用'],
  ['Failed to update user role', 'Gagal memperbarui peran pengguna', '更新用户角色失败'],
  ['User banned', 'Pengguna berhasil dicekal', '用户已被封禁'],
  ['The user\'s ban was lifted', 'Status cekal pengguna telah dicabut', '已解除该用户的封禁'],
  ['Failed to update ban status', 'Gagal memperbarui status cekal', '更新封禁状态失败'],
  ['User deleted successfully', 'Pengguna berhasil dihapus', '用户已成功删除'],
  ['Failed to delete user', 'Gagal menghapus pengguna', '删除用户失败'],
  ['Action and non-empty userIds array are required', 'Aksi dan daftar userIds yang tidak kosong wajib diisi', '必须提供操作及非空的 userIds 数组'],
  ['{0} users banned in bulk', '{0} pengguna berhasil dicekal secara massal', '已批量封禁 {0} 个用户'],
  ['Ban lifted for {0} users', 'Status cekal {0} pengguna berhasil dicabut', '已解除 {0} 个用户的封禁'],
  ['{0} users deleted in bulk', '{0} pengguna berhasil dihapus secara massal', '已批量删除 {0} 个用户'],
  ['Invalid bulk action', 'Aksi massal tidak valid', '无效的批量操作'],
  ['Failed to execute bulk action', 'Gagal menjalankan aksi massal', '执行批量操作失败'],
  ['Failed to list accounts', 'Gagal memuat daftar akun', '获取账户列表失败'],
  ['Failed to list sessions', 'Gagal memuat daftar sesi', '获取会话列表失败'],
  ['Session revoked successfully', 'Sesi berhasil dicabut', '会话已成功撤销'],
  ['Failed to revoke session', 'Gagal mencabut sesi', '撤销会话失败'],
  ['userId is required', 'userId wajib diisi', 'userId 为必填项'],
  ['All sessions revoked for user {0}', 'Semua sesi pengguna {0} berhasil dicabut', '已撤销用户 {0} 的所有会话'],
  ['Failed to revoke user sessions', 'Gagal mencabut sesi pengguna', '撤销用户会话失败'],
  ['Failed to list organizations', 'Gagal memuat daftar organisasi', '获取组织列表失败'],
  ['Organization name is required', 'Nama organisasi wajib diisi', '组织名称为必填项'],
  ['Failed to create organization', 'Gagal membuat organisasi', '创建组织失败'],
  ['Organization not found', 'Organisasi tidak ditemukan', '未找到组织'],
  ['Organization updated', 'Organisasi diperbarui', '组织已更新'],
  ['Failed to update organization', 'Gagal memperbarui organisasi', '更新组织失败'],
  ['Active organization set to {0}', 'Organisasi aktif diubah ke {0}', '当前组织已设为 {0}'],
  ['Failed to set active organization', 'Gagal mengatur organisasi aktif', '设置当前组织失败'],
  ['The only remaining organization cannot be deleted', 'Tidak dapat menghapus satu-satunya organisasi yang tersisa', '无法删除仅剩的组织'],
  ['The system default organization cannot be deleted', 'Organisasi default sistem tidak dapat dihapus', '系统默认组织无法删除'],
  ['Organization deleted successfully', 'Organisasi berhasil dihapus', '组织已成功删除'],
  ['Failed to delete organization', 'Gagal menghapus organisasi', '删除组织失败'],
  ['Failed to list teams', 'Gagal memuat daftar tim', '获取团队列表失败'],
  ['Team / department name is required', 'Nama tim / departemen wajib diisi', '团队 / 部门名称为必填项'],
  ['Failed to create team', 'Gagal membuat tim', '创建团队失败'],
  ['Team / department name is required.', 'Nama tim / departemen wajib diisi.', '团队 / 部门名称为必填项。'],
  ['Team / department not found.', 'Tim / departemen tidak ditemukan.', '未找到团队 / 部门。'],
  ['Failed to update department', 'Gagal memperbarui departemen', '更新部门失败'],
  ['Team deleted', 'Tim dihapus', '团队已删除'],
  ['Failed to delete team', 'Gagal menghapus tim', '删除团队失败'],
  ['Member added to team', 'Anggota ditambahkan ke tim', '成员已添加到团队'],
  ['Failed to add team member', 'Gagal menambahkan anggota tim', '添加团队成员失败'],
  ['Member removed from team', 'Anggota dikeluarkan dari tim', '成员已移出团队'],
  ['Failed to remove team member', 'Gagal mengeluarkan anggota tim', '移除团队成员失败'],
  ['Failed to list invitations', 'Gagal memuat daftar undangan', '获取邀请列表失败'],
  ['The official invitation email was sent straight to {0}\'s inbox via the SMTP relay ({1}).', 'Email undangan resmi telah sukses dikirim langsung ke inbox {0} via SMTP Relay ({1}).', '正式邀请邮件已通过 SMTP 中继（{1}）直接发送至 {0} 的收件箱。'],
  ['The invitation was saved, but sending the email via the SMTP relay failed: {0}. Use the Copy Invitation Link button instead.', 'Undangan tersimpan, namun pengiriman email via SMTP Relay gagal: {0}. Gunakan tombol Salin Link Undangan sebagai alternatif.', '邀请已保存，但通过 SMTP 中继发送邮件失败：{0}。请改用“复制邀请链接”按钮。'],
  ['The invitation was recorded in the system. (Note: enable \'SMTP Relay Server\' in Settings so emails are sent automatically to {0}\'s inbox.)', 'Undangan berhasil dicatat resmi di sistem. (Catatan: Aktifkan \'SMTP Relay Server\' di menu Settings agar email otomatis langsung terkirim ke inbox {0}).', '邀请已在系统中登记。（注意：请在“设置”中启用“SMTP 中继服务器”，以便邮件自动发送至 {0} 的收件箱。）'],
  ['Email is required', 'Email wajib diisi', '邮箱为必填项'],
  ['Failed to create invitation', 'Gagal membuat undangan', '创建邀请失败'],
  ['The invitation was updated and resent.', 'Undangan berhasil diperbarui dan dikirim ulang.', '邀请已更新并重新发送。'],
  ['Failed to resend invitation', 'Gagal mengirim ulang undangan', '重新发送邀请失败'],
  ['Invitation code is required', 'Kode undangan wajib diisi', '邀请码为必填项'],
  ['Invitation code not found', 'Kode undangan tidak ditemukan', '未找到邀请码'],
  ['The invitation has expired', 'Undangan telah kadaluarsa', '邀请已过期'],
  ['This invitation has already been accepted', 'Undangan ini sudah pernah diterima sebelumnya', '此邀请此前已被接受'],
  ['Failed to verify the invitation', 'Gagal memverifikasi undangan', '验证邀请失败'],
  ['Invitation not found', 'Undangan tidak ditemukan', '未找到邀请'],
  ['This invitation has been accepted', 'Undangan ini sudah diterima', '此邀请已被接受'],
  ['Congratulations! You have joined the organization as {0}.', 'Selamat! Anda telah resmi bergabung ke organisasi sebagai {0}.', '恭喜！您已以 {0} 身份正式加入该组织。'],
  ['Failed to accept the invitation', 'Gagal menerima undangan', '接受邀请失败'],
  ['Invitation canceled', 'Undangan dibatalkan', '邀请已取消'],
  ['Failed to cancel invitation', 'Gagal membatalkan undangan', '取消邀请失败'],
  ['Failed to list API keys', 'Gagal memuat daftar API key', '获取 API 密钥列表失败'],
  ['API Key name is required', 'Nama API Key wajib diisi', 'API 密钥名称为必填项'],
  ['Failed to generate API key', 'Gagal membuat API key', '生成 API 密钥失败'],
  ['API key revoked successfully', 'API key berhasil dicabut', 'API 密钥已成功撤销'],
  ['Failed to revoke API key', 'Gagal mencabut API key', '撤销 API 密钥失败'],
  ['API key deleted successfully', 'API key berhasil dihapus', 'API 密钥已成功删除'],
  ['Failed to delete API key', 'Gagal menghapus API key', '删除 API 密钥失败'],
  ['Failed to fetch RBAC matrix', 'Gagal memuat matriks RBAC', '获取 RBAC 矩阵失败'],
  ['Failed to fetch SQLite status', 'Gagal memuat status SQLite', '获取 SQLite 状态失败'],
  ['Failed to fetch SQLite tables', 'Gagal memuat tabel SQLite', '获取 SQLite 数据表失败'],
  ['Invalid table name', 'Nama tabel tidak valid', '无效的数据表名称'],
  ['Table not found', 'Tabel tidak ditemukan', '未找到数据表'],
  ['Failed to fetch SQLite table data', 'Gagal memuat data tabel SQLite', '获取 SQLite 数据表内容失败'],
  ['Database optimized successfully', 'Database berhasil dioptimalkan', '数据库已成功优化'],
  ['Failed to optimize SQLite database', 'Gagal mengoptimalkan database SQLite', '优化 SQLite 数据库失败'],
  ['Document not found.', 'Dokumen tidak ditemukan.', '未找到文档。'],
  ['Document name is required.', 'Nama dokumen wajib diisi.', '文档名称为必填项。'],
  ['Invalid status.', 'Status tidak valid.', '无效的状态。'],
  ['Invalid type.', 'Jenis tidak valid.', '无效的类型。'],
  ['Version not found.', 'Versi tidak ditemukan.', '未找到版本。'],
  ['Content is required.', 'Konten wajib diisi.', '内容为必填项。'],
  ['Only administrators can manage metadata fields.', 'Hanya administrator yang dapat mengelola kolom metadata.', '只有管理员可以管理元数据字段。'],
  ['Field name is required.', 'Nama kolom wajib diisi.', '字段名称为必填项。'],
  ['Invalid field type.', 'Tipe kolom tidak valid.', '无效的字段类型。'],
  ['Select fields need at least one option.', 'Kolom pilihan membutuhkan minimal satu opsi.', '选择字段至少需要一个选项。'],
  ['Field not found.', 'Kolom tidak ditemukan.', '未找到字段。'],
  ['Values are required.', 'Nilai wajib diisi.', '必须提供值。'],
  ['Unknown field: {0}', 'Kolom tidak dikenal: {0}', '未知字段：{0}'],
  ['Invalid option for {0}.', 'Opsi tidak valid untuk {0}.', '{0} 的选项无效。'],
  ['Invalid date for {0}.', 'Tanggal tidak valid untuk {0}.', '{0} 的日期无效。'],
  ['Replies must target a top-level comment.', 'Balasan harus ditujukan ke komentar utama.', '回复必须针对顶级评论。'],
  ['Comment text is required.', 'Teks komentar wajib diisi.', '评论内容为必填项。'],
  ['A suggestion needs selected text.', 'Usulan membutuhkan teks yang dipilih.', '建议需要先选择文本。'],
  ['Unknown action.', 'Aksi tidak dikenal.', '未知操作。'],
  ['Comment not found.', 'Komentar tidak ditemukan.', '未找到评论。'],
  ['Cannot {0} a {1} {2}.', 'Tidak dapat melakukan {0} pada {2} berstatus {1}.', '无法对状态为 {1} 的{2}执行 {0}。'],
  ['Only a superuser can manage Google credentials.', 'Hanya superuser yang dapat mengelola kredensial Google.', '只有超级用户可以管理 Google 凭据。'],
  ['Only a superuser can manage file storage.', 'Hanya superuser yang dapat mengelola penyimpanan file.', '只有超级用户可以管理文件存储。'],
  ['Unknown credential kind.', 'Jenis kredensial tidak dikenal.', '未知的凭据类型。'],
  ['RBAC: non-superuser actor without tenantId (scope required).', 'RBAC: actor non-superuser tanpa tenantId (scope wajib).', 'RBAC：非超级用户操作者缺少 tenantId（必须指定范围）。'],
  ['RBAC: department-scoped actor without departmentId.', 'RBAC: actor ber-scope departemen tanpa departmentId.', 'RBAC：部门范围的操作者缺少 departmentId。'],
  ['You do not have permission to perform this action.', 'Anda tidak memiliki izin untuk melakukan tindakan ini.', '您无权执行此操作。'],
  ['You cannot assign a role equal to or higher than your own.', 'Anda tidak dapat memberikan peran yang setara atau lebih tinggi dari peran Anda.', '您不能分配等于或高于您自身的角色。'],
  ['The resource is outside your assigned tenant.', 'Sumber daya berada di luar tenant Anda.', '该资源不在您所属的租户范围内。'],
  ['The resource is outside your assigned department.', 'Sumber daya berada di luar departemen Anda.', '该资源不在您所属的部门范围内。'],
  ['The resource is outside your permitted scope.', 'Sumber daya berada di luar cakupan izin Anda.', '该资源超出您的权限范围。'],
  ['You cannot change your own role.', 'Anda tidak dapat mengubah peran Anda sendiri.', '您不能更改自己的角色。'],
  ['permission is required.', 'permission wajib diisi.', 'permission 为必填项。'],
];

const LANG_INDEX: Record<Lang, number> = { EN: 0, ID: 1, ZH: 2 };
const exact = new Map<string, Entry>();
const patterns: Array<{ re: RegExp; entry: Entry }> = [];
for (const entry of MESSAGES) {
  for (const source of [entry[0], entry[1]]) {
    if (!/\{\d\}/.test(source)) exact.set(source, entry);
    else {
      const body = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\d\\\}/g, '([\\s\\S]*?)');
      patterns.push({ re: new RegExp(`^${body}$`), entry });
    }
  }
}

export function translateServerMessage(text: string, lang: Lang, depth = 0): string {
  const hit = exact.get(text);
  if (hit) return hit[LANG_INDEX[lang]];
  if (depth > 1) return text;
  for (const { re, entry } of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const values = m.slice(1).map((v) => translateServerMessage(v, lang, depth + 1));
    return entry[LANG_INDEX[lang]].replace(/\{(\d)\}/g, (_, i) => values[Number(i)] ?? '');
  }
  return text;
}

const FIELDS = ['error', 'message', 'details', 'warning', 'hint', 'reason'];

function localizeFields(value: unknown, lang: Lang): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of FIELDS) {
    const v = out[field];
    if (typeof v === 'string') out[field] = translateServerMessage(v, lang);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[field] = localizeFields(v, lang);
  }
  return out;
}

/** Top-level message fields, plus per-row messages in arrays such as bulk-import results. */
function localizeBody(body: unknown, lang: Lang): unknown {
  const out = localizeFields(body, lang);
  if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
  const record = out as Record<string, unknown>;
  for (const [key, v] of Object.entries(record)) {
    if (Array.isArray(v) && v.length && v.length <= 1000 && v.every((row) => row && typeof row === 'object' && !Array.isArray(row) && FIELDS.some((f) => f in row))) {
      record[key] = v.map((row) => localizeFields(row, lang));
    }
  }
  return record;
}

export function localizeApiMessages(req: Request, res: Response, next: NextFunction) {
  const header = String(req.get('x-app-language') || 'EN').toUpperCase();
  const lang: Lang = header === 'ID' || header === 'ZH' ? header : 'EN';
  const json = res.json.bind(res);
  res.json = (body?: unknown) => json(localizeBody(body, lang));
  next();
}
