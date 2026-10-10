import { renderFillableSlot, type AgreementJurisdiction } from './cooperationAgreementTemplate';

/**
 * Built-in "Master Service Agreement" template offered in the New document dialog.
 * Party, date and scope blanks reuse the editor's built-in field keys (the organization is
 * the Customer = first party, the partner is the Supplier) so the Fields panel and partner
 * auto-fill work unchanged. Blanks with no built-in equivalent ship as custom fields.
 */
export const MASTER_SERVICE_AGREEMENT_ID = 'builtin-master-service-agreement';
export const MASTER_SERVICE_AGREEMENT_NAME = 'Master Service Agreement';

export const MASTER_SERVICE_AGREEMENT_CUSTOM_FIELDS = [
  { key: 'agreementNumber', label: 'Agreement Number', type: 'text', icon: '#️⃣', placeholder: 'MSA/2026/001', description: 'Agreement reference number', isCustom: true },
  { key: 'partnerRegistrationNumber', label: 'Supplier Registration Number', type: 'text', icon: '🏢', placeholder: '8120001234567', description: 'Company registration number of the Supplier (partner)', isCustom: true },
  { key: 'firstPartyRegistrationNumber', label: 'Customer Registration Number', type: 'text', icon: '🏛️', placeholder: '9120001234567', description: 'Company registration number of the Customer (your organization)', isCustom: true },
  { key: 'termYears', label: 'Agreement Term', type: 'text', icon: '⏳', placeholder: 'two (2)', description: 'How many years the agreement stays in force', isCustom: true },
  { key: 'survivalYears', label: 'Confidentiality Survival Period', type: 'text', icon: '🔒', placeholder: 'three (3)', description: 'Years the confidentiality obligations continue after expiry', isCustom: true },
  { key: 'signingPlace', label: 'Place of Signing', type: 'text', icon: '📍', placeholder: 'Jakarta', description: 'City where the agreement is signed', isCustom: true },
];

