# Legalio Global Open-Source CLM
## Product Requirements Document

**Status:** Draft for architecture and implementation planning  
**Version:** 1.0  
**Owner:** Product and Architecture  
**Target release:** Phased public OSS release  
**Primary audience:** Product, Engineering, Security, Legal, DevOps, and community contributors

---

## 1. Visi Produk Open-Source dan Nilai Utama

### 1.1 Vision

Legalio menjadi platform Contract Lifecycle Management (CLM) open-source yang modular, extensible, privacy-aware, dan dapat digunakan oleh organisasi lintas negara serta lintas industri. Produk harus memisahkan **core contract capability** dari aturan negara, industri, provider, dan kebijakan internal organisasi.

Legalio bukan sekadar repository dokumen. Legalio adalah system of record untuk:

- siklus hidup kontrak dari request sampai renewal atau termination;
- hubungan legal dan operasional dengan vendor, partner, customer, dan pihak ketiga;
- compliance evidence dan due diligence yang dapat dikonfigurasi;
- approval, delegation, obligation, dan audit trail;
- integrasi ke ERP, CRM, identity provider, e-signature, storage, dan notification provider.

### 1.2 Positioning

Legalio diposisikan sebagai:

> **An open, self-hostable, workflow-first CLM platform for organizations that need control over their contract data, policies, and integrations.**

Diferensiasi utama:

1. **Open and self-hostable:** deployment on-premise, private cloud, atau managed hosting tanpa vendor lock-in pada storage, e-signature, atau identity provider.
2. **Policy configurable:** compliance form, workflow, role, approval threshold, dan jurisdiction bukan hardcode per negara.
3. **Integration-first:** API, webhook, event model, dan adapter contract adalah fitur inti.
4. **Multi-entity by design:** mendukung group perusahaan, subsidiary, business unit, department, dan external party dengan isolasi data yang jelas.
5. **Human-reviewable automation:** AI membantu ekstraksi dan analisis, tetapi keputusan legal, approval, dan perubahan dokumen tetap dapat diaudit dan dikendalikan manusia.

### 1.3 Nilai Utama

| Nilai | Arti produk | Ukuran keberhasilan |
|---|---|---|
| Control | Organisasi mengontrol data, policy, dan deployment | Tidak ada dependency wajib pada provider proprietary |
| Flexibility | Admin dapat mengonfigurasi field dan workflow | Perubahan policy umum tidak memerlukan deploy code |
| Trust | Semua keputusan penting dapat ditelusuri | Audit trail immutable dan exportable |
| Interoperability | Data dapat keluar dan masuk melalui API/event | Integrasi menggunakan adapter resmi atau community plugin |
| Usability | Legal dan non-legal dapat menyelesaikan tugas tanpa training panjang | Task completion dan error rate terukur |
| Privacy | Data residency dan minimisasi data didukung sejak desain | PII inventory, retention, dan access log tersedia |

### 1.4 Target Persona

#### Legal Counsel / Contract Manager

Membuat template, meninjau redline, mengelola klausul, menyetujui pengecualian, memantau kewajiban, dan menyiapkan audit evidence.

#### Procurement / Vendor Manager

Memulai onboarding supplier, mengumpulkan dokumen, mengelola negotiation package, memantau renewal, dan memastikan vendor memenuhi policy.

#### Finance Operations

Memvalidasi nilai, currency, payment term, budget, invoice reference, obligation finansial, dan approval threshold.

#### Business Owner / Requester

Meminta kontrak atau IO, mengisi data bisnis, memberi konteks, dan mengikuti status approval tanpa harus memahami detail legal.

#### External Vendor / Counterparty

Mengisi form onboarding, mengunggah dokumen, meninjau dan menandatangani kontrak, serta melihat task yang ditujukan kepadanya.

#### System Administrator / DevOps

Mengelola tenant, identity, deployment, storage, backup, observability, migration, secret, dan integrasi.

#### Developer / Community Maintainer

Membuat plugin, adapter, connector, custom field type, workflow action, atau perbaikan core melalui kontrak kontribusi yang terdokumentasi.

---

## 2. Analisis Kesenjangan dan Keterikatan Lokal

### 2.1 Prinsip Analisis

Data dan perilaku yang berbeda antar negara atau industri harus dipindahkan dari core ke salah satu bentuk berikut:

- **configuration:** nilai atau aturan yang dapat diubah admin;
- **policy pack:** paket konfigurasi versioned untuk negara/industri tertentu;
- **adapter:** integrasi ke provider atau registry eksternal;
- **plugin:** capability tambahan yang tidak diperlukan semua deployment;
- **custom code boundary:** extension point yang stabil bila konfigurasi tidak cukup.

Core tidak boleh bergantung pada nilai Indonesia, IDR, WIB, NIK, NPWP, NIB, OJK, atau terminology iklan.

