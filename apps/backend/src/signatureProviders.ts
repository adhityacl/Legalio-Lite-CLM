/**
 * Where e-signature providers plug in.
 *
 * Legalio owns the request, its signers, the state machine, the audit trail and what happens to the contract on completion. A provider is
 * only the channel that carries a request to the signers and reports back. The built-in `manual` provider asks nothing of a vendor: the
 * organization sends the document through whatever tool it uses and reports progress either by hand (the contract's Signatures tab) or
 * through the signed inbound webhook (`POST /api/signatures/webhook/:endpointId`, see docs/SIGNATURES.md), which a vendor or a Zapier/Make-style
 * bridge can call.
 *
 * To add a vendor: implement `SignatureProvider`, call `registerSignatureProvider()` at start-up, and either
 *   - translate the vendor's own webhook into the canonical inbound events in a bridge, or
 *   - add a route that verifies the vendor's signature and calls `applyInboundEvent()` from signatures.ts with the canonical event.
 * Nothing else changes: the state machine, audit trail, contract update, notifications and `signature.*` webhooks are shared.
 */
export interface SignatureRequestView {
  id: string; organizationId: string; contractId: string; title: string; message: string; mode: 'sequential' | 'parallel'; status: string;
  provider: string; providerRef: string | null; expiresAt: string | null;
  signers: Array<{ id: string; name: string; email: string; order: number; status: string }>;
}
export interface ProviderContext { actor: string }
export interface ProviderSendResult {
  /** The provider's own reference for the request (envelope id ...), stored as `provider_ref` and matchable by inbound events. */
  providerRef?: string;
  /** Free text shown in the audit trail ("Send the PDF to the signers in ..."). */
  note?: string;
}

export interface SignatureProvider {
  /** Stable id stored on the request. */
  readonly id: string;
  readonly label: string;
  /** Whether the provider reports back through the inbound webhook (the UI then offers the endpoint panel). */
  readonly usesInboundWebhook: boolean;
  /** The request goes out (draft -> sent). Throw to keep it a draft. */
  send(request: SignatureRequestView, context: ProviderContext): Promise<ProviderSendResult>;
  /** The signers are reminded (sent / partially_signed). */
  resend(request: SignatureRequestView, context: ProviderContext): Promise<{ note?: string }>;
  /** The request is withdrawn at the provider. Best effort: Legalio cancels either way. */
  cancel(request: SignatureRequestView, context: ProviderContext): Promise<void>;
}

/** Records the intention only; the people involved carry it out. */
export const manualProvider: SignatureProvider = {
  id: 'manual',
  label: 'Manual / signed webhook',
  usesInboundWebhook: true,
  async send() { return { note: 'Sent for signature outside Legalio; progress is reported by hand or through the inbound webhook.' }; },
  async resend() { return { note: 'Reminder recorded; remind the signers through your signing tool.' }; },
  async cancel() { /* nothing to withdraw */ },
};

const registry = new Map<string, SignatureProvider>([[manualProvider.id, manualProvider]]);
export const registerSignatureProvider = (provider: SignatureProvider) => { registry.set(provider.id, provider); };
export const getSignatureProvider = (id: string): SignatureProvider | undefined => registry.get(id);
export const listSignatureProviders = (): Array<{ id: string; label: string; usesInboundWebhook: boolean }> =>
  [...registry.values()].map((provider) => ({ id: provider.id, label: provider.label, usesInboundWebhook: provider.usesInboundWebhook }));
