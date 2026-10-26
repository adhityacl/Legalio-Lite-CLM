/**
 * Weights and red flags for the contract risk engine (contractRiskEngine.ts), per industry pack and, for P2P lending, per kind
 * of partnership. Source: the Legalio "AI Contract Redlining" scoring reference (5 pillars, 29 industries).
 *
 * Pillars: P1 financial, pricing/commission formulas and tax; P2 liability, indemnity and IP; P3 sector regulation, data
 * privacy and audit; P4 operations, SLA and exit mechanics; P5 drafting precision, cross-references, bilingual text and
 * metadata sync. Weights of an entry sum to 1.
 */
export const PILLARS = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export type Pillar = (typeof PILLARS)[number];
export type PillarWeights = Record<Pillar, number>;

export const PILLAR_NAMES: Record<Pillar, string> = {
  P1: 'Financial, pricing / commission formulas and tax',
  P2: 'Liability, risk allocation, indemnity and IP',
  P3: 'Sector regulation, data privacy and audit limits',
  P4: 'Operations, SLA, supply and termination mechanics',
  P5: 'Drafting precision, cross-references, bilingual text and metadata sync',
};

const w = (P1: number, P2: number, P3: number, P4: number, P5: number): PillarWeights => ({ P1, P2, P3, P4, P5 });

interface IndustryRisk { weights: PillarWeights; redFlags: string[] }

/** A P2P relationship type with its own weights and scope; chosen from the partnership categories. */
export interface Playbook { key: string; categories: string[]; weights: PillarWeights; inScope: string[]; outOfScope: string[] }

export const P2P_PLAYBOOKS: Playbook[] = [
  {
    key: 'lender_platform_channeling_co_lending',
    categories: ['Institutional Lender', 'Channeling Bank / Multifinance'],
    weights: w(0.25, 0.25, 0.30, 0.10, 0.10),
    inScope: [
      'Platform must not guarantee borrower default (credit-risk guarantee / buyback) contrary to the P2P lending regulation',
      'Clear co-lending ratio and repayment waterfall (principal, interest, penalties)',
      'Subrogation power and transfer of receivables on bad debt',
      'Maximum economic benefit (interest plus fees) within the regulator’s cap',
    ],
    outOfScope: ['Third-party advertising banner design', 'Physical office lease'],
  },
  {
    key: 'marketing_affiliate_referral_in_app_offering',
    categories: ['Marketing Affiliate', 'Distribution / Channel Partner', 'Channeling App Partner'],
    weights: w(0.30, 0.20, 0.25, 0.15, 0.10),
    inScope: [
      'Commission formula precision: whether the percentage applies to principal only or to principal × tenor, the time unit (day / month) stated explicitly, and payable only on funds actually disbursed',
      'Commission reconciliation audit limited to records of users referred by the partner, never all of the platform’s records or customer database',
      'Partner disclaimer of liability for borrower default and for false data supplied by users',
      'Ban on reusing prospective borrowers’ data to market other products outside the cooperation',
      'Right to revoke access / take down the offer page when the agreement ends',
    ],
    outOfScope: [
      'Borrower interest and fee details (governed by the separate funding agreement)',
      'Field debt-collection hours and conduct (governed by the funding or collection agreement)',
      'Lender escrow account structure (unless the partner itself holds loan funds)',
    ],
  },
  {
    key: 'collection_agency',
    categories: ['Collection Agency'],
    weights: w(0.20, 0.25, 0.35, 0.10, 0.10),
    inScope: [
      'Strict compliance with the regulator’s collection ethics (08:00–20:00, no threats, intimidation or contacting third parties beyond emergency contacts for address confirmation)',
      'Collector certification and recorded collection communication logs',
      'Full indemnity from the agency when its collection misconduct causes regulatory sanctions or claims against the platform',
    ],
    outOfScope: [],
  },
  {
    key: 'credit_scoring_ekyc_va_insurance',
    categories: ['Credit Bureau / Scoring Provider', 'e-KYC Provider', 'Payment & Virtual Account Provider', 'Credit Insurance Provider'],
    weights: w(0.20, 0.20, 0.30, 0.20, 0.10),
    inScope: [
      'API uptime SLA and e-KYC / scoring response time',
      'Personal-data-law basis for biometric / specific data and a ban on the vendor keeping data to enrich its own commercial database',
      'Absolute segregation of escrow / virtual-account funds from operating accounts and daily (T+0 / T+1) reconciliation',
    ],
    outOfScope: [],
  },
];