### 2.2 Due Diligence dan Vendor Onboarding

| Kondisi saat ini | Risiko generalisasi | Target global |
|---|---|---|
| Field identitas dan legalitas berasumsi NIK, NPWP, NIB, atau dokumen Indonesia | Tidak cocok untuk entity asing, individual contractor, nonprofit, atau healthcare provider | Dynamic form schema dengan field type, validation, visibility, evidence, dan retention policy |
| Status due diligence menggunakan label tetap seperti `Lengkap` atau `Belum Lengkap` | Status tidak cukup untuk proses KYC/KYB dengan banyak tahap dan reviewer | Configurable state machine: Draft, Invited, In Review, Remediation, Approved, Rejected, Expired, Suspended |
| Kategori partner dan document checklist tertanam di data seed | Policy per industri dan negara tidak dapat berbeda antar tenant | Versioned compliance policy pack per tenant, entity, jurisdiction, dan risk tier |
| Struktur PIC dan badan hukum mengikuti praktik Indonesia | Tidak merepresentasikan branch, trust, government entity, sole proprietor, atau beneficial owner | Universal party/entity model dengan relationship graph |
| Dokumen disimpan dengan asumsi folder Google Drive | Sulit memakai S3, Azure Blob, local filesystem, atau DMS lain | Storage abstraction dengan object metadata, retention, encryption, and provider adapters |

### 2.3 Kontrak dan Insertion Order

| Kondisi saat ini | Risiko | Target global |
|---|---|---|
| IDR menjadi asumsi default | Nilai dan reporting tidak portable | ISO 4217 currency code, minor units, FX source, rate timestamp, dan rounding policy |
| Tanggal dan waktu dapat bergantung pada locale Indonesia | Risiko salah tanggal, expiry, dan deadline | UTC storage, ISO 8601 API, explicit display timezone per user/tenant |
| IO diperlakukan sebagai workflow komersial lokal/periklanan | Tidak cocok untuk procurement, SaaS order form, statement of work, atau healthcare engagement | `CommercialDocument` dengan document type configurable; IO hanya salah satu type profile |
| Klausul dan hukum Indonesia menjadi asumsi implisit | Tidak dapat dipakai lintas yurisdiksi | Governing law, jurisdiction, language, clause library, dan policy sebagai metadata/configuration |
| Approval flow memiliki asumsi role tertentu | Tidak cocok untuk matrix approval atau delegation global | Workflow engine dengan condition, threshold, quorum, delegation, SLA, dan escalation |
| DOCX/PDF adalah format utama | Tidak cukup untuk e-sign, structured extraction, atau long-term archive | Canonical contract model + source/rendered artifacts + signed evidence package |

### 2.4 Organization dan User Management

| Kondisi saat ini | Risiko | Target global |
|---|---|---|
| Role dan department tertentu diasumsikan | Organisasi dengan matrix, region, subsidiary, atau project team tidak terwakili | Subject, organization, entity, team, group, role, permission, dan policy terpisah |
| Format nomor telepon dan alamat lokal | Validasi gagal untuk user global | E.164 phone, locale-aware address component, optional fields, dan configurable validation |
| Tenant dan organization memiliki pemaknaan yang bercampur | Risiko kebocoran antar subsidiary atau group | Hierarchical entity model dan explicit data boundary |
| Role fixed: Superuser/Admin/Manager/Editor/Viewer | Tidak cukup untuk industri atau deployment berbeda | Built-in role presets plus custom roles dan scoped permissions |
| Approval berorientasi satu organisasi | Tidak mendukung counterparty, joint venture, atau shared services | Multi-party workflow dengan internal dan external principals |

### 2.5 Integrasi dan Runtime

| Area | Coupling yang harus dihapus |
|---|---|
| Google Drive | Semua storage operation harus melalui `DocumentStorageAdapter` |
| Google Sheets | Sinkronisasi harus melalui connector/event consumer, bukan source of truth |
| Gemini | AI provider harus melalui `AIProviderAdapter` dengan feature flag dan redaction |
| Better Auth | Identity harus dibungkus `IdentityProvider` agar OIDC/SAML/LDAP dapat ditambahkan |
| SQLite | Persistence layer harus memiliki repository boundary dan migration contract |
| Email | Nodemailer bukan core contract; gunakan `NotificationAdapter` |
| Brand dan language | UI string, currency, timezone, dan date format harus berasal dari i18n/l10n service |

---

## 3. Spesifikasi Kebutuhan Generalisasi

### 3.1 Arsitektur Domain Target

Domain model minimum:

