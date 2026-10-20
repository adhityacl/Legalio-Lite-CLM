import { AlphabeticalSelect } from '../ui/alphabetical-select';
import { SuggestInput } from '../ui/suggest-input';
import React, { useId, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import type { PartyIdentifier } from '@legalio/types';
import { localizeName } from '@legalio/shared/policy';

import { InputGroup, InputGroupButton, InputGroupInput } from '@legalio/ui-components/input-group';
import { Button } from '@legalio/ui-components/button';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Text } from '@legalio/ui-components/text';
import { List, ListItem } from '@legalio/ui-components/list';
export interface PartnerJurisdictionFieldsProps {
  country: string;
  entityType: string;
  identifiers: PartyIdentifier[];
  onCountryChange: (code: string) => void;
  onEntityTypeChange: (value: string) => void;
  onIdentifiersChange: (next: PartyIdentifier[]) => void;
}

// ISO region codes Intl knows that are not countries.
const NON_COUNTRY_CODES = new Set(['EU', 'EZ', 'QO', 'UN', 'XA', 'XB', 'ZZ']);
const intlLocale = (language: string) => (language === 'ZH' ? 'zh-CN' : language === 'ID' ? 'id' : 'en');

/** Country name for any ISO 3166 alpha-2 code, including ones without a policy pack. */
export const countryDisplayName = (code: string, language: string): string =>
  new Intl.DisplayNames([intlLocale(language)], { type: 'region', fallback: 'none' }).of(code) || code;

/** Every country the browser can name, so partners outside the policy packs (US, EU…) can be recorded. */
const allCountryCodes = (language: string): string[] => {
  const names = new Intl.DisplayNames([intlLocale(language)], { type: 'region', fallback: 'none' });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return [...letters].flatMap((a) => [...letters].map((b) => a + b)).filter((code) => !NON_COUNTRY_CODES.has(code) && names.of(code));
};

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
  // Countries without their own pack get the jurisdiction-neutral legal forms and identifiers.
  const pack = countries.find((c) => c.code === country) || countries.find((c) => c.code === 'INTL');
  const otherCountries = useMemo(() => {
    const packed = new Set(countries.map((c) => c.code));
    return allCountryCodes(language).filter((code) => !packed.has(code));
  }, [countries, language]);
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
    <div className="space-y-g13">
      <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={countryId}>{t('form.partner.country', 'Country of incorporation')}</FieldLabel>
          <AlphabeticalSelect id={countryId} className={`cursor-pointer`} value={country} onChange={(e) => onCountryChange(e.target.value)}>
            <option value="">{t('form.partner.country_unknown', 'Unknown / not stated')}</option>
            {countries.filter((c) => c.code !== 'INTL').map((c) => (
              <option key={c.code} value={c.code}>{localizeName(c.name, language)}</option>
            ))}
            {otherCountries.map((code) => (
              <option key={code} value={code}>{countryDisplayName(code, language)}</option>
            ))}
          </AlphabeticalSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={entityId}>{t('form.partner.entity_type', 'Legal form')}</FieldLabel>
          <SuggestInput
            id={entityId}
            value={entityType}
            placeholder={t('form.partner.entity_type_ph', 'e.g. Private Limited, Sendirian Berhad')}
            onValueChange={onEntityTypeChange}
            options={pack?.legalForms || []}
          />
        </Field>
      </div>

      <Fieldset>
        <FieldsetLegend className="pb-g5 text-sm font-medium">{t('form.partner.identifiers', 'Registration & tax identifiers')}</FieldsetLegend>
        {identifiers.length > 0 && (
          <List marker="none" className="space-y-g8">
            {identifiers.map((item, index) => {
              const scheme = schemes.find((s) => s.key === item.scheme);
              const schemeLabel = (scheme && localizeName(scheme.label, language)) || t('form.partner.identifier_other', 'Other identifier');
              return (
                <ListItem key={index} className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
                  <AlphabeticalSelect
                    aria-label={t('form.partner.identifier_scheme', 'Identifier type')}
                    className={`cursor-pointer`}
                    value={item.scheme}
                    onChange={(e) => updateIdentifier(index, { scheme: e.target.value })}
                  >
                    {schemes.map((s) => <option key={s.key} value={s.key}>{localizeName(s.label, language)}</option>)}
                    <option value="other">{t('form.partner.identifier_other', 'Other identifier')}</option>
                  </AlphabeticalSelect>
                  <InputGroup>
                    <InputGroupInput
                      aria-label={`${t('form.partner.identifier_value', 'Identifier value')}: ${schemeLabel}`}
                      value={item.value}
                      placeholder={scheme?.example || ''}
                      onChange={(e) => updateIdentifier(index, { value: e.target.value, country: item.country || country })}
                    />
                    <InputGroupButton size="icon-md"
                      onClick={() => onIdentifiersChange(identifiers.filter((_, i) => i !== index))}
                      className="text-destructive"
                      aria-label={`${t('form.partner.identifier_remove', 'Remove identifier')}: ${schemeLabel}`}
                    >
                      <Trash2 className="h-g16 w-g16" aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroup>
                </ListItem>
              );
            })}
          </List>
        )}
        <Button variant="outline"
            type="button"
            onClick={addIdentifier}
            className="mt-g8 w-full"
          >
            <Plus className="h-g16 w-g16" aria-hidden="true" />
            {t('form.partner.identifier_add', 'Add Identifier')}
          </Button>
      </Fieldset>
    </div>
  );
};
