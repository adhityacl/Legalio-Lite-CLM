// Preserve contacts from older records before removing the combined field.
export function migratePartnerContact(partner: any) {
  if (!partner || typeof partner !== 'object' || !('pic_partner' in partner)) return partner;
  const legacy = String(partner.pic_partner || '').trim();
  const match = legacy.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (!partner.nama_pic) partner.nama_pic = (match ? match[1] : legacy).trim();
  const contacts = (match?.[2] || '').split(/[/|]/).map(value => value.trim());
  if (!partner.email_pic) partner.email_pic = contacts.find(value => value.includes('@')) || '';
  if (!partner.telepon_pic) partner.telepon_pic = contacts.find(value => !value.includes('@') && /\d/.test(value)) || '';
  delete partner.pic_partner;
  return partner;
}