- `Tenant`: boundary deployment atau customer account.
- `OrganizationEntity`: parent company, subsidiary, branch, business unit, atau legal entity.
- `Party`: individual, company, government entity, nonprofit, atau other counterparty.
- `PartyRelationship`: ownership, representative, beneficiary, parent, subsidiary, contact, or signer.
- `UserIdentity`: identity provider subject yang dapat memiliki membership di beberapa tenant/entity.
- `Membership`: hubungan user terhadap tenant, entity, team, atau role.
- `Contract`: canonical contract record dan lifecycle metadata.
- `ContractVersion`: immutable version/artifact reference untuk setiap perubahan formal.
- `CommercialDocument`: type profile untuk IO, order form, SOW, quote, amendment, atau statement.
- `Obligation`: kewajiban, owner, due date, recurrence, evidence, dan escalation.
- `WorkflowDefinition`: konfigurasi state, transition, guard, action, SLA, dan approval.
- `WorkflowInstance`: eksekusi workflow untuk satu domain object.
- `Evidence`: file, URL, API snapshot, signature certificate, atau review note.
- `PolicyDefinition`: rules, form schema, retention, risk, dan jurisdiction.
- `AuditEvent`: event append-only dengan actor, subject, action, object, scope, time, and trace ID.

Semua entity wajib memiliki:

- stable opaque ID, bukan ID yang mengandung makna negara atau bisnis;
- `createdAt` dan `updatedAt` dalam UTC ISO 8601;
- `tenantId` dan, bila relevan, `organizationEntityId`;
- version atau revision metadata;
- audit reference;
- soft-delete/archive semantics yang jelas.

### 3.2 Due Diligence dan Vendor Management

#### 3.2.1 Dynamic Form Builder

Admin harus dapat membuat dan publish form version tanpa perubahan source code untuk use case KYC, KYB, supplier onboarding, data processing assessment, information security review, atau clinical vendor review.

Field type minimum:

- short text, long text, rich text;
- integer, decimal, money, percentage;
- date, datetime, duration;
- country, region, language, currency, timezone;
- email, phone E.164, URL;
- single select, multi-select, radio, checkbox;
- party/entity selector;
- file upload dan evidence reference;
- repeatable group dan nested object;
- calculated/read-only field;
- consent and attestation field.

Setiap field mendukung:

- stable key dan display label per locale;
- required/optional conditionality;
- validation rule dan error message per locale;
- visibility rule berbasis answer, risk tier, country, entity type, atau role;
- sensitivity classification: public, internal, confidential, restricted, special category;
- source: user input, imported, connector, or calculated;
- retention and deletion policy;
- evidence requirement;
- schema version dan migration mapping.

#### 3.2.2 Universal Entity and Tax Identity

Gunakan model `Identifier`:

```json
{
  "type": "tax_id",
  "scheme": "EIN",
  "value": "redacted-or-encrypted",
  "issuingCountry": "US",
  "validFrom": "2025-01-01",
  "validTo": null,
  "verification": "unverified"
}
```

`scheme` dapat memuat EIN, VAT, GST, ABN, PAN, TIN, national registration, LEI, atau custom scheme. Core tidak melakukan validasi format keras kecuali melalui validator policy pack.

Risk and review requirements:

- configurable risk scoring dengan explainable factors;
- manual override wajib menyimpan reason dan approver;
- adverse media/PEP/sanction result disimpan sebagai provider evidence, bukan asumsi core;
- re-screening schedule dan expiry;
- remediation task dengan owner, due date, comment, dan evidence;
- approval dapat mensyaratkan dual control.

#### 3.2.3 Vendor Lifecycle

State default yang dapat diubah:

`Draft -> Invited -> Submitted -> In Review -> Remediation -> Approved -> Active -> Suspended -> Expired -> Rejected -> Archived`

Transition harus dikontrol oleh policy, role, required evidence, risk threshold, dan workflow.

### 3.3 Contract Lifecycle dan Commercial Documents

#### 3.3.1 Lifecycle Minimum

Default lifecycle:

`Intake -> Drafting -> Internal Review -> Business Approval -> Legal Approval -> Counterparty Review -> Signature Pending -> Executed -> Active -> Renewal Review -> Renewed / Expired / Terminated -> Archived`

Tenant dapat menambah state, mengubah label, mengatur transition, atau menggunakan lifecycle berbeda untuk NDA, MSA, SOW, DPA, lease, order form, atau amendment.

#### 3.3.2 Workflow and State Machine Engine

Engine harus mendukung:

- state dan transition versioned;
- role, group, entity, atau named user sebagai assignee;
- sequential, parallel, quorum, and conditional approval;
- condition berdasarkan value, currency, entity, risk, clause deviation, jurisdiction, atau metadata;
- approval threshold dan multi-currency normalization;
- delegation dengan tanggal mulai/akhir;
- SLA, reminder, escalation, pause, resume, dan cancellation;
- retry dan idempotency untuk action eksternal;
- human task dan service task;
- dry-run/validation sebelum workflow dipublish;
- immutable execution log;
- permission check pada setiap transition, bukan hanya pada UI.

