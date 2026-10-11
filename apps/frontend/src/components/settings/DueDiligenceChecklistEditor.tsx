import React, { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { localize, type DueDiligenceOverride, type DueDiligenceRequirement } from '@legalio/shared/policy';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Badge } from '@legalio/ui-components/badge';
import { Text } from '@legalio/ui-components/text';
import { List, ListItem } from '@legalio/ui-components/list';
export interface DueDiligenceChecklistEditorProps {
  /** Pack-provided items (core + country + industry), as returned by the server. */
  packItems: Array<DueDiligenceRequirement & { disabled?: boolean }>;
  overrides: Record<string, DueDiligenceOverride>;
  customItems: DueDiligenceRequirement[];
  onChange: (next: { overrides: Record<string, DueDiligenceOverride>; customItems: DueDiligenceRequirement[] }) => void;
  disabled?: boolean;
}

const SOURCE_KEY: Record<string, string> = {
  core: 'settings.region.dd_source_core',
  country: 'settings.region.dd_source_country',
  industry: 'settings.region.dd_source_industry',
  tenant: 'settings.region.dd_source_tenant',
};

function slugKey(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'item';
  return `custom_${base}`;
}

/**
 * Lets an administrator tailor the due-diligence checklist without code
 * changes (PRD §3.2.1): toggle "required", hide pack items, add custom items.
 */
export const DueDiligenceChecklistEditor: React.FC<DueDiligenceChecklistEditorProps> = ({
  packItems,
  overrides,
  customItems,
  onChange,
  disabled,
}) => {
  const { t, language } = useLanguage();
  const [newLabel, setNewLabel] = useState('');
  const newLabelId = useId();
  const packOnly = packItems.filter((item) => item.source !== 'tenant');

  const setOverride = (key: string, patch: DueDiligenceOverride) => {
    onChange({ overrides: { ...overrides, [key]: { ...overrides[key], ...patch } }, customItems });
  };

  const addCustom = () => {
    const label = newLabel.trim();
    if (!label) return;
    let key = slugKey(label);
    const taken = new Set([...packItems.map((i) => i.key), ...customItems.map((i) => i.key)]);
    for (let n = 2; taken.has(key); n++) key = `${slugKey(label)}_${n}`;
    onChange({ overrides, customItems: [...customItems, { key, label: { en: label, id: label }, required: false, source: 'tenant' }] });
    setNewLabel('');
  };

  const updateCustom = (key: string, patch: Partial<DueDiligenceRequirement>) => {
    onChange({ overrides, customItems: customItems.map((item) => (item.key === key ? { ...item, ...patch } : item)) });
  };

  const removeCustom = (key: string) => {
    onChange({ overrides, customItems: customItems.filter((item) => item.key !== key) });
  };

  const rowClass = 'flex flex-col gap-g8 border-b border-border py-g13 last:border-b-0  sm:flex-row sm:items-center';
  const toggleClass = 'inline-flex items-center gap-g8 text-sm text-foreground ';

  return (
    <div>
      <List marker="none" className="divide-y-0">
        {packOnly.map((item) => {
          const override = overrides[item.key] || {};
          const required = typeof override.required === 'boolean' ? override.required : item.required;
          const hidden = Boolean(override.disabled);
          return (
            <ListItem key={item.key} className={rowClass}>
              <div className="min-w-0 flex-1">
                <span className={`wrap-break-word text-sm font-medium ${hidden ? 'text-muted-foreground line-through' : 'text-foreground '}`}>
                  {localize(item.label, language)}
                </span>
                <Badge className="ms-g8">{t(SOURCE_KEY[item.source || 'core'] || SOURCE_KEY.core, item.source || 'core')}</Badge>
              </div>
              <Checkbox checked={required} disabled={disabled || hidden} onCheckedChange={(details) => setOverride(item.key, { required: details.checked === true })}><CheckboxControl /><CheckboxLabel>{t('settings.region.dd_required', 'Required')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
              <Checkbox checked={hidden} disabled={disabled} onCheckedChange={(details) => setOverride(item.key, { disabled: details.checked === true })}><CheckboxControl /><CheckboxLabel>{t('settings.region.dd_hidden', 'Hidden')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
            </ListItem>
          );
        })}
        {customItems.map((item) => (
          <ListItem key={item.key} className={rowClass}>
            <div className="min-w-0 flex-1">
              <Text as="span" size="sm" weight="medium" className="wrap-break-word">{localize(item.label, language)}</Text>
              <Badge className="ms-g8">{t('settings.region.dd_source_tenant', 'Custom')}</Badge>
            </div>
            <Checkbox checked={item.required} disabled={disabled} onCheckedChange={(details) => updateCustom(item.key, { required: details.checked === true })}><CheckboxControl /><CheckboxLabel>{t('settings.region.dd_required', 'Required')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
            <Button variant="ghost" size="icon-md"
              type="button"
              onClick={() => removeCustom(item.key)}
              disabled={disabled}
              className="text-destructive"
              aria-label={`${t('settings.region.dd_remove', 'Remove item')}: ${localize(item.label, language)}`}
            >
              <Trash2 className="h-g16 w-g16" aria-hidden="true" />
            </Button>
          </ListItem>
        ))}
      </List>
      <div className="mt-g13 flex flex-col gap-g8 sm:flex-row sm:items-end">
        <Field className="flex-1">
          <FieldLabel htmlFor={newLabelId}>
            {t('settings.region.dd_new_label', 'New item name')}
          </FieldLabel>
          <Input
            id={newLabelId}
            type="text"
            value={newLabel}
            disabled={disabled}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            className="w-full"
          />
        </Field>
        <Button variant="outline"
          type="button"
          onClick={addCustom}
          disabled={disabled || !newLabel.trim()}
        >
          <Plus className="h-g16 w-g16" aria-hidden="true" />
          {t('settings.region.dd_add', 'Add checklist item')}
        </Button>
      </div>
    </div>
  );
};