export const INDUSTRY_RISK: Record<string, IndustryRisk> = {
  p2p_lending: { weights: w(0.25, 0.20, 0.30, 0.15, 0.10), redFlags: [] },
  payment_gateway: { weights: w(0.25, 0.20, 0.30, 0.15, 0.10), redFlags: [
    'MDR table, settlement schedule (T+1 / T+2) and late-settlement penalties',
    'Chargeback dispute handling, evidence deadlines and rolling reserve / holdback rights on suspected fraud',
    'PCI-DSS, payment-service licensing and AML/CFT compliance',
  ] },
  banking_investment: { weights: w(0.20, 0.25, 0.35, 0.10, 0.10), redFlags: [
    'IT outsourcing rules for banks: in-country data centre and DRC, unrestricted regulator audit access',
    'Segregated custodian accounts, investment-manager limits and selling-agent commission transparency',
    'Events of default and close-out netting in derivative / ISDA transactions',
  ] },
  b2b_saas: { weights: w(0.15, 0.30, 0.25, 0.20, 0.10), redFlags: [
    'Aggregate liability cap (e.g. 12 months of fees) and exclusion of consequential damages',
    'Uptime SLA, scheduled maintenance definition and service credits as sole remedy',
    'DPA, sub-processor list, incident notice within 24 hours, data export / deletion at exit',
  ] },
  it_development: { weights: w(0.20, 0.30, 0.15, 0.25, 0.10), redFlags: [
    'When source code and custom deliverables IP transfers (after full payment) and protection of background IP',
    'Written change-request procedure against scope creep and deemed UAT acceptance after 7–14 days of client silence',
    'Post go-live warranty period and source-code escrow release conditions',
  ] },
  influencer_kol: { weights: w(0.25, 0.30, 0.15, 0.20, 0.10), redFlags: [
    'Morality clause with immediate termination and pro-rata refund',
    'Duration and channels for paid use of content (whitelisting / boosting)',
    'Competitor exclusivity, minimum post retention and revision limits',
  ] },
  media_creative: { weights: w(0.25, 0.35, 0.10, 0.20, 0.10), redFlags: [
    'Warranty against third-party copyright claims (music, fonts, footage, talent release)',
    'Make-good compensation when an insertion order misses impressions / slots',
    'Last-minute cancellation and postponement fees',
  ] },
  hospitals_medical: { weights: w(0.20, 0.30, 0.30, 0.10, 0.10), redFlags: [
    'Product registration of devices / drugs, spare parts, mandatory calibration and uptime of critical equipment',
    'Allocation of liability for medical disputes / malpractice and active practising licences of partner doctors',
    'Licensed hazardous medical waste handling and payer claim payment deadlines',
  ] },
  healthtech_telemedicine: { weights: w(0.15, 0.25, 0.35, 0.15, 0.10), redFlags: [
    'Clear split between platform liability and the professional liability of doctors / pharmacies',
    'Protection of electronic medical records as specific personal data and interoperability standards',
    'E-prescription validation for prescription-only drugs and delivery chain integrity',
  ] },
  marketplace: { weights: w(0.25, 0.25, 0.25, 0.15, 0.10), redFlags: [
    'Safe harbour for the marketplace against sellers’ IP / prohibited goods, with fast takedown',
    'Commission and fee structure, escrow hold on buyer return claims and official-store authenticity',
    'Liability limits for loss / damage by integrated logistics partners',
  ] },
  retail_franchise: { weights: w(0.30, 0.25, 0.20, 0.15, 0.10), redFlags: [
    'Franchise registration and the radius of territorial exclusivity',
    'Royalty and marketing-fund formulas, mandatory supply and consignment loss / damage',
    'Post-termination non-compete and store lease aligned with the franchise term',
  ] },
  consumer_omnichannel: { weights: w(0.30, 0.20, 0.15, 0.25, 0.10), redFlags: [
    'Trading terms: listing fee, rebates, display allowance and service-level penalties',
    'Formula confidentiality, mould ownership and defect tolerance in toll manufacturing',
    'Near-expiry return policy and fulfilment stock accuracy',
  ] },
  legal_consulting: { weights: w(0.25, 0.30, 0.20, 0.15, 0.10), redFlags: [
    'Engagement scope, retainer hour quota, overage rate and out-of-pocket costs',
    'Best-efforts obligation, not a guaranteed outcome',
    'Professional liability capped at fees received and conflict-of-interest handling',
  ] },
  digital_agency: { weights: w(0.30, 0.20, 0.15, 0.25, 0.10), redFlags: [
    'Third-party media spend prepaid by the client or not borne by the agency if the client defaults',
    'Ownership of raw / master creative files versus final files after payment',
    'Tracking data (pixels, cookies, first-party lists) under the personal data law',
  ] },
  headhunting_recruitment: { weights: w(0.30, 0.15, 0.25, 0.20, 0.10), redFlags: [
    'Salary basis for the success fee, 30–90 day replacement guarantee and its exclusions',
    'Candidate ownership window (6–12 months) against backdoor hiring',
    'Employment-law compliance for staffing and consent for background data processing',
  ] },
  freight_logistics: { weights: w(0.25, 0.30, 0.10, 0.25, 0.10), redFlags: [
    'Cargo loss / damage limits (per kg or B/L versus full invoice value via cargo insurance)',
    'Demurrage, detention and storage costs from late customs documents',
    'Lien on cargo for unpaid invoices and fuel surcharge adjustments',
  ] },
  cold_chain_storage: { weights: w(0.20, 0.35, 0.15, 0.20, 0.10), redFlags: [
    'Required temperature range, maximum excursion and calibrated IoT logs as binding evidence',
    'Liability for spoiled food / pharma from cooling failure or outages and mandatory backup generators',
    'Cold-chain handover procedure (pre-cooling, seal inspection)',
  ] },
  delivery_fleet: { weights: w(0.25, 0.30, 0.15, 0.20, 0.10), redFlags: [
    'COD reconciliation and full liability for shortfalls or embezzlement by couriers',
    'Replacement-vehicle SLA during breakdown or service',
    'All-risk and third-party liability insurance and the legal status of driver partners',
  ] },
  public_transportation: { weights: w(0.25, 0.25, 0.20, 0.20, 0.10), redFlags: [
    'Subsidy / PSO payment formula, tariff escalation and protection against late public funding',
    'Minimum service standards, operational safety and cap on KPI deductions',
    'Long-term spare-part availability and e-ticket revenue reconciliation',
  ] },
  renewable_energy: { weights: w(0.30, 0.25, 0.15, 0.20, 0.10), redFlags: [
    'Take-or-pay / deemed generation when the offtaker cannot absorb energy',
    'Performance ratio guarantee, EPC delay liquidated damages and REC / carbon-credit ownership',
    'Land / rooftop lease aligned with the PPA term and early termination buyout table',
  ] },
  oil_gas: { weights: w(0.20, 0.35, 0.25, 0.10, 0.10), redFlags: [
    'Precise knock-for-knock indemnity and allocation of catastrophic blowout / pollution risk',
    'Local content requirements and their penalties',
    'Operating, standby and moving rates and marine / weather force majeure',
  ] },
  water_sanitation: { weights: w(0.25, 0.25, 0.25, 0.15, 0.10), redFlags: [
    'Minimum off-take / take-or-pay and tariff adjustment',
    'Operator relief when raw water exceeds the plant’s design specification',
    'Water / wastewater quality standards and asset handover at the end of a BOT concession',
  ] },
  education_research: { weights: w(0.15, 0.35, 0.25, 0.15, 0.10), redFlags: [
    'Ownership of sponsored research IP (background versus foreground) and royalty sharing',
    'Academic publication rights balanced against sponsor confidentiality',
    'Protection of student data (including minors) and research ethics clearance',
  ] },
  philanthropy_donations: { weights: w(0.25, 0.15, 0.35, 0.15, 0.10), redFlags: [
    'Restricted grant purpose, cap on operating-cost deductions and staged disbursement',
    'Financial audit and clawback rights on misuse',
    'Public fundraising permits and anti-money-laundering / political-funding bans',
  ] },
  ngo_humanitarian: { weights: w(0.20, 0.15, 0.40, 0.15, 0.10), redFlags: [
    'Anti-fraud, anti-corruption, counter-terrorism financing and safeguarding / PSEA clauses',
    'Protection of vulnerable beneficiaries’ identity and biometric data',
    'Emergency procurement documentation to avoid disallowed costs in donor audits',
  ] },
  office_procurement: { weights: w(0.30, 0.20, 0.10, 0.30, 0.10), redFlags: [
    'Price lock, dead-on-arrival replacement and genuine licences',
    'Security / cleaning vendor liability for lost assets and minimum wage / social security of outsourced staff',
    'Catering hygiene and medical-cost compensation for food safety incidents',
  ] },
  property_rental: { weights: w(0.30, 0.25, 0.15, 0.20, 0.10), redFlags: [
    'Whether rent includes final income tax on rent, and caps on service charge and utility / overtime AC rates',
    'Fit-out rent-free period and reinstatement duty excluding fair wear and tear',
    'Security deposit refund deadline and penalty-free exit when the building is inaccessible',
  ] },
  freelance_workforce: { weights: w(0.25, 0.30, 0.20, 0.15, 0.10), redFlags: [
    'Avoiding misclassification as employment with severance obligations',
    'Full IP assignment, waiver of extra royalties and no portfolio use of confidential work',
    'Milestone payments, revision quota and withholding tax on professional fees',
  ] },
  general: { weights: w(0.25, 0.25, 0.20, 0.15, 0.15), redFlags: [
    'Binding versus non-binding MoU, equal termination rights and equal rights to assign to affiliates',
    'Limitation of liability, public-information carve-out in NDAs and waiver of the court-termination requirement where applicable',
    'Accurate legal entity names, consistent cross-references, aligned bilingual text and match with the CLM metadata',
  ] },
};

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Weights, playbook and red flags for a contract: a P2P playbook when a partnership category matches one, otherwise the
 * industry's base weights, otherwise the general pack's.
 */
export function riskProfileFor(industryKey: string, categories: string[]): { weights: PillarWeights; playbook: Playbook | null; redFlags: string[] } {
  const industry = INDUSTRY_RISK[industryKey] ?? INDUSTRY_RISK.general;
  const playbook = industryKey === 'p2p_lending'
    ? P2P_PLAYBOOKS.find((p) => p.categories.some((c) => categories.some((tag) => sameText(tag, c)))) ?? null
    : null;
  return { weights: playbook?.weights ?? industry.weights, playbook, redFlags: playbook?.inScope ?? industry.redFlags };
}