Workflow definition sebaiknya disimpan sebagai JSON Schema-validated document, dengan UI builder sebagai salah satu client.

#### 3.3.3 Contract Data and Versioning

- Pisahkan metadata kontrak, structured terms, document artifact, dan signed evidence.
- Setiap formal revision memiliki immutable `ContractVersion`.
- Redline harus dapat dibandingkan antar versi.
- Template dan clause library harus versioned.
- Clause deviation wajib menyimpan baseline, perubahan, reason, risk classification, dan approver.
- Dokumen hasil render harus dapat direproduksi dari version dan template metadata.
- Export tidak boleh mengubah canonical record.

#### 3.3.4 E-Signature Abstraction

Definisikan `ESignatureAdapter` dengan capability discovery:

```ts
interface ESignatureAdapter {
  createEnvelope(input: SignatureRequest): Promise<SignatureEnvelope>;
  sendEnvelope(envelopeId: string): Promise<void>;
  getEnvelope(envelopeId: string): Promise<SignatureStatus>;
  voidEnvelope(envelopeId: string, reason?: string): Promise<void>;
  downloadEvidence(envelopeId: string): Promise<EvidencePackage>;
  verifyWebhook(request: unknown): VerifiedSignatureEvent;
}
```

Adapter target:

- DocuSign;
- PandaDoc;
- Adobe Acrobat Sign;
- open-source/self-hosted provider;
- internal/manual signing adapter untuk development dan fallback.

Core wajib menyimpan envelope ID, provider, recipient mapping, status mapping, hash artifact, timestamp, dan evidence package. Provider-specific status tidak boleh menyebar ke domain core.

#### 3.3.5 Multi-Currency dan Multi-Timezone

- Simpan currency menggunakan ISO 4217.
- Jangan menyimpan nilai uang sebagai floating point; gunakan integer minor unit atau decimal library.
- Simpan original amount dan currency.
- Bila reporting membutuhkan conversion, simpan target currency, rate, source, timestamp, dan conversion policy.
- Simpan semua timestamp dalam UTC.
- Gunakan ISO 8601 untuk API dan event.
- User, tenant, dan document dapat memiliki display timezone yang berbeda.
- Fiscal calendar, weekend, holiday, dan working hours harus configurable per locale/entity.

### 3.4 Security, Organization, dan RBAC

#### 3.4.1 Multi-Tenancy dan Entity Isolation

Isolation wajib berlaku pada:

- database query;
- object storage path dan access policy;
- cache key;
- search index;
- event dan webhook;
- audit log;
- export dan background job;
- AI prompt/context;
- observability attribute yang dapat memuat data tenant.

Deployment dapat memilih:

1. shared database dengan tenant key dan enforcement;
2. schema-per-tenant;
3. database-per-tenant untuk kebutuhan residency atau isolation tinggi.

Persistence layer harus menyembunyikan pilihan ini dari domain service.

#### 3.4.2 Granular Permission

Permission memakai format `resource.action`, misalnya:

- `contract.read`, `contract.create`, `contract.update`, `contract.delete`, `contract.approve`, `contract.export`;
- `party.read`, `party.manage`, `party.invite`;
- `workflow.read`, `workflow.manage`, `workflow.execute`;
- `evidence.read`, `evidence.upload`, `evidence.delete`;
- `admin.user.manage`, `admin.policy.manage`, `admin.integration.manage`;
- `audit.read`, `audit.export`.

RBAC harus dapat dikombinasikan dengan:

- organization/entity scope;
- department/team scope;
- object ownership;
- attribute-based policy;
- time-bound access;
- break-glass access dengan reason dan elevated audit.

Built-in role hanya preset. Tenant dapat membuat custom role yang harus tervalidasi terhadap permission catalog dan policy guard.

#### 3.4.3 Identity

Target identity adapter:

- email/password untuk local development;
- OIDC/OAuth2;
- SAML 2.0;
- LDAP/Active Directory melalui adapter;
- SCIM 2.0 provisioning;
- MFA dan step-up authentication;
- service account dan API token dengan scope.

---

## 4. Arsitektur Ekstensibilitas dan Plugin

### 4.1 Batas Modul

Core domain harus dipisahkan dari adapter menggunakan interface yang stabil:

- `IdentityProviderAdapter`
- `DocumentStorageAdapter`
- `ESignatureAdapter`
- `NotificationAdapter`
- `AIProviderAdapter`
- `ERPConnectorAdapter`
- `CRMConnectorAdapter`
- `TaxIdentifierValidator`
- `RiskScreeningProvider`
- `ExchangeRateProvider`
- `SearchIndexAdapter`

