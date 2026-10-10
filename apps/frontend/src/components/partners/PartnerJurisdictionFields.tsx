import { AlphabeticalDatalist, AlphabeticalSelect } from '../ui/alphabetical-select';
import React, { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import type { PartyIdentifier } from '@legalio/types';
import { localizeName } from '@legalio/shared/policy';

import { Input } from '@legalio/ui-components/input';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldLabel } from '@legalio/ui-components/field';
export interface PartnerJurisdictionFieldsProps {
  country: string;
  entityType: string;
  identifiers: PartyIdentifier[];
  onCountryChange: (code: string) => void;
  onEntityTypeChange: (value: string) => void;
  onIdentifiersChange: (next: PartyIdentifier[]) => void;
}

const labelClass = 'block font-bold text-foreground  mb-1.5 text-xs';

/**
 * Country of incorporation, legal form and identifiers for a counterparty
 * (PRD §3.2.2). Identifier types and legal forms come from the selected
 * country's policy pack; values are stored as entered.
 */
export const PartnerJurisdictionFields: React.FC<PartnerJurisdictionFieldsProps> = ({
  country,
  entityType,
  identifiers,
  onCountryChange,
  onEntityTypeChange,
  onIdentifiersChange,
}) => {
  const { t, language } = useLanguage();
  const { countries, policy } = useTenantSettings();
  const countryId = useId();
  const entityId = useId();
  const formsListId = useId();
  const pack = countries.find((c) => c.code === country);
  // Industries that contract with individuals (KOL, freelancers) also get personal tax IDs.
  const counterpartyTypes = policy.industry.counterpartyTypes?.length ? policy.industry.counterpartyTypes : ['organization'];
  const schemes = (pack?.identifierSchemes || []).filter((s) => s.appliesTo.some((type) => counterpartyTypes.includes(type)));

  const updateIdentifier = (index: number, patch: Partial<PartyIdentifier>) => {
    onIdentifiersChange(identifiers.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addIdentifier = () => {
    const used = new Set(identifiers.map((i) => i.scheme));
    const next = schemes.find((s) => !used.has(s.key));
    onIdentifiersChange([...identifiers, { scheme: next?.key || 'other', value: '', country: country || '' }]);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={countryId}>{t('form.partner.country', 'Country of incorporation')}</FieldLabel>
          <AlphabeticalSelect id={countryId} className={`cursor-pointer`} value={country} onChange={(e) => onCountryChange(e.target.value)}>
            <option value="">{t('form.partner.country_unknown', 'Unknown / not stated')}</option>
            {countries.filter((c) => c.code !== 'INTL').map((c) => (
              <option key={c.code} value={c.code}>{localizeName(c.name, language)}</option>
            ))}
          </AlphabeticalSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={entityId}>{t('form.partner.entity_type', 'Legal form')}</FieldLabel>
          <Input
            id={entityId}
            list={formsListId}
            value={entityType}
            placeholder={t('form.partner.entity_type_ph', 'e.g. Private Limited, Sendirian Berhad')}
            onChange={(e) => onEntityTypeChange(e.target.value)}
          />
          <AlphabeticalDatalist id={formsListId}>
            {(pack?.legalForms || []).map((form) => <option key={form} value={form} />)}
          </AlphabeticalDatalist>
        </Field>
      </div>

      <fieldset>
        <legend className={labelClass}>{t('form.partner.identifiers', 'Registration & tax identifiers')}</legend>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('form.partner.identifiers_hint', 'Stored as entered. Format hints come from the selected country pack.')}
        </p>
        <ul className="space-y-2">
          {identifiers.map((item, index) => {
            const scheme = schemes.find((s) => s.key === item.scheme);
            const schemeLabel = (scheme && localizeName(scheme.label, language)) || t('form.partner.identifier_other', 'Other identifier');
            return (
              <li key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <AlphabeticalSelect
                  aria-label={t('form.partner.identifier_scheme', 'Identifier type')}
                  className={`cursor-pointer`}
                  value={item.scheme}
                  onChange={(e) => updateIdentifier(index, { scheme: e.target.value })}
                >
                  {schemes.map((s) => <option key={s.key} value={s.key}>{localizeName(s.label, language)}</option>)}
                  <option value="other">{t('form.partner.identifier_other', 'Other identifier')}</option>
                </AlphabeticalSelect>
                <Input
                  aria-label={`${t('form.partner.identifier_value', 'Identifier value')}: ${schemeLabel}`}
                  value={item.value}
                  placeholder={scheme?.example || ''}
                  onChange={(e) => updateIdentifier(index, { value: e.target.value, country: item.country || country })}
                />
                <Button variant="ghost" size="icon-md"
                  type="button"
                  onClick={() => onIdentifiersChange(identifiers.filter((_, i) => i !== index))}
                  className="text-destructive"
                  aria-label={`${t('form.partner.identifier_remove', 'Remove identifier')}: ${schemeLabel}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button variant="outline"
          type="button"
          onClick={addIdentifier}
          className="mt-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('form.partner.identifier_add', 'Add identifier')}
        </Button>
      </fieldset>
    </div>
  );
};