const slot = (key: string, type: 'text' | 'date' | 'entity' | 'person' | 'location' = 'text') =>
  renderFillableSlot(type, key, key);

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildMasterServiceAgreementHtml(jurisdiction: AgreementJurisdiction): string {
  const supplierName = slot('partnerName', 'entity');
  const customerName = slot('firstPartyName', 'entity');
  const services = slot('scopeDescId');
  const h2 = (title: string) => `<h2>${title}</h2>`;
  const p = (html: string) => `<p>${html}</p>`;

  return [
    `<h1 style="text-align: center">${MASTER_SERVICE_AGREEMENT_NAME}</h1>`,
    `<p style="text-align: center">${slot('agreementNumber')}</p>`,

    h2('Agreement Details'),
    p(`This agreement no. ${slot('agreementNumber')} takes effect on ${slot('startDate', 'date')} between the Supplier and the Customer identified below. Each is a "Party" and together they are the "Parties".`),
    p(`The Supplier is ${supplierName}, a company registered under number ${slot('partnerRegistrationNumber')}, with its registered address at ${slot('partnerAddress', 'location')}. It is represented by ${slot('partnerPic', 'person')}, ${slot('partnerPosition')}, and notices to it may be sent to ${slot('partnerEmail')}.`),
    p(`The Customer is ${customerName}, a company registered under number ${slot('firstPartyRegistrationNumber')}, with its registered address at ${slot('firstPartyAddress', 'location')}. It is represented by ${slot('firstPartyPic', 'person')}, ${slot('firstPartyPosition')}, and notices to it may be sent to ${slot('firstPartyEmail')}.`),

    h2('Background'),
    p(`The Parties are exploring a potential business relationship concerning ${services}. To assess it, each Party expects to share non-public information about its operations, strategy, systems and clients. This agreement governs how that information is handled.`),
    p('It covers information exchanged on or after the effective date, and any information already exchanged while the Parties were evaluating the same opportunity.'),

    h2('1. Definitions'),
    p('<strong>"Confidential Information"</strong> means all information, in any form or medium, that one Party (the "Disclosing Party") or anyone acting on its behalf makes available to the other Party (the "Receiving Party"), where that information is labelled or identified as confidential, or would reasonably be regarded as confidential given its nature and the context in which it was shared. It includes business strategies, financial and commercial data, prices and rates, client and vendor details, technical data, source code, product development plans, personal data, and the existence and substance of the Parties\' discussions.'),
    p('<strong>"Authorised Recipient"</strong> means any employee, director, professional adviser or subcontractor of the Receiving Party or of its group companies who requires the Confidential Information for the Purpose and is bound by confidentiality duties no less strict than those in this agreement.'),
    p(`<strong>"Purpose"</strong> means assessing, negotiating and, if the Parties so decide, carrying out the business relationship described in this agreement, namely ${services}.`),

    h2('2. Purpose and Permitted Use'),
    p('The Receiving Party shall use Confidential Information solely for the Purpose. It shall not use any Confidential Information to gain a competitive edge over the Disclosing Party, to solicit the Disclosing Party\'s clients or vendors, or to build a rival product or service.'),

    h2('3. Confidentiality Obligations'),
    p('The Receiving Party shall:'),
    p('(a) hold the Confidential Information in confidence, protecting it with at least the same degree of care it applies to its own confidential information of comparable sensitivity, and never less than reasonable care;'),
    p('(b) share it only with Authorised Recipients, and only to the extent they need it for the Purpose;'),
    p('(c) be liable for any act or omission of an Authorised Recipient that would breach this agreement had the Receiving Party committed it; and'),
    p('(d) notify the Disclosing Party without delay on learning of any unauthorised use or disclosure, and cooperate reasonably to mitigate its effects.'),

    h2('4. Exclusions'),
    p('The obligations in this agreement do not apply to information that the Receiving Party can demonstrate:'),
    p('(a) is or later becomes publicly available, other than through a breach of this agreement;'),
    p('(b) was lawfully in its possession, free of any confidentiality duty, before it was disclosed;'),
    p('(c) was developed by it independently, without using or referring to the Confidential Information; or'),
    p('(d) was lawfully obtained from a third party entitled to disclose it.'),

    h2('5. Disclosure Required by Law'),
    p('The Receiving Party may disclose Confidential Information to the extent required by applicable law, a regulatory authority, or an order of a competent court or tribunal. Where lawful and reasonably practicable, it shall notify the Disclosing Party beforehand, limit the disclosure to what is strictly required, and support any reasonable effort by the Disclosing Party to restrict or contest it.'),

    h2('6. Term and Survival'),
    p(`This agreement starts on the effective date and remains in force for ${slot('termYears')} years, unless the Parties supersede it with a later written agreement on the same subject matter.`),
    p(`The confidentiality obligations continue for ${slot('survivalYears')} years after this agreement expires. For any Confidential Information that qualifies as a trade secret, they continue for as long as it keeps that status.`),

    h2('7. Return and Destruction'),
    p('On the Disclosing Party\'s written request, and in any event when this agreement ends, the Receiving Party shall return or destroy all Confidential Information in its possession or control, including copies, and confirm in writing that it has done so.'),
    p('The Receiving Party may keep one copy where required by law, a regulator, or its internal record-retention or backup systems. Anything retained remains subject to this agreement.'),

    h2('8. No Licence, No Warranty'),
    p('All Confidential Information remains the property of the Disclosing Party. This agreement does not transfer ownership of, or grant any licence or other right to, any Confidential Information or intellectual property, apart from the limited right to use it for the Purpose.'),
    p('Confidential Information is supplied "as is". Neither Party gives any warranty as to its accuracy or completeness, and neither Party is liable to the other for decisions made in reliance on it.'),

    h2('9. No Obligation to Proceed'),
    p('Neither Party is required to disclose any particular information, to continue discussions, or to enter into any further agreement. Either Party may end the discussions at any time without liability, and doing so does not affect the obligations under this agreement.'),

    h2('10. Remedies'),
    p('Each Party acknowledges that monetary damages alone may not adequately remedy a breach of this agreement. The non-breaching Party may therefore seek an injunction or other equitable relief, in addition to any other remedy available to it.'),

    h2('11. Notices'),
    p('All notices under this agreement must be in writing and sent to the relevant Party\'s address in the Agreement Details, or to an email address that Party has used for correspondence about the Purpose. "Writing" and "in writing" include email.'),

    h2('12. Governing Law and Jurisdiction'),
    // Taken from the organization's jurisdiction pack, like the built-in cooperation agreement.
    p(`This agreement, and any dispute or claim arising out of or in connection with it, is governed by the laws of ${esc(jurisdiction.governingLaw.en)}. The Parties submit to the exclusive jurisdiction of ${esc(jurisdiction.disputeVenue.en)}.`),

    h2('13. General'),
    p('This agreement is the complete understanding between the Parties on handling Confidential Information for the Purpose, and supersedes any prior understanding on that subject. No amendment is valid unless agreed in writing by both Parties.'),
    p('Neither Party may assign or transfer this agreement without the other Party\'s prior written consent. If any provision is found invalid or unenforceable, the remaining provisions stay in full force.'),
    p('No failure or delay in exercising a right operates as a waiver of that right. This agreement does not create any partnership, agency or joint venture between the Parties, and gives no rights to anyone who is not a Party. It may be executed in counterparts, including electronically, and each counterpart is an original.'),

    h2('Signatures'),
    p('Signed by the authorised representatives of the Parties on the dates below.'),
    p(`Signed for and on behalf of the Supplier, ${supplierName}, by ${slot('partnerPic', 'person')}, ${slot('partnerPosition')}, at ${slot('signingPlace', 'location')} on ${slot('dateStr', 'date')}.`),
    p('Signature: ______________________________'),
    p(`Signed for and on behalf of the Customer, ${customerName}, by ${slot('firstPartyPic', 'person')}, ${slot('firstPartyPosition')}, at ${slot('signingPlace', 'location')} on ${slot('dateStr', 'date')}.`),
    p('Signature: ______________________________'),
  ].join('');
}