Adapter tidak boleh memanggil database domain secara langsung. Komunikasi melalui application service, command, query, atau event.

### 4.2 Decoupling Logika Lokal Indonesia

Logika lokal harus dipindahkan sebagai paket opsional, misalnya:

```text
plugins/
  indonesia-fintech/
    policy-pack.json
    validators/
    form-templates/
    workflow-templates/
    README.md
```

Contoh isi policy pack:

- field schema NPWP/NIB/NIK;
- document checklist lokal;
- OJK-related workflow atau risk rule;
- IDR currency defaults;
- Indonesia timezone and holiday calendar;
- Bahasa Indonesia translations;
- local governing law options.

Tidak boleh ada import dari core ke plugin Indonesia. Core hanya mengenal generic `PolicyPack` dan registry.

### 4.3 Plugin Contract

Setiap plugin wajib mendefinisikan:

- plugin ID, version, compatibility range;
- capabilities yang disediakan;
- required permissions;
- configuration schema;
- database migration dan rollback policy;
- event subscriptions;
- secrets yang diperlukan;
- data residency/processing declaration;
- health check;
- documentation dan test fixture.

Untuk instalasi aman, plugin harus:

- di-sign atau diverifikasi checksum-nya;
- memiliki permission manifest;
- tidak mendapat akses tenant di luar scope;
- tidak mengeksekusi arbitrary migration tanpa approval;
- mencatat semua external call dan error.

### 4.4 REST, GraphQL, Webhook, dan Event

REST API adalah kontrak baseline. GraphQL boleh disediakan sebagai read/query layer setelah authorization enforcement yang sama.

API requirement:

- versioned path atau media type;
- OpenAPI document yang di-generate dan divalidasi di CI;
- pagination, filter, sort, field selection;
- idempotency key untuk command/mutation;
- optimistic concurrency melalui version atau ETag;
- standard error envelope dengan correlation ID;
- tenant scope tidak boleh hanya berasal dari payload client;
- rate limit dan abuse protection;
- webhook signing, replay protection, retry, dan dead-letter handling.

Event minimum:

- `contract.created`, `contract.state.changed`, `contract.executed`, `contract.renewal.due`;
- `party.created`, `party.review.required`, `party.approved`, `party.suspended`;
- `workflow.task.created`, `workflow.task.completed`, `workflow.failed`;
- `evidence.uploaded`, `evidence.expired`;
- `user.membership.changed`, `policy.published`.

Connector reference:

- SAP procurement/finance;
- Salesforce;
- HubSpot;
- ServiceNow;
- Jira;
- Slack/Teams;
- object storage dan data warehouse.

### 4.5 Background Jobs

Job runner harus memiliki queue abstraction untuk:

- document parsing;
- rendering/export;
- notification;
- signature polling;
- webhook retry;
- renewal reminder;
- search indexing;
- data retention purge;
- connector synchronization.

Setiap job wajib idempotent, tenant-aware, observable, retryable, dan memiliki dead-letter path.

---

## 5. Non-Functional Requirements dan Kesiapan Open-Source

### 5.1 Privacy dan Compliance

Legalio harus menyediakan privacy-by-design capability, bukan mengklaim sertifikasi secara otomatis.

Requirement minimum:

- data inventory dan classification;
- purpose dan lawful basis metadata bila diperlukan;
- configurable retention dan legal hold;
- export subject data;
- correction dan deletion workflow;
- consent/attestation evidence;
- processor/subprocessor registry untuk integration;
- data residency policy per tenant;
- encryption in transit dan at rest;
- field-level encryption untuk PII, tax ID, bank data, dan special category;
- key management abstraction, rotasi key, dan key access audit;
- tenant-specific encryption key opsional;
- access log untuk restricted data;
- redact sensitive fields dari log, telemetry, AI prompt, dan error message;
- backup encryption dan restore test.

Target compliance mapping:

- GDPR principles: purpose limitation, minimization, accuracy, storage limitation, integrity/confidentiality, accountability;
- SOC 2 control mapping sebagai implementation guide;
- ISO 27001 control mapping sebagai optional documentation;
- regional privacy policy pack tanpa memasukkan hukum lokal ke core.

### 5.2 Security Engineering

- Threat model untuk auth, tenant isolation, file upload, webhook, plugin, AI, dan export.
- Secure default configuration.
- Dependency scanning, SAST, secret scanning, dan container scanning di CI.
- CSRF, SSRF, path traversal, malware scanning, content type validation, dan size limit untuk upload.
- Rate limiting untuk auth dan public API.
- Short-lived token dan rotation untuk service integration.
- Audit trail append-only dengan tamper-evident strategy.
- Security advisory process dan responsible disclosure policy.

### 5.3 Performance dan Reliability

