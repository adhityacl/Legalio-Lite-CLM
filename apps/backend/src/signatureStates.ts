/**
 * The e-signature state machine and the rules that follow from it. Pure functions, no I/O.
 *
 *   draft ──send──▶ sent ──first signer signs──▶ partially_signed ──last signer signs──▶ completed
 *     │               │ ╲                              │ ╲
 *     │               │  ╲──all signers sign──▶ completed
 *     │               ├──a signer declines──▶ declined          (from sent or partially_signed)
 *     ├──cancel──▶ cancelled                                      (from draft, sent, partially_signed)
 *     └─────────────────────── expire ──▶ expired                 (from sent, partially_signed only)
 *
 * completed, declined, expired and cancelled are final: nothing leaves them.
 */
export const SIGNATURE_STATUSES = ['draft', 'sent', 'partially_signed', 'completed', 'declined', 'expired', 'cancelled'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];
export const SIGNER_STATUSES = ['pending', 'signed', 'declined'] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];
export const SIGNATURE_MODES = ['sequential', 'parallel'] as const;
export type SignatureMode = (typeof SIGNATURE_MODES)[number];

export const FINAL_STATUSES: readonly SignatureStatus[] = ['completed', 'declined', 'expired', 'cancelled'];
export const OPEN_STATUSES: readonly SignatureStatus[] = ['sent', 'partially_signed'];

const TRANSITIONS: Record<SignatureStatus, readonly SignatureStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['partially_signed', 'completed', 'declined', 'expired', 'cancelled'],
  partially_signed: ['partially_signed', 'completed', 'declined', 'expired', 'cancelled'],
  completed: [], declined: [], expired: [], cancelled: [],
};
export const canTransition = (from: SignatureStatus, to: SignatureStatus): boolean => TRANSITIONS[from].includes(to);
export const isFinal = (status: SignatureStatus): boolean => FINAL_STATUSES.includes(status);
export const isOpen = (status: SignatureStatus): boolean => OPEN_STATUSES.includes(status);
export const isSignatureStatus = (value: unknown): value is SignatureStatus => typeof value === 'string' && (SIGNATURE_STATUSES as readonly string[]).includes(value);

export interface SignerLike { id: string; signing_order: number; status: SignerStatus }

/** Status of an open request after a signer signed, from the signers' states. */
export function statusAfterSigning(signers: SignerLike[]): 'partially_signed' | 'completed' {
  return signers.length > 0 && signers.every((signer) => signer.status === 'signed') ? 'completed' : 'partially_signed';
}

/**
 * Sequential requests: a signer may sign only when everybody with a lower order already has. Signers that share an order sign in any
 * sequence among themselves. Parallel requests have no order.
 */
export function mayNowSign(mode: SignatureMode, signer: SignerLike, signers: SignerLike[]): boolean {
  if (signer.status !== 'pending') return false;
  if (mode === 'parallel') return true;
  return signers.every((other) => other.signing_order >= signer.signing_order || other.status === 'signed');
}

/** The signers whose turn it is (pending, nobody before them outstanding). */
export const currentSigners = <T extends SignerLike>(mode: SignatureMode, signers: T[]): T[] => signers.filter((signer) => mayNowSign(mode, signer, signers));

/**
 * The contract's approval status once its signature request completed. Draft and Review become Signed, or Active when the term has
 * already begun; Signed becomes Active once the term has begun; Active stays. A terminated contract is left alone (a signature does not
 * revive it), and so is one whose approval status is not a known value.
 */
export function approvalStatusAfterSignature(contract: { status_approval?: string | null; start_date?: string | null; lifecycle_mode?: string | null; status?: string | null }, today: string): string | null {
  const current = contract.status_approval ?? 'Draft';
  if (contract.lifecycle_mode === 'terminated' || contract.status === 'Terminated') return null;
  if (!['Draft', 'Review', 'Signed', 'Active'].includes(current)) return null;
  const begun = Boolean(contract.start_date) && String(contract.start_date) <= today;
  if (current === 'Active') return null;
  if (begun) return 'Active';
  return current === 'Signed' ? null : 'Signed';
}
