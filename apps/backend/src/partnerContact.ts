// Preserve contacts from older records before removing the combined field.
export function migratePartnerContact(partner: any) {
  if (!partner || typeof partner !== 'object' || !('pic_partner' in partner)) return partner;
  const legacy = String(partner.pic_partner || '').trim();
  const match = legacy.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (!partner.pic_name) partner.pic_name = (match ? match[1] : legacy).trim();
  const contacts = (match?.[2] || '').split(/[/|]/).map(value => value.trim());
  if (!partner.pic_email) partner.pic_email = contacts.find(value => value.includes('@')) || '';
  if (!partner.pic_phone) partner.pic_phone = contacts.find(value => !value.includes('@') && /\d/.test(value)) || '';
  delete partner.pic_partner;
  return partner;
}