Baseline target production, dituning setelah benchmark:

| Area | Target awal |
|---|---:|
| API p95 read pada dataset normal | <= 400 ms |
| API p95 command tanpa external provider | <= 800 ms |
| UI initial load authenticated | <= 2.5 s pada target network |
| Availability core API | 99.9% untuk managed deployment |
| RPO | configurable, default <= 24 jam |
| RTO | configurable, default <= 4 jam |
| Background job retry | exponential backoff dan dead-letter |

### 5.4 Deployment

Deployment reference harus tersedia untuk:

- local development dengan Docker Compose;
- single-node self-hosted;
- Kubernetes/Helm untuk skala lebih besar;
- managed PostgreSQL dan object storage;
- SQLite hanya untuk development atau small single-node deployment dengan batasan terdokumentasi.

Container requirement:

- image non-root;
- health check dan readiness probe;
- graceful shutdown;
- migration command terpisah dari app startup untuk production;
- stateless application process;
- persistent storage hanya untuk database/object store;
- environment variable schema terdokumentasi;
- secrets tidak boleh masuk image atau Git.

### 5.5 Database dan Migration

Repository harus memiliki database abstraction minimal untuk PostgreSQL dan SQLite.

Migration requirement:

- numbered, idempotent, dan versioned;
- forward migration wajib diuji pada database kosong dan database upgrade;
- destructive migration memerlukan explicit flag dan backup check;
- seed/demo data tidak tercampur dengan migration production;
- migration status dapat dilihat melalui CLI/health endpoint;
- contract domain tidak mengandalkan JSON blob untuk query kritis jangka panjang;
- schema evolution untuk dynamic form memakai version dan migration mapping.

### 5.6 Developer Experience

Repository harus menyediakan:

```bash
npm install
cp .env.example .env
npm run dev
npm run lint
npm test
npm run build
```

Tambahan yang ditargetkan:

- `docker compose up` untuk dependency lokal;
- `make setup`, `make test`, atau equivalent cross-platform scripts;
- seed demo yang jelas dan disabled pada production;
- OpenAPI viewer;
- local webhook tunnel guide;
- sample plugin;
- generated types dari schema;
- test fixtures dan synthetic data tanpa PII nyata;
- troubleshooting guide untuk port, database, storage, dan provider credential.

### 5.7 Observability

- structured JSON logging;
- correlation ID dan trace ID;
- tenant/entity ID hanya bila tidak sensitif;
- metrics API latency, job latency, error rate, queue depth, webhook retry, storage failure;
- OpenTelemetry-compatible traces;
- health, readiness, liveness, dan dependency checks;
- audit event dipisahkan dari operational log.

### 5.8 Internationalization dan Localization

- UI text tidak boleh hardcode di component.
- Semua label, error, status, notification, dan email mendukung locale key.
- Initial locales: English dan Bahasa Indonesia.
- Format number/date/time/currency memakai locale runtime.
- Pluralization, timezone, first day of week, weekend, holiday, dan address format configurable.
- Document template dapat memiliki language variant dan fallback.

### 5.9 Open-Source Governance

Rekomendasi:

- License: Apache-2.0 untuk core agar permissive dan enterprise-friendly.
- Contributor License Agreement hanya bila benar-benar diperlukan dan disetujui community governance; prefer DCO untuk friction rendah.
- `CONTRIBUTING.md`: setup, architecture, coding style, tests, commit, PR, security.
- `CODE_OF_CONDUCT.md`.
- `SECURITY.md` dengan private disclosure channel.
- `CHANGELOG.md` dan semantic versioning.
- `GOVERNANCE.md`: maintainer, reviewer, decision process, release authority.
- `ARCHITECTURE.md` dan ADR directory.
- issue templates untuk bug, feature, security, plugin, dan documentation.
- compatibility matrix untuk database, Node/runtime, provider, dan plugin API.

Core, official plugins, dan community plugins harus memiliki ownership serta support expectation yang berbeda dan terdokumentasi.

---

## 6. Product and Engineering Acceptance Criteria

### 6.1 Generalization Gate

- Tidak ada default domain field yang mewajibkan NIK, NPWP, NIB, IDR, atau Indonesia timezone.
- Semua validasi country/industry-specific berasal dari policy pack atau plugin.
- Contract, party, evidence, dan workflow dapat dibuat tanpa Google, Gemini, atau provider e-sign.
- Storage adapter minimal local filesystem dan S3-compatible dapat dipilih.
- Identity adapter local development dapat diganti OIDC pada deployment.

### 6.2 Workflow Gate

- Product owner dapat membuat lifecycle baru tanpa mengubah TypeScript.
- Workflow dapat diuji dalam draft sebelum publish.
- Approval threshold bekerja dengan multi-currency policy.
- Semua transition unauthorized ditolak di server.
- Retry external action tidak membuat duplicate envelope atau duplicate event.

### 6.3 Tenant and Security Gate

- Automated test membuktikan tenant A tidak dapat membaca atau mengubah object tenant B.
- Export, search, background job, webhook, dan AI context memiliki tenant enforcement.
- Restricted field tidak muncul dalam log atau export tanpa permission.
- Break-glass access selalu memiliki reason, expiry, dan audit event.
- Security test mencakup upload, webhook signature, SSRF, IDOR, and privilege escalation.

### 6.4 Open-Source Release Gate

- Fresh clone berhasil dari documented steps.
- CI lulus lint, unit, integration, migration, build, dan security checks.
- Docker Compose menjalankan minimal core app dengan local database dan storage.
- Dokumentasi deployment dan upgrade dapat diikuti oleh contributor baru.
- Sample plugin dan API client dapat dijalankan tanpa secret production.
- Release artifact memiliki SBOM dan provenance yang terdokumentasi.

---

## 7. Roadmap Transformasi dan Milestone Rilis

### Phase 1 - Decoupling Local Logic dan Dynamic Custom Fields

**Tujuan:** membangun boundary domain global tanpa memutus kemampuan Legalio saat ini.

Deliverables:

1. Inventory seluruh local assumption di UI, API, schema, seed, export, dan prompt AI.
2. Universal Party, OrganizationEntity, Identifier, Money, DateTime, dan Evidence model.
3. Dynamic form schema, renderer, validator, versioning, dan basic admin builder.
4. Policy pack registry dengan Indonesia fintech sebagai plugin/fixture pertama.
5. Document storage adapter dan notification adapter.
6. Workflow engine minimum untuk state, transition, assignee, dan approval.
7. Tenant isolation test matrix.
8. Migration dari data `allowedUsers`, partner, contract, IO, dan data store lama.

Exit criteria:

- Dua use case non-Indonesia berjalan tanpa fork code.
- Due diligence form baru dapat dibuat tanpa deploy.
- Core tests tidak bergantung pada nilai IDR atau locale Indonesia.
- Existing Indonesian demo tetap dapat dijalankan sebagai policy pack.

### Phase 2 - Standardisasi i18n/l10n dan E-Signature Abstraction

**Tujuan:** menjadikan produk benar-benar usable oleh tenant global dan provider yang berbeda.

Deliverables:

1. i18n key catalog dan English/Indonesian locale.
2. UTC/ISO 8601 dan ISO 4217 end-to-end.
3. Timezone, locale, holiday, fiscal calendar, dan address abstraction.
4. ESignatureAdapter dengan manual/local adapter dan satu provider external.
5. ContractVersion, signed evidence package, dan webhook verification.
6. Configurable approval matrix, delegation, SLA, escalation, dan threshold.
7. OIDC baseline serta local email/password untuk development.
8. OpenAPI contract, webhook contract, idempotency, dan generated SDK.
9. PostgreSQL support dan production migration CLI.

Exit criteria:

- Kontrak multi-currency dan multi-timezone dapat dibuat, disetujui, ditandatangani, dan diaudit.
- Provider e-sign dapat diganti tanpa perubahan domain workflow.
- English deployment tidak menampilkan string atau format Indonesia yang tidak dikonfigurasi.
- PostgreSQL upgrade test dan backup/restore test lulus.

### Phase 3 - Public OSS Release dan Community Governance

**Tujuan:** merilis platform yang dapat dipasang, dikembangkan, dan dioperasikan komunitas.

Deliverables:

1. Public repository cleanup: no secret, no production data, no proprietary asset dependency.
2. Apache-2.0 license, DCO, governance, contribution, security, and conduct documents.
3. Docker Compose, container image, Helm chart, and deployment reference.
4. Public API docs, architecture docs, ADRs, plugin SDK, and sample connectors.
5. CI with tests, SAST, dependency/license scan, SBOM, and release automation.
6. Community issue triage, roadmap, release cadence, and compatibility policy.
7. Official adapters: S3-compatible storage, OIDC, local e-sign, one e-sign provider, email provider.
8. Data export/import and documented upgrade path.
9. Beta program with at least three distinct industry profiles.

Exit criteria:

- Contributor baru dapat menjalankan app dari clean checkout dalam waktu <= 15 menit dengan Docker.
- Tenant baru dapat dikonfigurasi tanpa mengubah core source.
- Public release memiliki reproducible build dan upgrade documentation.
- Security response process dan supported version policy aktif.

---

## 8. Delivery Workstreams

| Workstream | Pemilik | Output utama |
|---|---|---|
| Domain and data model | Architecture + Backend | universal entities, schema, migration |
| Workflow | Backend + Product | state machine, approvals, SLA |
| Compliance | Product + Legal advisors | policy pack contract, form builder |
| Frontend | Frontend + UX | dynamic renderer, workflow UI, i18n |
| Security | Security + Platform | threat model, isolation, encryption, audit |
| Integrations | Platform | adapter SDK, API, webhook, connectors |
| DevOps | Platform | containers, migrations, observability, release |
| Community | Maintainers | governance, docs, support, contributor flow |

Cross-workstream rule: perubahan domain contract harus melalui ADR dan compatibility review. Plugin tidak boleh menjadi alasan untuk memasukkan aturan provider ke core.

---

## 9. Risiko dan Keputusan yang Harus Ditutup

| Risiko / keputusan | Dampak | Keputusan yang disarankan |
|---|---|---|
| Dynamic form terlalu bebas | Data sulit dianalisis dan dimigrasi | Schema governance, typed fields, versioning, queryable projections |
| Workflow engine terlalu kompleks pada fase awal | Delivery lambat dan sulit dipelihara | Mulai dari state/transition/approval/SLA; tambah BPMN-like capability bertahap |
| Multi-database terlalu dini | Beban support tinggi | SQLite untuk dev, PostgreSQL untuk production pertama, adapter boundary sejak awal |
| Plugin arbitrary code | Security dan support risk | Manifest, sandbox/process boundary, official adapter API, allowlist |
| AI memproses PII | Privacy, residency, dan hallucination risk | explicit opt-in, redaction, provider policy, no autonomous legal decision |
| Backward compatibility data lokal | Migration failure dan user trust loss | read-only legacy import, dry-run report, reversible migration, export backup |
| Custom role terlalu permissive | Privilege escalation | permission catalog, deny guard, scope test, admin approval |
| Provider lock-in | Sulit migrasi | capability-based adapters, canonical evidence, exportable artifacts |

Keputusan product yang wajib dibuat sebelum Phase 2:

1. Apache-2.0 atau lisensi lain untuk core.
2. PostgreSQL sebagai production reference database.
3. Apakah GraphQL masuk core atau menjadi official plugin.
4. Provider e-sign pertama untuk official adapter.
5. Dukungan SAML/SCIM pada core atau enterprise/community adapter.
6. Model governance dan siapa yang menjadi initial maintainer.
7. Batas support untuk community plugin dan breaking changes.

---

## 10. Definition of Done untuk Setiap Modul

Sebuah capability dianggap selesai bila:

- domain model dan API contract terdokumentasi;
- UI dan server memiliki authorization yang konsisten;
- tenant/entity scope diuji positif dan negatif;
- locale, currency, timezone, dan retention behavior jelas;
- migration dan backward compatibility tersedia;
- audit event untuk aksi sensitif tersedia;
- loading, empty, error, dan retry state tersedia di UI;
- unit, integration, dan contract test tersedia;
- operational metrics dan health signal tersedia;
- dokumentasi user, admin, developer, dan contributor diperbarui;
- tidak ada provider atau aturan lokal yang bocor ke core tanpa adapter/policy boundary.

---

## Appendix A - Terminology

| Istilah | Definisi |
|---|---|
| Party | Pihak yang terlibat dalam kontrak, dapat berupa organisasi atau individu |
| Organization Entity | Unit legal atau operasional milik tenant |
| Counterparty | Party eksternal terhadap entity utama |
| Commercial Document | Dokumen komersial terstruktur seperti IO, SOW, order form, atau quote |
| Policy Pack | Paket konfigurasi versioned untuk negara, industri, atau customer policy |
| Adapter | Implementasi interface untuk provider/infrastruktur eksternal |
| Plugin | Paket extension yang menambahkan capability, policy, connector, atau UI |
| Evidence | Bukti terstruktur atau artifact yang mendukung keputusan/proses |
| Workflow Definition | Blueprint lifecycle dan rule yang dapat dipublish |
| Workflow Instance | Eksekusi konkret sebuah workflow terhadap domain object |
| Data Residency | Lokasi dan boundary pemrosesan/penyimpanan data tenant |

## Appendix B - Referensi Implementasi Saat Ini

Dokumen ini digeneralisasi dari capability Legalio yang saat ini mencakup:

- React/Vite frontend dan Express backend;
- Better Auth dan SQLite untuk local runtime;
- custom RBAC tenant/department scope;
- contract, partner, IO, spending, evaluation, notification, dan audit workflow;
- TipTap contract editor dan DOCX export;
- Google Drive/Sheets dan Firebase Google Sign-In;
- Gemini-assisted parsing, DD notes, redline analysis, dan news ticker.

Referensi implementasi harus diperlakukan sebagai baseline migrasi, bukan batas arsitektur target. Setiap dependency provider-specific harus dipindahkan ke adapter atau plugin sesuai roadmap di atas.
